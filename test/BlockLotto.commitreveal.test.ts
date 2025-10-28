import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("BlockLotto – Commit-Reveal Scheme", function () {
  let owner: any, p1: any, p2: any;
  let usdc: any, vrf: any, lotto: any;
  let now: number;

  beforeEach(async function () {
    [owner, p1, p2] = await ethers.getSigners();

    // Deploy mocks
    const USDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const VRF = await ethers.getContractFactory("contracts/mocks/VRFMock.sol:VRFMock");
    vrf = await VRF.deploy();
    await vrf.waitForDeployment();

    // Deploy BlockLotto
    const Lotto = await ethers.getContractFactory("BlockLotto");
    lotto = await Lotto.deploy(await usdc.getAddress(), owner.address);
    await lotto.waitForDeployment();

    // Set VRF
    await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 1)).wait();

    // Mint USDC to players
    await (await usdc.mint(p1.address, 50_000_000)).wait(); // 50 USDC
    await (await usdc.mint(p2.address, 50_000_000)).wait(); // 50 USDC
    
    // Approve USDC for BlockLotto
    await (await usdc.connect(p1).approve(await lotto.getAddress(), 50_000_000)).wait();
    await (await usdc.connect(p2).approve(await lotto.getAddress(), 50_000_000)).wait();

    // Get current timestamp after all setup
    now = (await ethers.provider.getBlock("latest"))!.timestamp;
  });

  describe("Round Creation with Reveal Time", function () {
    it("should create round with proper time constraints", async function () {
      const currentTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      const openTime = currentTime + 10;
      const closeTime = currentTime + 3600; // 1 hour commit phase
      const revealTime = currentTime + 7200; // 2 hours total (1 hour reveal phase)

      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      const round = await lotto.rounds(1);
      expect(round.openTime).to.equal(openTime);
      expect(round.closeTime).to.equal(closeTime);
      expect(round.revealTime).to.equal(revealTime);
    });

    it("should reject invalid time constraints", async function () {
      const currentTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      const openTime = currentTime + 10;
      const closeTime = currentTime + 3600;
      
      // revealTime before closeTime
      await expect(
        lotto.createRound(openTime, closeTime, closeTime - 1)
      ).to.be.revertedWith("bad times");

      // revealTime in the past
      await expect(
        lotto.createRound(openTime, closeTime, currentTime - 1)
      ).to.be.revertedWith("bad times");
    });
  });

  describe("Commit Phase", function () {
    let roundStartTime: number;
    
    beforeEach(async function () {
      // Get fresh timestamp for this test
      roundStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      // Create round: commit for 1 hour, reveal for 1 hour
      const openTime = roundStartTime + 10;
      const closeTime = roundStartTime + 3610;
      const revealTime = roundStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      // Fast forward to commit phase
      await ethers.provider.send("evm_setNextBlockTimestamp", [roundStartTime + 20]);
      await ethers.provider.send("evm_mine", []);
    });

    it("should allow commits during commit phase", async function () {
      const pick = 123;
      const nonce = 456;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));

      const tx = await lotto.connect(p1).commitPick(1, commitment);
      await tx.wait();

      // Check commitment was stored
      const commits = await lotto.getMyCommits(1, p1.address);
      expect(commits.length).to.equal(1);
      expect(commits[0].commitment).to.equal(commitment);
      expect(commits[0].stake).to.equal(5_000_000); // 5 USDC
      expect(commits[0].revealed).to.be.false;

      // Check total commitments increased
      expect(await lotto.totalCommitments(1)).to.equal(1);
    });

    it("should allow multiple commits from same user", async function () {
      const pick1 = 123, nonce1 = 456;
      const pick2 = 789, nonce2 = 101112;
      
      const commitment1 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick1, nonce1]));
      const commitment2 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick2, nonce2]));

      await (await lotto.connect(p1).commitPick(1, commitment1)).wait();
      await (await lotto.connect(p1).commitPick(1, commitment2)).wait();

      const commits = await lotto.getMyCommits(1, p1.address);
      expect(commits.length).to.equal(2);
      expect(await lotto.totalCommitments(1)).to.equal(2);
    });

    it("should reject commits outside commit phase", async function () {
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [123, 456]));

      // Create a fresh round with future times to safely test outside commit phase
      const t = (await ethers.provider.getBlock("latest"))!.timestamp;
      const open2 = t + 100;
      const close2 = t + 200;
      const reveal2 = t + 300;
      await (await lotto.createRound(open2, close2, reveal2)).wait();
      const rid = await lotto.currentRoundId();

      // Before round opens -> commit should revert
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 50]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        lotto.connect(p1).commitPick(rid, commitment)
      ).to.be.revertedWith("commit not open");

      // After commit phase ends (during reveal) -> commit should revert
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 250]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        lotto.connect(p1).commitPick(rid, commitment)
      ).to.be.revertedWith("commit not open");
    });

    it("should emit Committed event", async function () {
      const pick = 123;
      const nonce = 456;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));

      await expect(lotto.connect(p1).commitPick(1, commitment))
        .to.emit(lotto, "Committed")
        .withArgs(1, p1.address, commitment, 5_000_000);
    });
  });

  describe("Reveal Phase", function () {
    let commitment1: string, commitment2: string;
    let revealStartTime: number;
    const pick1 = 123, nonce1 = 456;
    const pick2 = 789, nonce2 = 101112;

    beforeEach(async function () {
      // Get fresh timestamp for this test
      revealStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      // Create round and make commits
      const openTime = revealStartTime + 10;
      const closeTime = revealStartTime + 3610;
      const revealTime = revealStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      // Fast forward to commit phase and make commits
      await ethers.provider.send("evm_setNextBlockTimestamp", [revealStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      commitment1 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick1, nonce1]));
      commitment2 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick2, nonce2]));

      await (await lotto.connect(p1).commitPick(1, commitment1)).wait();
      await (await lotto.connect(p1).commitPick(1, commitment2)).wait();

      // Fast forward to reveal phase
      await ethers.provider.send("evm_setNextBlockTimestamp", [revealStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);
    });

    it("should allow reveals during reveal phase", async function () {
      await (await lotto.connect(p1).revealPick(1, pick1, nonce1, 0)).wait();

      // Check commitment was marked as revealed
      const commits = await lotto.getMyCommits(1, p1.address);
      expect(commits[0].revealed).to.be.true;

      // Check pick was recorded
      const picks = await lotto.getMyPicks(1, p1.address);
      expect(picks.length).to.equal(1);
      expect(picks[0]).to.equal(pick1);
    });

    it("should reject reveals with wrong commitment", async function () {
      const wrongNonce = 999;
      
      await expect(
        lotto.connect(p1).revealPick(1, pick1, wrongNonce, 0)
      ).to.be.revertedWith("invalid reveal");
    });

    it("should reject reveals outside reveal phase", async function () {
      // Create a fresh round positioned relative to now
      const t = (await ethers.provider.getBlock("latest"))!.timestamp;
      const open2 = t + 100;
      const close2 = t + 200;
      const reveal2 = t + 300;
      await (await lotto.createRound(open2, close2, reveal2)).wait();
      const rid = await lotto.currentRoundId();

      // Move into commit phase and make a commitment so commitIndex is valid
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 120]);
      await ethers.provider.send("evm_mine", []);
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick1, nonce1]));
      await (await lotto.connect(p1).commitPick(rid, commitment)).wait();

      // Before reveal phase (still commit) -> reveal should revert
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 180]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        lotto.connect(p1).revealPick(rid, pick1, nonce1, 0)
      ).to.be.revertedWith("reveal not open");

      // After reveal phase ends -> reveal should revert
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 350]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        lotto.connect(p1).revealPick(rid, pick1, nonce1, 0)
      ).to.be.revertedWith("reveal not open");
    });

    it("should reject double reveals", async function () {
      await (await lotto.connect(p1).revealPick(1, pick1, nonce1, 0)).wait();
      
      await expect(
        lotto.connect(p1).revealPick(1, pick1, nonce1, 0)
      ).to.be.revertedWith("already revealed");
    });

    it("should emit Revealed event", async function () {
      await expect(lotto.connect(p1).revealPick(1, pick1, nonce1, 0))
        .to.emit(lotto, "Revealed")
        .withArgs(1, p1.address, pick1, nonce1, 5_000_000);
    });

    it("should handle multiple reveals from same user", async function () {
      await (await lotto.connect(p1).revealPick(1, pick1, nonce1, 0)).wait();
      await (await lotto.connect(p1).revealPick(1, pick2, nonce2, 1)).wait();

      const picks = await lotto.getMyPicks(1, p1.address);
      expect(picks.length).to.equal(2);
      expect(picks).to.include(BigInt(pick1));
      expect(picks).to.include(BigInt(pick2));
    });
  });

  describe("Complete Commit-Reveal Flow", function () {
    it("should complete full flow: commit → reveal → settle → claim", async function () {
      // Get fresh timestamp for this test
      const flowStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      // Create round
      const openTime = flowStartTime + 10;
      const closeTime = flowStartTime + 3610;
      const revealTime = flowStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      // Commit phase
      await ethers.provider.send("evm_setNextBlockTimestamp", [flowStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      const pick = 123;
      const nonce = 456;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));
      
      await (await lotto.connect(p1).commitPick(1, commitment)).wait();

      // Reveal phase
      await ethers.provider.send("evm_setNextBlockTimestamp", [flowStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);

      await (await lotto.connect(p1).revealPick(1, pick, nonce, 0)).wait();

      // After reveal phase - close and settle
      await ethers.provider.send("evm_setNextBlockTimestamp", [flowStartTime + 7220]);
      await ethers.provider.send("evm_mine", []);

      await (await lotto.closeAndRequestRandom(1)).wait();
      await (await vrf.fulfill(await lotto.getAddress(), 1, pick)).wait(); // Exact match
      await (await lotto.settle(1)).wait();

      // Claim winnings
      const balanceBefore = await usdc.balanceOf(p1.address);
      await (await lotto.connect(p1).claim(1)).wait();
      const balanceAfter = await usdc.balanceOf(p1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should handle unrevealed commitments", async function () {
      // Get fresh timestamp for this test
      const unrevealedStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      // Create round
      const openTime = unrevealedStartTime + 10;
      const closeTime = unrevealedStartTime + 3610;
      const revealTime = unrevealedStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      // Commit phase - make commits but don't reveal all
      await ethers.provider.send("evm_setNextBlockTimestamp", [unrevealedStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      const pick1 = 123, nonce1 = 456;
      const pick2 = 789, nonce2 = 101112;
      const commitment1 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick1, nonce1]));
      const commitment2 = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick2, nonce2]));
      
      await (await lotto.connect(p1).commitPick(1, commitment1)).wait();
      await (await lotto.connect(p2).commitPick(1, commitment2)).wait();

      // Reveal phase - only reveal one
      await ethers.provider.send("evm_setNextBlockTimestamp", [unrevealedStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);

      await (await lotto.connect(p1).revealPick(1, pick1, nonce1, 0)).wait();
      // p2 doesn't reveal

      // After reveal phase - close and settle
      await ethers.provider.send("evm_setNextBlockTimestamp", [unrevealedStartTime + 7220]);
      await ethers.provider.send("evm_mine", []);

      await (await lotto.closeAndRequestRandom(1)).wait();
      await (await vrf.fulfill(await lotto.getAddress(), 1, pick1)).wait();
      await (await lotto.settle(1)).wait();

      // Only p1 should be able to claim (revealed their pick)
      const balanceBefore = await usdc.balanceOf(p1.address);
      await (await lotto.connect(p1).claim(1)).wait();
      const balanceAfter = await usdc.balanceOf(p1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);

      // p2 should not be able to claim (didn't reveal)
      await expect(lotto.connect(p2).claim(1)).to.be.revertedWith("nothing");
    });
  });

  describe("Helper Functions", function () {
    it("should generate correct commitment hash", async function () {
      const pick = 123;
      const nonce = 456;
      
      const expectedCommitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));
      const contractCommitment = await lotto.generateCommitment(pick, nonce);
      
      expect(contractCommitment).to.equal(expectedCommitment);
    });

    it("should return correct commit count", async function () {
      // Create round and make commits
      const openTime = now + 1;
      const closeTime = now + 3600;
      const revealTime = now + 7200;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [now + 2]);
      await ethers.provider.send("evm_mine", []);

      expect(await lotto.getMyCommitCount(1, p1.address)).to.equal(0);

      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [123, 456]));
      await (await lotto.connect(p1).commitPick(1, commitment)).wait();

      expect(await lotto.getMyCommitCount(1, p1.address)).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    it("should handle pick number 0", async function () {
      const edgeStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      const openTime = edgeStartTime + 10;
      const closeTime = edgeStartTime + 3610;
      const revealTime = edgeStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      const pick = 0;
      const nonce = 123;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));
      
      await (await lotto.connect(p1).commitPick(1, commitment)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);

      // Pick 0 is actually allowed in the contract (RANGE_MAX = 999, no minimum check)
      await expect(lotto.connect(p1).revealPick(1, pick, nonce, 0))
        .to.emit(lotto, "Revealed")
        .withArgs(1, p1.address, pick, nonce, 5_000_000);
    });

    it("should handle pick number 999", async function () {
      const edgeStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      const openTime = edgeStartTime + 10;
      const closeTime = edgeStartTime + 3610;
      const revealTime = edgeStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      const pick = 999;
      const nonce = 123;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));
      
      await (await lotto.connect(p1).commitPick(1, commitment)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);

      await expect(lotto.connect(p1).revealPick(1, pick, nonce, 0))
        .to.emit(lotto, "Revealed")
        .withArgs(1, p1.address, pick, nonce, 5_000_000);
    });

    it("should handle pick number 1000", async function () {
      const edgeStartTime = (await ethers.provider.getBlock("latest"))!.timestamp;
      
      const openTime = edgeStartTime + 10;
      const closeTime = edgeStartTime + 3610;
      const revealTime = edgeStartTime + 7210;
      await (await lotto.createRound(openTime, closeTime, revealTime)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 20]);
      await ethers.provider.send("evm_mine", []);

      const pick = 1000;
      const nonce = 123;
      const commitment = ethers.keccak256(ethers.solidityPacked(["uint16", "uint256"], [pick, nonce]));
      
      await (await lotto.connect(p1).commitPick(1, commitment)).wait();

      await ethers.provider.send("evm_setNextBlockTimestamp", [edgeStartTime + 3620]);
      await ethers.provider.send("evm_mine", []);

      await expect(lotto.connect(p1).revealPick(1, pick, nonce, 0))
        .to.be.revertedWith("bad pick");
    });
  });
});