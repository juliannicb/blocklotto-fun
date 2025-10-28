import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockVRFCoordinator", () => {
  it("returns incrementing request ids", async () => {
    const VRF = await ethers.getContractFactory("MockVRFCoordinator");
    const vrf = await VRF.deploy();
    await vrf.waitForDeployment();
    const id1 = await vrf.requestRandomWords(ethers.ZeroHash, 0, 3, 200000, 1);
    const id2 = await vrf.requestRandomWords(ethers.ZeroHash, 0, 3, 200000, 1);
    expect(id2).to.equal((await id1) + 1n);
  });
});
