const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

describe("BlockLotto – validation & reverts (JS)", function () {
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

    return { owner, user, usdc, vrf, lotto };
  }

  it("rejects enter with bad pick and outside round window", async function () {
    const { user, usdc, lotto } = await setup();

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await (await lotto.createRound(now + 60, now + 120)).wait();

    await (await usdc.mint(user.address, 10_000_000)).wait();
    await (await usdc.connect(user).approve(await lotto.getAddress(), 10_000_000)).wait();

    await expect(lotto.connect(user).enter(1, 123)).to.be.revertedWith("not active");

    await (await lotto.createRound(now, now + 120)).wait();
    await expect(lotto.connect(user).enter(2, 1000)).to.be.revertedWith("bad pick");
  });

  it("VRF unset prevents request; settle reverts prior to result", async function () {
    const { user, usdc, lotto, vrf } = await setup();
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    // Make the round active for 10 seconds
    await (await lotto.createRound(now, now + 10)).wait();

    // Move into the active window and enter
    await ethers.provider.send("evm_increaseTime", [1]);
    await ethers.provider.send("evm_mine", []);

    await (await usdc.mint(user.address, 10_000_000)).wait();
    await (await usdc.connect(user).approve(await lotto.getAddress(), 10_000_000)).wait();
    await (await lotto.connect(user).enter(1, 5)).wait();

    // Advance time past close
    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine", []);

    await expect(lotto.closeAndRequestRandom(1)).to.be.revertedWith("vrf unset");

    await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 1)).wait();
    await (await lotto.closeAndRequestRandom(1)).wait();

    // With hidden winning, settle should revert until VRF fulfills
    await expect(lotto.settle(1)).to.be.revertedWith("no result");

    // After fulfillment, settle succeeds once
    await (await vrf.fulfill(await lotto.getAddress(), 1, 5)).wait();
    await (await lotto.settle(1)).wait();
    const r = await lotto.rounds(1);
    expect(r.settled).to.equal(true);

    // A second settle reverts as already settled
    await expect(lotto.settle(1)).to.be.revertedWith("settled");
  });

  it("USDC decimals is 6 and constructor mint is 1,000,000 USDC", async function () {
    const { usdc } = await setup();
    expect(await usdc.decimals()).to.equal(6);
    const [owner] = await ethers.getSigners();
    const bal = await usdc.balanceOf(owner.address);
    expect(bal).to.equal(1_000_000n * 1_000_000n);
  });
});