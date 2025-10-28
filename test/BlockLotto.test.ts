import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;


describe("BlockLotto – basic flow", function () {
  it("enter → close → VRF → settle → claim", async function () {
    const [owner, p1] = await ethers.getSigners();

    // Deploy mocks (use fully-qualified names to avoid artifact lookup issues)
    const USDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const VRF = await ethers.getContractFactory("contracts/mocks/VRFMock.sol:VRFMock");
    const vrf = await VRF.deploy();
    await vrf.waitForDeployment();

    // Deploy BlockLotto
    const Lotto = await ethers.getContractFactory("BlockLotto");
    const lotto = await Lotto.deploy(await usdc.getAddress(), owner.address);
    await lotto.waitForDeployment();

    // Set VRF (mock)
    await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 1)).wait();

    // Create a short round (opens now, closes in ~2 minutes)
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await (await lotto.createRound(now, now + 120)).wait();

    // Mint USDC to player and approve 5 USDC (6 decimals)
    await (await usdc.mint(p1.address, 10_000_000)).wait(); // 10 USDC
    await (await usdc.connect(p1).approve(await lotto.getAddress(), 5_000_000)).wait();

    // Enter round #1 picking 123
    await (await lotto.connect(p1).enter(1, 123)).wait();

    // Fast-forward past close time
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 121]);
    await ethers.provider.send("evm_mine", []);

    // Close & request randomness (mock request id will be 1)
    await (await lotto.closeAndRequestRandom(1)).wait();

    // Fulfill randomness with winning number 123 (exact hit)
    await (await vrf.fulfill(await lotto.getAddress(), 1, 123)).wait();

    // Settle the round
    await (await lotto.settle(1)).wait();

    // Claim – balance should increase
    const before = await usdc.balanceOf(p1.address);
    await (await lotto.connect(p1).claim(1)).wait();
    const after = await usdc.balanceOf(p1.address);

    expect(after).to.be.gt(before);
  });
});
