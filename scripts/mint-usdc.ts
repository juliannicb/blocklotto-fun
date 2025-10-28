import { ethers } from "hardhat";

// Usage: npx hardhat run scripts/mint-usdc.ts --network localhost <USDC_ADDRESS> <TO_ADDRESS> [AMOUNT_USDC]
// Example: npx hardhat run scripts/mint-usdc.ts --network localhost 0x5FbDB2315678afecb367f032d93F642f64180aa3 0xYourWallet 1000

async function main() {
  const [deployer] = await ethers.getSigners();
  const usdcAddr = process.argv[2];
  const toAddr = process.argv[3];
  const amountArg = process.argv[4] || "1000"; // default 1000 USDC

  if (!usdcAddr || !toAddr) {
    console.error("Usage: <USDC_ADDRESS> <TO_ADDRESS> [AMOUNT_USDC]");
    process.exit(1);
  }

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