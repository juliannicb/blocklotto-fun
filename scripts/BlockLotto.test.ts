import { expect } from "chai";
import { ethers } from "hardhat";

const toUSDC = (n:number)=> BigInt(n) * BigInt(1_000_000);

describe("BlockLotto", () => {
  it("happy path: enter → close → fulfill → settle → claim", async () => {
    const [owner, alice, bob] = await ethers.getSigners();

    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();

    const VRF = await ethers.getContractFactory("MockVRFCoordinator");
    const vrf = await VRF.deploy();
    await vrf.waitForDeployment();

    const Lotto = await ethers.getContractFactory("BlockLotto");
    const lotto = await Lotto.deploy(await usdc.getAddress(), owner.address);
    await lotto.waitForDeployment();

    await (await lotto.setVRF(await vrf.getAddress(), ethers.ZeroHash, 0)).wait();

    // round open now, close in 2 seconds
    const now = Math.floor(Date.now() / 1000);
    await (await lotto.createRound(now, now+2)).wait();

    // fund players
    await (await usdc.mint(alice.address, toUSDC(100))).wait();
    await (await usdc.mint(bob.address,   toUSDC(100))).wait();

    // approvals
    await (await usdc.connect(alice).approve(await lotto.getAddress(), toUSDC(100))).wait();
    await (await usdc.connect(bob).approve(await lotto.getAddress(), toUSDC(100))).wait();

    // entries (pick 123 exact by alice, bob on 023 which is last-2)
    await (await lotto.connect(alice).enter(1, 123)).wait();
    await (await lotto.connect(bob).enter(1, 23)).wait(); // 023

    // wait for close
    await new Promise(r => setTimeout(r, 2100));

    await (await lotto.closeAndRequestRandom(1)).wait();

    // fulfill with seed so winning = 123 (mod 1000)
    const reqId = 1; // mock starts at 1
    await (await vrf.fulfill(await lotto.getAddress(), reqId, 123)).wait();

    // settle
    await (await lotto.settle(1)).wait();

    // Alice should be able to claim first-tier pool share
    const balA0 = await usdc.balanceOf(alice.address);
    await (await lotto.connect(alice).claim(1)).wait();
    const balA1 = await usdc.balanceOf(alice.address);
    expect(balA1).to.be.gt(balA0);

    // Bob should be able to claim second-tier pool share
    const balB0 = await usdc.balanceOf(bob.address);
    await (await lotto.connect(bob).claim(1)).wait();
    const balB1 = await usdc.balanceOf(bob.address);
    expect(balB1).to.be.gt(balB0);
  });
});
