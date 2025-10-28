import { getClients, lottoAbi } from "@/hooks/useLottoContract";
import { CONTRACT_ADDRESS } from "@/lib/constants";
import { useEffect, useState } from "react";

export default function ClaimPanel() {
  const { publicClient, walletClient } = getClients();
  const [rid, setRid] = useState<bigint>(1n);
  const [roundInfo, setRoundInfo] = useState<any>(null);
  const [winners, setWinners] = useState<{ first: string[]; second: string[]; third: string[] }>({ first: [], second: [], third: [] });

  useEffect(() => { (async () => {
    const id = await publicClient.readContract({ address: CONTRACT_ADDRESS as `0x${string}`, abi: lottoAbi, functionName: "currentRoundId" }) as bigint;
    setRid(id);
    
    // Get round info for winner display
    const info = await publicClient.readContract({ 
      address: CONTRACT_ADDRESS as `0x${string}`, 
      abi: lottoAbi, 
      functionName: "rounds", 
      args: [id] 
    });
    setRoundInfo(info);
    // After settlement, derive winners from Entered logs
    const [open, close, winning, totalDeposits, carry1, drawn, settled] = info as any[];
    if (settled) {
      const enterEvent = (lottoAbi as any[]).find((x) => x.type === "event" && x.name === "Entered");
      if (enterEvent) {
        const inputs: any[] = enterEvent.inputs ?? [];
        const roundIndex = inputs.findIndex((i) => i.name?.toLowerCase().includes("round"));
        const playerIndex = inputs.findIndex((i) => i.type === "address" || i.name?.toLowerCase().includes("user"));
        const pickIndex = inputs.findIndex((i) => i.type?.startsWith("uint") && (i.name?.toLowerCase().includes("pick") || i.name?.toLowerCase().includes("number")));

        const logs = await publicClient.getLogs({ address: CONTRACT_ADDRESS as `0x${string}`, event: enterEvent as any, fromBlock: 0n, toBlock: "latest" });
        const parsed = logs.map((log: any) => {
          const args = log?.args ?? {};
          const player = args[inputs[playerIndex]?.name] as `0x${string}` | undefined;
          const pn = args[inputs[pickIndex]?.name] as bigint | number | undefined;
          const rMatch = roundIndex >= 0 ? (args[inputs[roundIndex].name] as bigint | undefined) === id : true;
          if (!player || pn === undefined || !rMatch) return undefined;
          return { player, pick: typeof pn === "bigint" ? Number(pn) : pn };
        }).filter(Boolean) as { player: `0x${string}`; pick: number }[];

        const winNum = Number(winning);
        const first = parsed.filter((p) => p.pick === winNum).map((p) => p.player);
        const second = parsed.filter((p) => p.pick % 100 === winNum % 100).map((p) => p.player);
        const third = parsed.filter((p) => p.pick % 10 === winNum % 10).map((p) => p.player);
        setWinners({ first, second, third });
      }
    } else {
      setWinners({ first: [], second: [], third: [] });
    }
  })(); }, []);

  // Claims are now automatic via backend/relayer calling `claimFor`.
  // Keep a no-op function here for compatibility if needed later.
  const claim = async () => {
    alert("Auto payout enabled: winnings are sent directly to wallets.");
  };

  // Calculate prize amounts based on total deposits
  const totalDeposits = roundInfo ? Number(roundInfo[3]) / 1e6 : 0;
  const firstPrize = totalDeposits * 0.7;
  const secondPrize = totalDeposits * 0.15;
  const thirdPrize = totalDeposits * 0.05;
  const settled = roundInfo ? Boolean(roundInfo[6]) : false;
  const winningNum = roundInfo ? Number(roundInfo[2]) : null;

  return (
    <div>
      <h3>
        Claim Winnings
        {settled && winningNum !== null ? (
          <span className="muted" style={{ marginLeft: 8 }}>Winning: {winningNum}</span>
        ) : null}
      </h3>
      <div className="winner-display">
        <div className="winner-line">
          <span className="winner-place">1st</span>
          <span className="winner-address">{settled && winners.first.length ? ` - ${winners.first[0]}` : ""}</span>
          <span className="winner-amount">{` - ${firstPrize.toFixed(2)} USDC`}</span>
        </div>
        <div className="winner-line">
          <span className="winner-place">2nd</span>
          <span className="winner-address">{settled && winners.second.length ? ` - ${winners.second[0]}` : ""}</span>
          <span className="winner-amount">{` - ${secondPrize.toFixed(2)} USDC`}</span>
        </div>
        <div className="winner-line">
          <span className="winner-place">3rd</span>
          <span className="winner-address">{settled && winners.third.length ? ` - ${winners.third[0]}` : ""}</span>
          <span className="winner-amount">{` - ${thirdPrize.toFixed(2)} USDC`}</span>
        </div>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>
        Auto payout enabled — winnings are sent directly after settlement.
      </div>
      <div style={{ marginTop: 8 }}>
        <a href="/rules" className="button cta claim-button" style={{ display: 'block', textAlign: 'center' }}>Rules</a>
      </div>
    </div>
  );
}
