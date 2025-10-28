'use client';

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useChainId,
  useSwitchChain,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { lottoAbi } from "@/hooks/useLottoContract";
import { CONTRACT_ADDRESS, USDC_ADDRESS, ENTRY_USDC, USDC_DECIMALS, DEMO_MODE, HAS_ADDRESSES } from "@/lib/constants";
import { appChain, IS_LOCAL, RPC_URL } from "@/lib/wagmi";
import { keccak256, encodePacked, encodeAbiParameters, toHex } from "viem";
import { getClients } from "@/hooks/useLottoContract";
import {
  initDemoRound,
  getDemoAddress,
  setDemoAddress,
  getCurrentRoundId as demoCurrentRoundId,
  getRound as demoGetRound,
  getCommitments as demoGetCommitments,
  getReveals as demoGetReveals,
  getMyCommits as demoGetMyCommits,
  commitPick as demoCommitPick,
  revealPick as demoRevealPick,
} from "@/lib/demo";

// ---- Config ----
const CHAIN_HEX = `0x${Number(appChain.id).toString(16)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Entrant = { player: `0x${string}`; pick: number; txHash: `0x${string}` };
type Commitment = { player: `0x${string}`; commitment: string; txHash: `0x${string}` };
type UserCommit = { pick: number; nonce: string; commitment: string; revealed: boolean; commitIndex: number };

export default function EnterForm() {
  // UI state
  const [pick, setPick] = useState<number>(0);
  const [nonce, setNonce] = useState<string>("");
  const [roundId, setRoundId] = useState<bigint>(1n);
  const [pending, setPending] = useState(false);
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [userCommits, setUserCommits] = useState<UserCommit[]>([]);
  const [eventsSupported, setEventsSupported] = useState(true);
  const [roundInfo, setRoundInfo] = useState<any>(null);
  const [currentPhase, setCurrentPhase] = useState<'commit' | 'reveal' | 'closed'>('commit');
  const [autoRevealTriggered, setAutoRevealTriggered] = useState(false);

  // wagmi
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connectors, connect, status: connectStatus, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, status: switchStatus } = useSwitchChain();

  // Prefer injected connector
  const injectedConnector = useMemo(
    () => connectors.find((c) => c.id === "injected") ?? connectors[0],
    [connectors]
  );

  // Generate random nonce
  const generateNonce = () => {
    const randomNonce = Math.floor(Math.random() * 1000000000).toString();
    setNonce(randomNonce);
  };

  // Generate commitment hash
  const generateCommitment = (pickNum: number, nonceStr: string) => {
    return keccak256(encodePacked(['uint16', 'uint256'], [pickNum, BigInt(nonceStr)]));
  };

  // Ensure we are on Base Sepolia (switch or add if necessary)
  const ensureOnBase = async () => {
    if (chainId === appChain.id) return;
    try {
      await switchChain({ chainId: appChain.id });
    } catch {
      const eth = (window as any)?.ethereum;
      if (eth && !IS_LOCAL) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: CHAIN_HEX,
                chainName: appChain.name,
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [RPC_URL],
                blockExplorerUrls: appChain.blockExplorers?.default?.url ? [appChain.blockExplorers.default.url] : [],
              },
            ],
          });
        } catch {/* ignore */}
      }
    }
    // Wait until wallet reports the configured chain id
    for (let i = 0; i < 15; i++) {
      const w = (window as any)?.ethereum;
      if (w?.chainId?.toLowerCase() === CHAIN_HEX) break;
      await sleep(200);
    }
  };

  // Load current round info
  useEffect(() => {
    (async () => {
      if (!publicClient) return;
      if (chainId !== appChain.id) return;
      try {
        const rid = await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: lottoAbi,
          functionName: "currentRoundId",
          args: [],
        }) as bigint;
        setRoundId(rid);

        // Get round info
        const round = await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: lottoAbi,
          functionName: "rounds",
          args: [rid],
        }) as any;
        setRoundInfo(round);

        // Determine current phase
        const now = Math.floor(Date.now() / 1000);
        const openTime = Number(round.openTime);
        const closeTime = Number(round.closeTime);
        const revealTime = Number(round.revealTime);

        if (now < openTime || now >= revealTime) {
          setCurrentPhase('closed');
        } else if (now >= openTime && now < closeTime) {
          setCurrentPhase('commit');
        } else if (now >= closeTime && now < revealTime) {
          setCurrentPhase('reveal');
        }
      } catch (err) {
        console.error("Failed to read round info:", err);
      }
    })();
  }, [publicClient, chainId]);

  // Load user's commits
  useEffect(() => {
    (async () => {
      if (!publicClient || !address || chainId !== appChain.id) return;
      try {
        const commits = await publicClient.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          abi: lottoAbi,
          functionName: "getMyCommits",
          args: [roundId, address],
        }) as any[];

        const userCommitData: UserCommit[] = [];
        
        // Load stored picks and nonces from localStorage
        const storedCommits = JSON.parse(localStorage.getItem(`commits_${roundId}_${address}`) || '[]');
        
        commits.forEach((commit, index) => {
          const stored = storedCommits.find((s: any) => s.commitment === commit.commitment);
          if (stored) {
            userCommitData.push({
              pick: stored.pick,
              nonce: stored.nonce,
              commitment: commit.commitment,
              revealed: commit.revealed,
              commitIndex: index
            });
          } else {
            userCommitData.push({
              pick: -1, // Unknown pick
              nonce: "",
              commitment: commit.commitment,
              revealed: commit.revealed,
              commitIndex: index
            });
          }
        });

        setUserCommits(userCommitData);
      } catch (err) {
        console.error("Failed to load user commits:", err);
      }
    })();
  }, [publicClient, address, chainId, roundId]);

  // Commit phase
  const submitCommit = async () => {
    if (!isConnected || !address) {
      alert("Connect wallet");
      return;
    }
    if (chainId !== appChain.id) {
      alert(`Switch to ${appChain.name}`);
      return;
    }
    if (pick < 0 || pick > 999 || Number.isNaN(pick)) {
      alert("Pick must be between 0 and 999");
      return;
    }

    try {
      setPending(true);
      await ensureOnBase();

      // Ensure USDC allowance and balance
      const erc20Abi = [
        { type: "function", name: "allowance", stateMutability: "view", inputs: [
          { name: "owner", type: "address" }, { name: "spender", type: "address" }
        ], outputs: [{ name: "", type: "uint256" }] },
        { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [
          { name: "spender", type: "address" }, { name: "amount", type: "uint256" }
        ], outputs: [{ name: "", type: "bool" }] },
        { type: "function", name: "balanceOf", stateMutability: "view", inputs: [
          { name: "account", type: "address" }
        ], outputs: [{ name: "", type: "uint256" }] },
      ] as const;

      const required = BigInt(ENTRY_USDC);
      const bal = await publicClient!.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;

      if (bal < required) {
        alert(
          `Insufficient USDC balance. You have ${Number(bal) / 10 ** USDC_DECIMALS} USDC, need ${ENTRY_USDC / 10 ** USDC_DECIMALS} USDC.\n\nOn localhost, import Hardhat Account #0 (pre-funded) into MetaMask or mint test USDC to your address.`
        );
        setPending(false);
        return;
      }

      const allowance = await publicClient!.readContract({
        address: USDC_ADDRESS as `0x${string}`,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, CONTRACT_ADDRESS as `0x${string}`],
      }) as bigint;

      if (allowance < required) {
        const approveAmount = 100n * (10n ** BigInt(USDC_DECIMALS)); // approve 100 USDC
        const tx = await writeContractAsync({
          address: USDC_ADDRESS as `0x${string}`,
          abi: erc20Abi as any,
          functionName: "approve",
          args: [CONTRACT_ADDRESS as `0x${string}`, approveAmount],
        });
        await publicClient!.waitForTransactionReceipt({ hash: tx });
      }

      const autoNonce = () => Math.floor(Math.random() * 1000000000).toString();
      const nonceToUse = (nonce && nonce.trim() !== "") ? nonce : autoNonce();
      if (!nonce || nonce.trim() === "") setNonce(nonceToUse);

      const commitment = generateCommitment(pick, nonceToUse);

      // Pre-fetch current commit count to derive new commitIndex
      const prevCount = await publicClient!.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: lottoAbi,
        functionName: "getMyCommitCount",
        args: [roundId, address!],
      }) as bigint;

      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: lottoAbi,
        functionName: "commitPick",
        args: [roundId, commitment],
      });
      await publicClient!.waitForTransactionReceipt({ hash });

      // Store pick and nonce locally
      const storedCommits = JSON.parse(localStorage.getItem(`commits_${roundId}_${address}`) || '[]');
      storedCommits.push({ pick, nonce: nonceToUse, commitment });
      localStorage.setItem(`commits_${roundId}_${address}`, JSON.stringify(storedCommits));

      // Prepare and store a reveal signature for relayer flow
      try {
        const { walletClient } = getClients();
        if (walletClient && address) {
          const commitIndex = Number(prevCount); // new commit sits at previous count index
          const encoded = encodeAbiParameters(
            [
              { type: 'address' },
              { type: 'uint256' },
              { type: 'uint256' },
              { type: 'address' },
              { type: 'uint16' },
              { type: 'uint256' },
              { type: 'uint256' },
            ],
            [
              CONTRACT_ADDRESS as `0x${string}`,
              BigInt(process.env.NEXT_PUBLIC_CHAIN_ID!),
              roundId,
              address as `0x${string}`,
              Number(pick),
              BigInt(nonceToUse),
              BigInt(commitIndex),
            ]
          );
          const msgHash = keccak256(encoded);
          const signature = await walletClient.signMessage({
            account: address as `0x${string}`,
            message: { raw: msgHash as `0x${string}` },
          });

          const queueKey = `revealQueue_${roundId}_${address}`;
          const queue = JSON.parse(localStorage.getItem(queueKey) || '[]');
          queue.push({ pick, nonce: nonceToUse, commitIndex, signature });
          localStorage.setItem(queueKey, JSON.stringify(queue));
        }
      } catch (e) {
        console.warn("Failed to generate/store reveal signature:", e);
      }

      alert("Commitment submitted! A reveal signature was prepared and saved for relayer.");

      // Refresh data
      await loadCommitments();
    } catch (err: any) {
      console.error(err);
      alert(err?.shortMessage ?? err?.message ?? "Failed to send transaction");
    } finally {
      setPending(false);
    }
  };

  // Reveal phase
  const submitReveal = async (commitData: UserCommit) => {
    if (!isConnected || !address) {
      alert("Connect wallet");
      return;
    }
    if (chainId !== appChain.id) {
      alert(`Switch to ${appChain.name}`);
      return;
    }
    if (commitData.pick === -1) {
      alert("Cannot reveal - pick data not found. Make sure you committed from this browser.");
      return;
    }

    try {
      setPending(true);
      await ensureOnBase();

      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: lottoAbi,
        functionName: "revealPick",
        args: [roundId, BigInt(commitData.pick), BigInt(commitData.nonce), BigInt(commitData.commitIndex)],
      });
      await publicClient!.waitForTransactionReceipt({ hash });

      alert("Pick revealed successfully!");

      // Refresh data
      await loadEntrants();
    } catch (err: any) {
      console.error(err);
      alert(err?.shortMessage ?? err?.message ?? "Failed to send transaction");
    } finally {
      setPending(false);
    }
  };

  // Reveal via user signature (relayer-friendly)
  const submitRevealViaSignature = async (commitData: UserCommit) => {
    if (!isConnected || !address) {
      alert("Connect wallet");
      return;
    }
    if (chainId !== appChain.id) {
      alert(`Switch to ${appChain.name}`);
      return;
    }
    if (commitData.pick === -1) {
      alert("Cannot reveal - pick data not found. Make sure you committed from this browser.");
      return;
    }

    try {
      setPending(true);
      await ensureOnBase();

      const queueKey = `revealQueue_${roundId}_${address}`;
      const queue: any[] = JSON.parse(localStorage.getItem(queueKey) || '[]');
      let entry = queue.find((q) => q.commitIndex === commitData.commitIndex && q.pick === commitData.pick);

      // If no stored signature, create one now
      if (!entry) {
        const { walletClient } = getClients();
        if (!walletClient) throw new Error("No wallet client available to sign");

        const encoded = encodeAbiParameters(
          [
            { type: 'address' },
            { type: 'uint256' },
            { type: 'uint256' },
            { type: 'address' },
            { type: 'uint16' },
            { type: 'uint256' },
            { type: 'uint256' },
          ],
          [
            CONTRACT_ADDRESS as `0x${string}`,
            BigInt(process.env.NEXT_PUBLIC_CHAIN_ID!),
            roundId,
            address as `0x${string}`,
            Number(commitData.pick),
            BigInt(commitData.nonce),
            BigInt(commitData.commitIndex),
          ]
        );
        const msgHash = keccak256(encoded);
        const signature = await walletClient.signMessage({
          account: address as `0x${string}`,
          message: { raw: msgHash as `0x${string}` },
        });
        entry = { pick: commitData.pick, nonce: commitData.nonce, commitIndex: commitData.commitIndex, signature };
      }

      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: lottoAbi,
        functionName: "revealPickFor",
        args: [roundId, address as `0x${string}`, BigInt(entry.pick), BigInt(entry.nonce), BigInt(entry.commitIndex), entry.signature],
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash });

      alert("Pick revealed via signature!");
      await loadEntrants();
    } catch (err: any) {
      console.error(err);
      alert(err?.shortMessage ?? err?.message ?? "Failed to reveal via signature");
    } finally {
      setPending(false);
    }
  };

  // Load commitments
  const loadCommitments = async () => {
    if (!publicClient || chainId !== appChain.id) return;
    try {
      const commitEvent = (lottoAbi as any[]).find(
        (x) => x.type === "event" && x.name === "Committed"
      );
      if (!commitEvent) return;

      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS as `0x${string}`,
        event: commitEvent as any,
        fromBlock: 0n,
        toBlock: "latest",
      });

      const parsed: Commitment[] = logs
        .map((log: any) => {
          const args = log?.args ?? {};
          const player = args.user as `0x${string}` | undefined;
          const commitment = args.commitment as string | undefined;
          const rMatch = (args.roundId as bigint | undefined) === roundId;

          if (!player || !commitment || !rMatch) return undefined;
          return { player, commitment, txHash: log.transactionHash as `0x${string}` };
        })
        .filter(Boolean) as Commitment[];

      setCommitments(parsed.reverse());
    } catch (err) {
      console.error("Failed to load commitments:", err);
    }
  };

  // Load entrants (revealed picks)
  const loadEntrants = async () => {
    if (!publicClient || chainId !== appChain.id) return;
    try {
      const revealEvent = (lottoAbi as any[]).find(
        (x) => x.type === "event" && x.name === "Revealed"
      );
      if (!revealEvent) {
        setEventsSupported(false);
        return;
      }

      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS as `0x${string}`,
        event: revealEvent as any,
        fromBlock: 0n,
        toBlock: "latest",
      });

      const parsed: Entrant[] = logs
        .map((log: any) => {
          const args = log?.args ?? {};
          const player = args.user as `0x${string}` | undefined;
          const pick = args.pick as bigint | undefined;
          const rMatch = (args.roundId as bigint | undefined) === roundId;

          if (!player || pick === undefined || !rMatch) return undefined;
          return { player, pick: Number(pick), txHash: log.transactionHash as `0x${string}` };
        })
        .filter(Boolean) as Entrant[];

      setEntrants(parsed.reverse());
      setEventsSupported(true);
    } catch (err) {
      console.error("Failed to load entrants:", err);
      setEventsSupported(false);
    }
  };

  // Load data when roundId changes
  useEffect(() => {
    loadCommitments();
    loadEntrants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, publicClient, chainId]);

  // Auto reveal via signature when the round is in reveal phase
  useEffect(() => {
    (async () => {
      if (currentPhase !== 'reveal') return;
      if (!isConnected || chainId !== appChain.id) return;
      if (pending || autoRevealTriggered) return;
      const unrevealed = userCommits.filter((c) => !c.revealed && c.pick !== -1);
      if (unrevealed.length === 0) return;
      setAutoRevealTriggered(true);
      for (const c of unrevealed) {
        try {
          await submitRevealViaSignature(c);
          await sleep(300);
        } catch (e) {
          console.warn('Auto reveal failed for commitIndex', c.commitIndex, e);
        }
      }
      await loadEntrants();
    })();
  }, [currentPhase, isConnected, chainId, pending, autoRevealTriggered, userCommits]);

  const notOnBase = isConnected && chainId !== appChain.id;

  const formatTime = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const inDemo = !HAS_ADDRESSES || DEMO_MODE || !CONTRACT_ADDRESS || !USDC_ADDRESS;

  if (inDemo) {
    // Fully interactive demo using local storage
    const demoAddr = getDemoAddress();
    const connectDemo = () => {
      const addr = setDemoAddress();
      alert(`Connected demo wallet: ${addr}`);
      // Refresh local UI state by forcing an update via state changes
      setRoundId(BigInt(demoCurrentRoundId()));
    };
    const disconnectDemo = () => {
      setDemoAddress("");
      alert("Disconnected demo wallet");
    };

    // Initialize round and load local data
    initDemoRound();
    const dRound = demoGetRound(Number(roundId));
    const phaseNow = (() => {
      const now = Math.floor(Date.now() / 1000);
      if (now < dRound.openTime || now >= dRound.revealTime) return "closed";
      if (now >= dRound.openTime && now < dRound.closeTime) return "commit";
      return "reveal";
    })();

    const loadDemoData = () => {
      const c = demoGetCommitments(Number(roundId));
      setCommitments(c.map((x) => ({ player: x.player as `0x${string}`, commitment: x.commitment, txHash: x.txHash as `0x${string}` })));
      const r = demoGetReveals(Number(roundId));
      setEntrants(r.map((x) => ({ player: x.player as `0x${string}`, pick: x.pick, txHash: x.txHash as `0x${string}` })));
      if (demoAddr) {
        const mine = demoGetMyCommits(Number(roundId), demoAddr);
        const storedCommits = JSON.parse(localStorage.getItem(`commits_${roundId}_${demoAddr}`) || '[]');
        const data: UserCommit[] = mine.map((m, idx) => {
          const stored = storedCommits.find((s: any) => s.commitment === m.commitment);
          return {
            pick: stored ? stored.pick : -1,
            nonce: stored ? stored.nonce : "",
            commitment: m.commitment,
            revealed: m.revealed,
            commitIndex: idx,
          };
        });
        setUserCommits(data);
      }
    };

    useEffect(() => {
      loadDemoData();
      const id = setInterval(() => loadDemoData(), 1000);
      return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [demoAddr, roundId]);

    const submitDemoCommit = async () => {
      if (!demoAddr) {
        alert("Connect demo wallet");
        return;
      }
      if (pick < 0 || pick > 999 || Number.isNaN(pick)) {
        alert("Pick must be between 0 and 999");
        return;
      }
      const autoNonce = () => Math.floor(Math.random() * 1000000000).toString();
      const nonceToUse = (nonce && nonce.trim() !== "") ? nonce : autoNonce();
      if (!nonce || nonce.trim() === "") setNonce(nonceToUse);
      const commitment = generateCommitment(pick, nonceToUse);
      const tx = demoCommitPick(Number(roundId), demoAddr, commitment);

      const storedCommits = JSON.parse(localStorage.getItem(`commits_${roundId}_${demoAddr}`) || '[]');
      storedCommits.push({ pick, nonce: nonceToUse, commitment });
      localStorage.setItem(`commits_${roundId}_${demoAddr}`, JSON.stringify(storedCommits));

      alert(`Commitment submitted (demo). tx: ${tx.slice(0,10)}...`);
      loadDemoData();
    };

    const submitDemoReveal = async (commitData: UserCommit) => {
      if (!demoAddr) {
        alert("Connect demo wallet");
        return;
      }
      if (commitData.pick === -1) {
        alert("Pick data not found. Make sure you committed from this browser.");
        return;
      }
      const tx = demoRevealPick(Number(roundId), demoAddr, Number(commitData.pick), commitData.nonce, commitData.commitIndex);
      alert(`Pick revealed (demo). tx: ${tx.slice(0,10)}...`);
      loadDemoData();
    };

    return (
      <div className="p-4 border rounded">
        <h3>Enter Round #{roundId.toString()} (Demo)</h3>

        {/* Connection */}
        {!demoAddr ? (
          <div style={{ marginBottom: 12 }}>
            <button onClick={connectDemo} className="button" style={{ marginRight: 8 }}>Connect Demo Wallet</button>
          </div>
        ) : (
          <div style={{ marginBottom: 12 }}>
            <span style={{ marginRight: 8 }}>{demoAddr}</span>
            <button onClick={disconnectDemo} className="button">Disconnect</button>
          </div>
        )}

        {/* Phase */}
        <div className="muted" style={{ marginBottom: 8 }}>
          Phase: {phaseNow === 'commit' ? 'Commit' : phaseNow === 'reveal' ? 'Reveal' : 'Closed'}
        </div>

        {/* Entry form */}
        <div>
          <label>
            Pick (0-999)
            <input type="number" min={0} max={999} value={pick} onChange={(e) => setPick(Number(e.target.value))} style={{ marginLeft: 8 }} />
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            Nonce
            <input type="text" value={nonce} onChange={(e) => setNonce(e.target.value)} placeholder="random if empty" style={{ marginLeft: 8 }} />
          </label>
          <button onClick={generateNonce} className="button" style={{ marginLeft: 8 }}>Random</button>
        </div>

        <div style={{ marginTop: 12 }}>
          <button onClick={submitDemoCommit} className="button cta" disabled={phaseNow !== 'commit'}>
            Commit (Demo)
          </button>
          {phaseNow !== 'commit' && (
            <span className="muted" style={{ marginLeft: 8 }}>Wait for commit window</span>
          )}
        </div>

        {/* My commits */}
        <div style={{ marginTop: 16 }}>
          <h4>My Commits</h4>
          {userCommits.length === 0 ? (
            <div>No commits yet.</div>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '8px', marginTop: 8 }}>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                {userCommits.map((commit, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    <div><strong>Commitment:</strong> {commit.commitment.slice(0, 10)}...</div>
                    {commit.pick !== -1 ? (
                      <div><strong>Pick:</strong> {commit.pick}</div>
                    ) : (
                      <div style={{ color: 'red' }}>Pick data not found (committed from different browser?)</div>
                    )}
                    <div><strong>Status:</strong> {commit.revealed ? 'Revealed' : 'Not Revealed'}</div>
                    {!commit.revealed && commit.pick !== -1 && (
                      <button onClick={() => submitDemoReveal(commit)} className="button" style={{ marginTop: 6 }} disabled={phaseNow !== 'reveal'}>
                        Reveal (Demo)
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Commitments list */}
        <div style={{ marginTop: 24 }}>
          <h4>Commitments (Round #{roundId.toString()})</h4>
          {commitments.length === 0 ? (
            <div>No commitments yet.</div>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '8px', marginTop: 8 }}>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                {commitments.map((c, i) => (
                  <li key={c.txHash + i} style={{ marginBottom: 4 }}>
                    <code>{c.player}</code> — commitment <strong>{c.commitment.slice(0, 10)}...</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Revealed Entrants list */}
        <div style={{ marginTop: 24 }}>
          <h4>Revealed Picks (Round #{roundId.toString()})</h4>
          {entrants.length === 0 ? (
            <div>No picks revealed yet.</div>
          ) : (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '8px', marginTop: 8 }}>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                {entrants.map((e, i) => (
                  <li key={e.txHash + i} style={{ marginBottom: 4 }}>
                    <code>{e.player}</code> — pick <strong>{e.pick}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded">
      <h3>Enter Round #{roundId.toString()}</h3>


      {/* Connection */}
      {!isConnected ? (
        <div style={{ marginBottom: 12 }}>
          {injectedConnector ? (
            <button
              onClick={() => connect({ connector: injectedConnector, chainId: appChain.id })}
              disabled={connectStatus === "pending"}
              className="button"
              style={{ marginRight: 8 }}
            >
              {connectStatus === "pending" ? "Connecting..." : `Connect MetaMask (${appChain.name})`}
            </button>
          ) : (
            <span>No injected wallet found. Install MetaMask and refresh.</span>
          )}
          {connectError && (
            <div style={{ color: "crimson", marginTop: 8 }}>
              {(connectError as Error).message}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8 }}>{address}</span>
          <button className="button" onClick={() => disconnect()}>Disconnect</button>
        </div>
      )}

      {/* Switch notice */}
      {notOnBase && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ marginRight: 8 }}>Wrong network</span>
          <button
            onClick={() => switchChain({ chainId: appChain.id })}
            disabled={switchStatus === "pending"}
            className="button"
          >
            {switchStatus === "pending" ? "Switching..." : `Switch to ${appChain.name}`}
          </button>
        </div>
      )}

      {/* Commit Phase UI */}
      {currentPhase === 'commit' && (
        <div style={{ marginTop: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Row with Pick and Nonce side-by-side */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: 4, textAlign: 'center', fontSize: 13 }}>
                Pick your number (0–999):
              </label>
              <input
                type="number"
                min={0}
                max={999}
                placeholder="e.g. 123"
                value={Number.isNaN(pick) ? "" : pick}
                onChange={(e) => setPick(Number(e.target.value))}
                style={{ padding: "6px 10px", width: "100px" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontWeight: 500, marginBottom: 4, textAlign: 'center', fontSize: 13 }}>
                Nonce (Write this down!):
              </label>
              <input
                type="text"
                placeholder="Leave blank to auto-generate"
                value={nonce}
                onChange={(e) => setNonce(e.target.value)}
                style={{ padding: "6px 10px", width: "180px" }}
              />
              <div style={{ fontSize: 12, color: '#666', marginTop: 6, maxWidth: 320 }}>
                If left blank, a random nonce is generated. Your reveal signature is prepared after commit and cached locally for one-click reveal. Keep your nonce safe if using a different device.
              </div>
            </div>
          </div>
          <button
            onClick={submitCommit}
            disabled={!isConnected || notOnBase || pending}
            className="button cta"
            style={{ display: 'block', margin: '0 auto', padding: '10px 24px', fontSize: 18, minWidth: 220 }}
          >
            {pending ? "Submitting..." : "Enter (5 USDC)"}
          </button>
        </div>
      )}

      {/* Reveal Phase UI */}
      {currentPhase === 'reveal' && (
        <div style={{ marginTop: 16 }}>
          <h4>Reveal Phase - Reveal Your Picks</h4>
          {userCommits.length === 0 ? (
            <div>No commits found for this round.</div>
          ) : (
            <div>
              {userCommits.map((commit, index) => (
                <div key={index} style={{ marginBottom: 8, padding: 8, border: '1px solid #ddd', borderRadius: 4 }}>
                  <div><strong>Commitment:</strong> {commit.commitment.slice(0, 10)}...</div>
                  {commit.pick !== -1 ? (
                    <div><strong>Pick:</strong> {commit.pick}</div>
                  ) : (
                    <div style={{ color: 'red' }}>Pick data not found (committed from different browser?)</div>
                  )}
                  <div><strong>Status:</strong> {commit.revealed ? 'Revealed' : 'Not Revealed'}</div>
                  {/* Prefer signature-based reveal for single-click UX */}
                  {!commit.revealed && commit.pick !== -1 && (
                    <button
                      onClick={() => submitRevealViaSignature(commit)}
                      disabled={pending}
                      className="button cta"
                      style={{ marginTop: 4 }}
                    >
                      {pending ? "Revealing..." : "Reveal"}
                    </button>
                  )}
                  {/* Optional fallback: manual reveal if signature fails */}
                  {!commit.revealed && commit.pick !== -1 && (
                    <button
                      onClick={() => submitReveal(commit)}
                      disabled={pending}
                      className="button"
                      style={{ marginTop: 4, marginLeft: 8 }}
                    >
                      {pending ? "Revealing..." : "Reveal (manual)"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Closed Phase */}
      {currentPhase === 'closed' && (
        <div style={{ marginTop: 16 }}>
          <h4>Round Closed</h4>
          <div>This round is not accepting commits or reveals.</div>
        </div>
      )}

      {/* Commitments list */}
      <div style={{ marginTop: 24 }}>
        <h4>Entries (Round #{roundId.toString()})</h4>
        {commitments.length === 0 ? (
          <div>No commitments yet.</div>
        ) : (
          <div style={{ 
            maxHeight: '200px', 
            overflowY: 'auto', 
            border: '1px solid #e0e0e0', 
            borderRadius: '4px', 
            padding: '8px',
            marginTop: 8
          }}>
            <ul style={{ margin: 0, paddingLeft: '16px' }}>
              {commitments.map((c, i) => (
                <li key={c.txHash + i} style={{ marginBottom: 4 }}>
                  <code>{c.player}</code> — commitment <strong>{c.commitment.slice(0, 10)}...</strong>{" "}
                  <a
                    href={appChain.blockExplorers?.default?.url ? `${appChain.blockExplorers.default.url}/tx/${c.txHash}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: 6 }}
                  >
                    (tx)
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Revealed Entrants list */}
      <div style={{ marginTop: 24 }}>
        <h4>Revealed Picks (Round #{roundId.toString()})</h4>
        {!eventsSupported ? (
          <div style={{ color: "gray" }}>
            Couldn't find reveal events in the ABI.
          </div>
        ) : entrants.length === 0 ? (
          <div>No picks revealed yet.</div>
        ) : (
          <div style={{ 
            maxHeight: '200px', 
            overflowY: 'auto', 
            border: '1px solid #e0e0e0', 
            borderRadius: '4px', 
            padding: '8px',
            marginTop: 8
          }}>
            <ul style={{ margin: 0, paddingLeft: '16px' }}>
              {entrants.map((e, i) => (
                <li key={e.txHash + i} style={{ marginBottom: 4 }}>
                  <code>{e.player}</code> — pick <strong>{e.pick}</strong>{" "}
                  <a
                    href={appChain.blockExplorers?.default?.url ? `${appChain.blockExplorers.default.url}/tx/${e.txHash}` : undefined}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginLeft: 6 }}
                  >
                    (tx)
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
