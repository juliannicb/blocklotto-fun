import Logo from "@/components/Logo";

export default function RulesPage() {
  return (
    <main className="container section" style={{ maxWidth: 900 }}>
      <Logo />
      <h1 style={{ color: "var(--teal)", marginTop: 8 }}>Game Rules</h1>
      <p className="lead hero-description" style={{ marginTop: 6, color: "var(--teal-2)" }}>
        A transparent, on-chain lottery with automatic reveal and claimless USDC payouts.
      </p>

      

      <div className="card panel" style={{ marginTop: 16 }}>
        <h3>How to Play — Step by Step</h3>
        <ol>
          <li>Connect your wallet.</li>
          <li>Select the correct network: Base Sepolia (testnet) or Localhost 8545 (development).</li>
          <li>Ensure you have USDC (6 decimals). Each entry costs 5 USDC. On first use, your wallet may show a low balance; top up test USDC (testnet) or use local test USDC (localhost).</li>
          <li>During the Commit phase (20 hours), choose a number between 0–999. The app auto‑generates a nonce (or you can provide one), computes a commitment hash, and submits it on‑chain.</li>
          <li>After a successful commit, the app generates and locally caches a reveal signature tied to your entry for a one‑click, single‑phase experience later.</li>
          <li>If prompted, approve USDC for spending. This one‑time approval authorizes the lottery contract to pull 5 USDC per entry.</li>
          <li>Submit additional entries if you want. Each commit costs 5 USDC and remains hidden until reveal.</li>
          <li>When the Reveal phase (4 hours) opens, the app automatically reveals your committed entries using the cached signature—no click needed. If the signature is missing (e.g., you switched devices), use the “Reveal (manual)” fallback.</li>
          <li>After reveal ends, the round requests a verifiable random number and settles. The winning number is published on the round page.</li>
          <li>Prizes split as 70% (exact), 15% (closest non‑exact), 5% (second‑closest), with a 10% platform fee. If there are no exact winners, only the first‑prize pool rolls over to the next round.</li>
          <li>Payouts are automatic: after settlement, winnings are sent directly to winners’ wallets via a relayer calling <code>claimFor</code>. No claim button or action required.</li>
        </ol>
        <p className="muted" style={{ marginTop: 8 }}>
          Troubleshooting: “commit not open” or “reveal not open” indicates you’re outside the allowed window. “insufficient balance/allowance” means you need 5 USDC and a one‑time approval. Auto‑reveal requires your wallet to be connected on the device that holds the cached signature; if you switched devices, use manual reveal or re‑sign. If transactions fail, confirm your wallet network and try a hard refresh.
        </p>

        <h3 style={{ marginTop: 16 }}>Phases</h3>
        <ul>
          <li><strong>Commit (20 hours)</strong>: Submit a hidden commitment to your pick. Entries are accepted only during this window.</li>
          <li><strong>Reveal (4 hours)</strong>: The app auto‑reveals committed entries using your cached signature. Manual reveal is available if the signature isn’t found.</li>
          <li><strong>Settlement</strong>: After reveal ends, randomness is requested and the round settles. Winnings are paid out automatically.</li>
        </ul>

        <h3 style={{ marginTop: 16 }}>Commit–Reveal Basics</h3>
        <ul>
          <li><strong>Why commit–reveal?</strong> Prevents last‑minute copying. Picks stay hidden until you reveal.</li>
          <li><strong>Commit</strong>: Choose a number (0–999). A nonce is auto‑generated (or provided by you). The UI computes <code>keccak256(pick, nonce)</code> and submits the commitment on‑chain.</li>
          <li><strong>Reveal</strong>: The UI prefers a saved, device‑local signature to auto‑reveal your pick during the reveal window. A manual reveal is available as a fallback.</li>
          <li><strong>Missed reveal</strong>: Entries not revealed before the window closes are ineligible for prizes.</li>
          <li><strong>Multiple entries</strong>: You can commit multiple times. Reveal each entry during the reveal phase.</li>
          <li><strong>First‑time approval</strong>: The first entry prompts an ERC20 approval so the contract can pull 5 USDC per entry.</li>
          <li><strong>Common errors</strong>: “commit not open” or “reveal not open” indicate you’re outside the allowed window; “insufficient allowance/balance” indicates USDC approval/balance issues.</li>
        </ul>

        <h3 style={{ marginTop: 16 }}>Prizes</h3>
        <ul>
          <li><strong>1st prize (exact match)</strong>: 70% of total deposits.</li>
          <li><strong>2nd prize (closest non‑exact picks)</strong>: 15% of total deposits split across picks at the minimal distance from the winning number.</li>
          <li><strong>3rd prize (second‑closest picks)</strong>: 5% of total deposits split across picks at the second‑minimal distance from the winning number.</li>
          <li><strong>Platform fee</strong>: 10% to the operations treasury.</li>
          <li><strong>Rollover</strong>: If there are no exact winners, only the 1st‑prize pool rolls over to the next round.</li>
          <li><strong>Split mechanics</strong>: 2nd/3rd prizes are distributed proportionally to stake on all picks at the minimal and second‑minimal distances from the winning number.</li>
        </ul>

        <h3 style={{ marginTop: 16 }}>Round Lifecycle</h3>
        <ul>
          <li><strong>Open</strong>: Round opens; entries accepted during the 20‑hour commit window.</li>
          <li><strong>Reveal</strong>: 4‑hour window to reveal each committed pick.</li>
          <li><strong>Randomness</strong>: After reveal, the contract requests a verifiable random number (VRF). In local dev, a mock is used.</li>
          <li><strong>Settlement</strong>: Pools are allocated and the winning number is published; the round is marked settled.</li>
          <li><strong>Auto payout</strong>: A relayer calls <code>claimFor</code> on behalf of winners to transfer USDC directly to their wallets. Anyone can trigger <code>claimFor</code> if needed.</li>
        </ul>

        <h3 style={{ marginTop: 16 }}>Network & Token</h3>
        <ul>
          <li><strong>Networks</strong>: Base Sepolia (testnet) and Localhost (development).</li>
          <li><strong>Token</strong>: USDC with 6 decimals. A Mock USDC is used locally.</li>
          <li><strong>Entry cost</strong>: Exactly 5 USDC per entry (each commit).</li>
        </ul>

        <h3 style={{ marginTop: 16 }}>Important Notes</h3>
        <ul>
          <li>Do not share your private key or seed phrase with anyone.</li>
          <li>Ensure you are connected to the correct network before transacting.</li>
          <li>Transactions are final once confirmed on-chain.</li>
          <li>The UI hides picks and shows commitments/entries without revealing chosen numbers.</li>
          <li>Auto‑reveal relies on a locally cached signature and nonce. If you change devices or clear data, use manual reveal or re‑sign during the reveal window.</li>
        </ul>

        <p className="muted" style={{ marginTop: 16 }}>
          This deployment may be used for development and testing. Addresses, parameters, and UI may change.
        </p>
      </div>

      <div style={{ marginTop: 16 }}>
        <a href="/" className="button">Back to Home</a>
      </div>
    </main>
  );
}