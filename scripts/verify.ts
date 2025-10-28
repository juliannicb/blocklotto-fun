import { run } from "hardhat";

async function main() {
  const addr = process.argv[2];
  const usdc = process.env.USDC_SEPOLIA!;
  const treasury = process.env.FEE_TREASURY!;
  if (!addr) throw new Error("Usage: npx hardhat run scripts/verify.ts --network baseSepolia <address>");
  await run("verify:verify", { address: addr, constructorArguments: [usdc, treasury] });
}
main().catch((e)=>{ console.error(e); process.exit(1); });
