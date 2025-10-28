import { expect } from "chai";
import "@nomicfoundation/hardhat-chai-matchers";
import hre from "hardhat";
const { ethers } = hre;

describe("BlockLotto – validation & reverts", () => {
  async function setup() {
    const [owner, user] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const VRF = await ethers.getContractFactory("contracts/mocks/VRFMock.sol:VRFMock");
    const vrf = await VRF.deploy();
    await vrf.waitForDeployment();

    const Lotto = await ethers.getContractFactory("BlockLotto");
    const lotto = await Lotto.deploy(await usdc.getAddress(), owner.address);
    await lotto.waitForDeployment();

    // Cast deployed contracts to any to avoid BaseContract method diagnostics in TS
    return { owner, user, usdc: usdc as any, vrf: vrf as any, lotto: lotto as any };
  }

  it("rejects enter with bad pick and outside round window", async () => {
    const { user, usdc, lotto } = await setup();

    // Create a future round (not active yet)
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now + 60, now + 120)).wait();

    // Fund & approve user with >5 USDC
    await (await usdc.mint(user.address, 10_000_000)).wait();
    await (await usdc.connect(user).approve(await lotto.getAddress(), 10_000_000)).wait();

    // Not active
    await expect(lotto.connect(user).enter(1, 123)).to.be.revertedWith("not active");

    // Create an active round and test bad pick
    await (await lotto.createRound(now, now + 120)).wait();
    await expect(lotto.connect(user).enter(2, 1000)).to.be.revertedWith("bad pick");
  });

  it("closeAndRequestRandom reverts if VRF unset, and settle behavior", async () => {
    const { owner, user, usdc, lotto, vrf } = await setup();

    // Active round
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now, now + 10)).wait();

    // Fund & approve for an entry
    await ethers.provider.send("evm_increaseTime", [1]);
    await ethers.provider.send("evm_mine", []);
    await (await usdc.mint(user.address, 10_000_000)).wait();
    await (await usdc.connect(user).approve(await lotto.getAddress(), 10_000_000)).wait();
    await (await lotto.connect(user).enter(1, 5)).wait();

    // Advance time past close
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);

    // VRF not set yet → should revert
    await expect(lotto.closeAndRequestRandom(1)).to.be.revertedWith("vrf unset");

    // Set VRF and request randomness
    await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 1)).wait();
    await (await lotto.closeAndRequestRandom(1)).wait();

    // Current contract allows settle before VRF fulfillment (winning defaults to 0)
    await (await lotto.settle(1)).wait();
    const r = await lotto.rounds(1);
    expect(r.settled).to.equal(true);

    // After fulfillment, a second settle should revert as already settled
    await (await vrf.fulfill(await lotto.getAddress(), 1, 5)).wait();
    await expect(lotto.settle(1)).to.be.revertedWith("settled");
  });

  it("USDC decimals is 6 and balances map correctly", async () => {
    const { usdc } = await setup();
    expect(await usdc.decimals()).to.equal(6);
    const [owner] = await ethers.getSigners();
    // Owner receives initial mint in constructor: 1,000,000 * 10^6
    const bal = await usdc.balanceOf(owner.address);
    expect(bal).to.equal(1_000_000n * 1_000_000n);
  });
});