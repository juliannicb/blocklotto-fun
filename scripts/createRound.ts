import { ethers } from "hardhat";

async function main() {
  const addr = process.argv[2];
  if (!addr) throw new Error("Usage: npx hardhat run scripts/createRound.ts --network baseSepolia <contract>");
  const lotto = await ethers.getContractAt("BlockLotto", addr);
  const now = Math.floor(Date.now() / 1000);
  const openTime = now;
  const closeTime = openTime + 20*60*60; // 20 hours commit phase
  const revealTime = closeTime + 4*60*60; // 4 hours reveal phase
  const tx = await lotto.createRound(openTime, closeTime, revealTime);
  await tx.wait();
  console.log("Created round", (await lotto.currentRoundId()).toString());
}
main().catch((e)=>{ console.error(e); process.exit(1); });
