import { ethers } from "hardhat";

async function main() {
  const usdc = process.env.USDC_SEPOLIA!;
  const treasury = process.env.FEE_TREASURY!;
  const coord = process.env.VRF_COORDINATOR!;
  const keyHash = process.env.VRF_KEY_HASH!;
  const subId = process.env.VRF_SUB_ID!;

  const Lotto = await ethers.getContractFactory("BlockLotto");
  const lotto = await Lotto.deploy(usdc, treasury);
  await lotto.waitForDeployment();
  const addr = await lotto.getAddress();
  console.log("BlockLotto:", addr);

  const isValidKeyHash = typeof keyHash === "string" && keyHash.startsWith("0x") && keyHash.length === 66;
  const isValidCoord = typeof coord === "string" && coord.startsWith("0x") && coord.length === 42 && coord !== "0x0000000000000000000000000000000000000000";

  if (isValidKeyHash && isValidCoord) {
    const tx = await lotto.setVRF(coord, keyHash, subId);
    await tx.wait();
    console.log("VRF configured");
  } else {
    console.log("Skipping VRF configuration: provide valid VRF_COORDINATOR and 32-byte VRF_KEY_HASH");
  }

  const now = Math.floor(Date.now() / 1000);
  const open = now;
  const close = now + 24 * 60 * 60;
  const tx2 = await lotto.createRound(open, close);
  await tx2.wait();
  console.log("Round #", (await lotto.currentRoundId()).toString(), "created");
}
main().catch((e) => { console.error(e); process.exit(1); });
