import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});