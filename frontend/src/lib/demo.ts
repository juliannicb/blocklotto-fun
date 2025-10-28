// Simple in-browser demo store to simulate the BlockLotto app
// This enables a fully interactive mock without any blockchain.

type Round = {
  openTime: number;
  closeTime: number;
  revealTime: number;
  winning: number | null;
  totalDeposits: number; // USDC with 6 decimals
  carry1: number; // carryover pool (simplified)
  drawn: boolean;
  settled: boolean;
};

type Commit = {
  roundId: number;
  user: string; // 0x...
  commitment: string; // keccak256
  revealed: boolean;
  stake: number; // in USDC 6d
};

type Reveal = {
  roundId: number;
  user: string;
  pick: number;
  txHash: string;
};

type DemoState = {
  currentRoundId: number;
  rounds: Record<number, Round>;
  commits: Commit[];
  reveals: Reveal[];
  demoAddress?: string;
};

const KEY = "blocklotto_demo_state";
const USDC_6D = 10 ** 6;
const ENTRY_USDC = 5 * USDC_6D;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function randomTx(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

function read(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    currentRoundId: 1,
    rounds: {},
    commits: [],
    reveals: [],
  };
}

function write(s: DemoState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
}

export function initDemoRound(): DemoState {
  const s = read();
  const id = s.currentRoundId;
  const r = s.rounds[id];
  if (!r) {
    const open = nowSec();
    const close = open + 120; // 2 min commit
    const reveal = close + 120; // 2 min reveal
    s.rounds[id] = {
      openTime: open,
      closeTime: close,
      revealTime: reveal,
      winning: null,
      totalDeposits: 0,
      carry1: 0,
      drawn: false,
      settled: false,
    };
    write(s);
  }
  tick();
  return read();
}

export function tick() {
  const s = read();
  const id = s.currentRoundId;
  const r = s.rounds[id];
  if (!r) return;
  const t = nowSec();
  // Auto-draw right after reveal window closes
  if (t >= r.revealTime && !r.drawn) {
    const winning = Math.floor(Math.random() * 1000);
    r.winning = winning;
    r.drawn = true;
    write(s);
  }
  // Auto-settle shortly after drawing
  if (r.drawn && !r.settled) {
    r.settled = true;
    write(s);
  }
}

export function getCurrentRoundId(): number {
  const s = initDemoRound();
  return s.currentRoundId;
}

export function getRound(id: number): Round {
  const s = initDemoRound();
  const r = s.rounds[id];
  return r;
}

export function setDemoAddress(addr?: string): string {
  const s = read();
  const address = addr ?? `0xDEMO${Math.random().toString(16).slice(2, 8).padEnd(8, "0")}`.padEnd(42, "0");
  s.demoAddress = address;
  write(s);
  return address;
}

export function getDemoAddress(): string | undefined {
  const s = read();
  return s.demoAddress;
}

export function getMyCommits(roundId: number, user: string): { commitment: string; revealed: boolean }[] {
  const s = initDemoRound();
  return s.commits.filter((c) => c.roundId === roundId && c.user.toLowerCase() === user.toLowerCase())
    .map((c) => ({ commitment: c.commitment, revealed: c.revealed }));
}

export function commitPick(roundId: number, user: string, commitment: string): string {
  const s = initDemoRound();
  s.commits.push({ roundId, user, commitment, revealed: false, stake: ENTRY_USDC });
  const r = s.rounds[roundId];
  r.totalDeposits += ENTRY_USDC;
  write(s);
  return randomTx();
}

export function revealPick(roundId: number, user: string, pick: number, nonce: number | string, commitIndex: number): string {
  const s = initDemoRound();
  const mine = s.commits.filter((c) => c.roundId === roundId && c.user.toLowerCase() === user.toLowerCase());
  const target = mine[commitIndex];
  if (!target) throw new Error("Commit not found");
  // Verify commitment matches (same as UI: keccak256(uint16 pick, uint256 nonce))
  const expected = window.crypto ? undefined : undefined; // no hashing here; trust client-side pairing
  // For simplicity in demo, we assume UI only reveals for matching commitIndex
  target.revealed = true;
  const tx = randomTx();
  s.reveals.push({ roundId, user, pick, txHash: tx });
  write(s);
  return tx;
}

export function getCommitments(roundId: number): { player: string; commitment: string; txHash: string }[] {
  const s = initDemoRound();
  const commits = s.commits.filter((c) => c.roundId === roundId);
  // Mock tx hash per commit by hashing the triplet via deterministic string
  return commits.map((c, i) => ({ player: c.user, commitment: c.commitment, txHash: randomTx() }));
}

export function getReveals(roundId: number): { player: string; pick: number; txHash: string }[] {
  const s = initDemoRound();
  return s.reveals.filter((r) => r.roundId === roundId).map((r) => ({ player: r.user, pick: r.pick, txHash: r.txHash }));
}

export function getWinners(roundId: number): { first: string[]; second: string[]; third: string[] } {
  const s = initDemoRound();
  const r = s.rounds[roundId];
  const winning = r.winning;
  if (winning === null) return { first: [], second: [], third: [] };
  const entries = s.reveals.filter((x) => x.roundId === roundId);
  const first = entries.filter((e) => e.pick === winning).map((e) => e.user);
  const second = entries.filter((e) => e.pick % 100 === winning % 100).map((e) => e.user);
  const third = entries.filter((e) => e.pick % 10 === winning % 10).map((e) => e.user);
  return { first, second, third };
}

export function getPrizes(roundId: number) {
  const r = getRound(roundId);
  const totalDeposits = r.totalDeposits / USDC_6D;
  return {
    totalDeposits,
    first: totalDeposits * 0.7,
    second: totalDeposits * 0.15,
    third: totalDeposits * 0.05,
  };
}