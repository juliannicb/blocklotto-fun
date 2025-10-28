import { useEffect, useState } from "react";
import { getClients, lottoAbi } from "@/hooks/useLottoContract";
import { CONTRACT_ADDRESS, DEMO_MODE, HAS_ADDRESSES } from "@/lib/constants";

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
    return (
      <div className="p-4 border rounded">
        <h3>Round Status</h3>
        <p>Demo mode: contract addresses not configured.</p>
        <p>Set `NEXT_PUBLIC_CONTRACT_ADDRESS` and `NEXT_PUBLIC_USDC_ADDRESS` to enable live data.</p>
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
