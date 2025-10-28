import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

const USDC6 = (n: number) => BigInt(n) * BigInt(1_000_000);

async function deployAll() {
  const [owner, a, b, c, outsider] = await ethers.getSigners();

  const USDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();

  const VRF = await ethers.getContractFactory("contracts/mocks/VRFMock.sol:VRFMock");
  const vrf = await VRF.deploy();
  await vrf.waitForDeployment();

  const Lotto = await ethers.getContractFactory("BlockLotto");
  const lotto = await Lotto.deploy(await usdc.getAddress(), owner.address);
  await lotto.waitForDeployment();

  await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 1)).wait();

  return { owner, a, b, c, outsider, usdc: usdc as any, vrf: vrf as any, lotto: lotto as any };
}

describe("BlockLotto – prize tiers & secrecy", () => {
  it("1) payouts: 1st/2nd/3rd can claim after settlement", async () => {
    const { a, b, c, usdc, vrf, lotto } = await deployAll();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now, now + 60)).wait();

    // fund and approve
    for (const w of [a, b, c]) {
      await (await usdc.mint(w.address, USDC6(100))).wait();
      await (await usdc.connect(w).approve(await lotto.getAddress(), USDC6(100))).wait();
    }

    // Target winning number 123
    await (await lotto.connect(a).enter(1, 123)).wait(); // exact → 1st
    await (await lotto.connect(b).enter(1, 223)).wait(); // last-2 (23) → 2nd, not exact
    await (await lotto.connect(c).enter(1, 403)).wait(); // last-1 (3) → 3rd only

    // close
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 61]);
    await ethers.provider.send("evm_mine", []);
    await (await lotto.closeAndRequestRandom(1)).wait();

    // fulfill VRF (requestId 1 for first call)
    await (await vrf.fulfill(await lotto.getAddress(), 1, 123)).wait();
    await (await lotto.settle(1)).wait();

    // Expected prize pools from 3 entries (15 USDC)
    const pool1 = 10_500_000n; // 70%
    const pool2 = 2_250_000n;  // 15%
    const pool3 =   750_000n;  // 5%

    const aBefore = await usdc.balanceOf(a.address);
    await (await lotto.connect(a).claim(1)).wait();
    const aAfter = await usdc.balanceOf(a.address);
    expect(aAfter - aBefore).to.equal(pool1);

    const bBefore = await usdc.balanceOf(b.address);
    await (await lotto.connect(b).claim(1)).wait();
    const bAfter = await usdc.balanceOf(b.address);
    expect(bAfter - bBefore).to.equal(pool2);

    const cBefore = await usdc.balanceOf(c.address);
    await (await lotto.connect(c).claim(1)).wait();
    const cAfter = await usdc.balanceOf(c.address);
    expect(cAfter - cBefore).to.equal(pool3);
  });

  it("2) carryover rolls to next round when no exact winners", async () => {
    const { a, b, usdc, vrf, lotto } = await deployAll();

    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now, now + 30)).wait();

    for (const w of [a, b]) {
      await (await usdc.mint(w.address, USDC6(100))).wait();
      await (await usdc.connect(w).approve(await lotto.getAddress(), USDC6(100))).wait();
    }

    // Winning will be 555; players avoid exact 555 but hit lower tiers
    await (await lotto.connect(a).enter(1, 655)).wait(); // last-2
    await (await lotto.connect(b).enter(1, 115)).wait(); // last-1 (5), but not last-2

    // close round 1
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 31]);
    await ethers.provider.send("evm_mine", []);
    await (await lotto.closeAndRequestRandom(1)).wait();
    await (await vrf.fulfill(await lotto.getAddress(), 1, 555)).wait();
    await (await lotto.settle(1)).wait();

    const r1 = await lotto.rounds(1);
    // 2 entries = 10 USDC total → pool1 = 7 USDC carry to next
    expect(r1.carry1).to.equal(USDC6(7));

    // Create round 2 after settlement – should inherit carry1
    const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now2, now2 + 30)).wait();
    const r2 = await lotto.rounds(2);
    expect(r2.carry1).to.equal(USDC6(7));

    // Make an exact winner in round 2 so carry is consumed
    await (await usdc.mint(a.address, USDC6(100))).wait();
    await (await usdc.connect(a).approve(await lotto.getAddress(), USDC6(100))).wait();
    await (await lotto.connect(a).enter(2, 321)).wait();

    await ethers.provider.send("evm_setNextBlockTimestamp", [now2 + 31]);
    await ethers.provider.send("evm_mine", []);
    await (await lotto.closeAndRequestRandom(2)).wait();
    await (await vrf.fulfill(await lotto.getAddress(), 2, 321)).wait();
    await (await lotto.settle(2)).wait();

    const r2After = await lotto.rounds(2);
    expect(r2After.carry1).to.equal(0n);
  });

  it("3) secrecy: winning hidden until settlement; only VRF can reveal", async () => {
    const { owner, usdc, vrf, lotto, outsider } = await deployAll();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now, now + 100)).wait();

    // Before close: cannot close/request; winning is unset (0) and drawn is false
    await expect(lotto.closeAndRequestRandom(1)).to.be.revertedWith("not closed");
    let r = await lotto.rounds(1);
    expect(r.drawn).to.equal(false);
    expect(r.winning).to.equal(0);

    // After close: request randomness, but still not fulfilled → winning stays 0
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 101]);
    await ethers.provider.send("evm_mine", []);
    await (await lotto.closeAndRequestRandom(1)).wait();
    r = await lotto.rounds(1);
    expect(r.drawn).to.equal(true);
    expect(r.winning).to.equal(0);

    // Only VRF can fulfill; direct call should revert
    await expect(
      lotto.rawFulfillRandomWords(1, [999])
    ).to.be.revertedWith("only vrf");

    // Fulfill via mock VRF → still hidden
    await (await vrf.fulfill(await lotto.getAddress(), 1, 432)).wait();
    r = await lotto.rounds(1);
    expect(r.winning).to.equal(0);

    // After settlement, winning becomes visible
    await (await lotto.settle(1)).wait();
    r = await lotto.rounds(1);
    expect(r.winning).to.equal(432);
  });
});