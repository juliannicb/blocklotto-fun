import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockUSDC", () => {
  it("mints and transfers with 6 decimals", async () => {
    const [a,b] = await ethers.getSigners();
    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    await usdc.waitForDeployment();
    const amount = 5_000_000n; // 5 USDC
    await (await usdc.mint(a.address, amount)).wait();
    await (await usdc.transfer(b.address, amount)).wait();
    expect(await usdc.balanceOf(b.address)).to.equal(amount);
    expect(await usdc.decimals()).to.equal(6);
  });
});
