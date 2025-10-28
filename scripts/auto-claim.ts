import { ethers } from "hardhat";

/**
 * Auto-claim relayer
 * Usage:
 *   npx hardhat run scripts/auto-claim.ts --network <network> <BlockLottoAddress>
 *
 * Listens for Settled events and then triggers claimFor(roundId, user)
 * for all participants who revealed in that round.
 */
async function main() {
  // Accept contract address via env var or argv (argv may be restricted by Hardhat)
  const envAddr = process.env.LOTTO_ADDR;
  const addrArg = process.argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
  const addr = envAddr || addrArg;
  if (!addr) throw new Error("Usage: LOTTO_ADDR=0x... npx hardhat run scripts/auto-claim.ts --network <network>");

  const lotto = await ethers.getContractAt("BlockLotto", addr);
  const provider = ethers.provider;

  const processedRounds = new Set<string>();

  async function processRound(roundId: bigint) {
    const key = roundId.toString();
    if (processedRounds.has(key)) return;

    const info = await lotto.rounds(roundId);
    if (!info.settled) return; // only act on settled rounds

    console.log(`[auto-claim] Processing settled round ${roundId}`);

    // Find all users that revealed picks for this round
    const filter = lotto.filters.Revealed(roundId, null);
    const logs = await lotto.queryFilter(filter, 0, "latest");
    const users = Array.from(
      new Set(
        logs
          .map((log) => {
            try {
              const parsed = lotto.interface.parseLog(log);
              if (!parsed || !parsed.args) return undefined;
              const val = (parsed.args as any).user ?? (parsed.args as any)[1];
              return typeof val === "string" ? val : undefined;
            } catch {
              return undefined;
            }
          })
          .filter((x): x is string => typeof x === "string")
      )
    );

    if (users.length === 0) {
      console.log(`[auto-claim] No revealed users found for round ${roundId}`);
      processedRounds.add(key);
      return;
    }

    for (const user of users) {
      try {
        const tx = await lotto.claimFor(roundId, user);
        const rcpt = await tx.wait();
        console.log(`[auto-claim] Claimed for ${user} in round ${roundId} (tx: ${rcpt?.hash})`);
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("nothing")) {
          console.log(`[auto-claim] No payout for ${user} in round ${roundId}`);
        } else {
          console.warn(`[auto-claim] Failed claimFor for ${user} in round ${roundId}:`, msg);
        }
      }
    }

    processedRounds.add(key);
  }

  // Catch up any already settled rounds on startup
  try {
    const settledFilter = lotto.filters.Settled(null, null, null, null, null);
    const past = await lotto.queryFilter(settledFilter, 0, "latest");
    for (const log of past) {
      try {
        const parsed = lotto.interface.parseLog(log);
        if (!parsed || !parsed.args) continue;
        const ridAny = (parsed.args as any).roundId ?? (parsed.args as any)[0];
        const rid = typeof ridAny === "bigint" ? ridAny : undefined;
        if (rid !== undefined) {
          await processRound(rid);
        }
      } catch (e) {
        console.warn("[auto-claim] Failed to parse Settled log:", e);
      }
    }
  } catch (e) {
    console.warn("[auto-claim] Initial catch-up failed:", e);
  }

  // Listen for new settlements
  lotto.on(lotto.filters.Settled(null, null, null, null, null), async (roundId: bigint) => {
    try {
      await processRound(roundId);
    } catch (e) {
      console.warn(`[auto-claim] Error processing round ${roundId}:`, e);
    }
  });

  console.log("[auto-claim] Relayer listening for Settled events...");
  // Keep the process alive
  await new Promise<void>(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});