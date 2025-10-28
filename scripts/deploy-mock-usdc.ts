// scripts/deploy-mock-usdc.ts
import { ethers } from "hardhat";

async function main() {
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  await token.waitForDeployment();

  console.log("Mock USDC deployed to:", await token.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
