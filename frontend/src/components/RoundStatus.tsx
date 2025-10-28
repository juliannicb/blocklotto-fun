import { useEffect, useState } from "react";
import { getClients, lottoAbi } from "@/hooks/useLottoContract";
import { CONTRACT_ADDRESS, DEMO_MODE, HAS_ADDRESSES } from "@/lib/constants";
import { initDemoRound, getCurrentRoundId as demoCurrentRoundId, getRound as demoGetRound } from "@/lib/demo";

export default function RoundStatus() {
  const [info, setInfo] = useState<any>(null);
  const [id, setId] = useState<bigint | null>(null);

  useEffect(() => {
    (async () => {
      if (!HAS_ADDRESSES || DEMO_MODE || !CONTRACT_ADDRESS) return;
      const { publicClient } = getClients();
      const rid = await publicClient.readContract({ address: CONTRACT_ADDRESS as `0x${string}`, abi: lottoAbi, functionName: "currentRoundId" }) as bigint;
      setId(rid);
      const r = await publicClient.readContract({ address: CONTRACT_ADDRESS as `0x${string}`, abi: lottoAbi, functionName: "rounds", args: [rid] });
      setInfo(r);
    })();
  }, []);

  if (!HAS_ADDRESSES || DEMO_MODE || !CONTRACT_ADDRESS) {
    // Demo: show local round info
    initDemoRound();
    const rid = demoCurrentRoundId();
    const r = demoGetRound(rid);
    const now = Math.floor(Date.now() / 1000);
    let phase = 'Closed';
    if (now >= r.openTime && now < r.closeTime) phase = 'Commit Phase';
    else if (now >= r.closeTime && now < r.revealTime) phase = 'Reveal Phase';
    return (
      <div className="p-4 border rounded">
        <h3>Round #{rid}</h3>
        <p><strong>Phase:</strong> {phase}</p>
        <p>Opens: {new Date(Number(r.openTime)*1000).toLocaleString()}</p>
        <p>Commit Ends: {new Date(Number(r.closeTime)*1000).toLocaleString()}</p>
        <p>Reveal Ends: {new Date(Number(r.revealTime)*1000).toLocaleString()}</p>
        <p>Total Deposits: {Number(r.totalDeposits)/1e6} USDC</p>
        <p>Winning: {r.winning !== null ? r.winning : '-'}</p>
        <p>Drawn: {String(r.drawn)} | Settled: {String(r.settled)}</p>
        <p>Carryover (1st): {Number(r.carry1)/1e6} USDC</p>
      </div>
    );
  }
  if (!info || !id) return <div>Loading round…</div>;
  const [open, close, revealTime, winning, totalDeposits, carry1, drawn, settled] = info as any[];
  
  // Determine current phase
  const now = Math.floor(Date.now() / 1000);
  const openTime = Number(open);
  const closeTime = Number(close);
  const revealTimeNum = Number(revealTime);
  
  let phase = 'Closed';
  if (now >= openTime && now < closeTime) {
    phase = 'Commit Phase';
  } else if (now >= closeTime && now < revealTimeNum) {
    phase = 'Reveal Phase';
  }
  
  return (
    <div className="p-4 border rounded">
      <h3>Round #{id.toString()}</h3>
      <p><strong>Phase:</strong> {phase}</p>
      <p>Opens: {new Date(Number(open)*1000).toLocaleString()}</p>
      <p>Commit Ends: {new Date(Number(close)*1000).toLocaleString()}</p>
      <p>Reveal Ends: {new Date(Number(revealTime)*1000).toLocaleString()}</p>
      <p>Total Deposits: {Number(totalDeposits)/1e6} USDC</p>
      <p>Winning: {Number(winning)}</p>
      <p>Drawn: {String(drawn)} | Settled: {String(settled)}</p>
      <p>Carryover (1st): {Number(carry1)/1e6} USDC</p>
    </div>
  );
}
