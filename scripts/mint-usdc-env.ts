import { ethers } from "hardhat";

async function main() {
  const usdcAddr = process.env.USDC_SEPOLIA;
  const toAddr = process.env.FEE_TREASURY;
  const amountArg = process.env.MINT_USDC_AMOUNT || "1000";

  if (!usdcAddr || !toAddr) {
    throw new Error("USDC_SEPOLIA and FEE_TREASURY must be set in .env");
  }

  const [deployer] = await ethers.getSigners();
  const amount = ethers.parseUnits(amountArg, 6);

  console.log(`Using deployer: ${deployer.address}`);
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddr, deployer);
  const owner = await usdc.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Deployer is not MockUSDC owner. Owner is ${owner}`);
  }

  console.log(`Minting ${amountArg} USDC (6d) to ${toAddr} ...`);
  const tx = await usdc.mint(toAddr, amount);
  await tx.wait();
  console.log(`Minted. Tx: ${tx.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});