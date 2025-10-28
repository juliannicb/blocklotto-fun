import RoundStatus from "@/components/RoundStatus";
import EnterForm from "@/components/EnterForm";
import ClaimPanel from "@/components/ClaimPanel";
import Logo from "@/components/Logo";
import LotteryRain from "@/components/LotteryRain";

export default function Home() {
  return (
    <main>
      {/* Hero: logo on left, falling numbers on right */}
      <section className="section section-hero container">
        {/* Background bouncing balls across entire hero */}
        <div className="hero-bg">
          <LotteryRain />
        </div>
        <div className="hero-grid">
          <div>
            <Logo />
            {/* Description moved below hero as a banner */}
          </div>
        </div>
      </section>

      {/* Hero banner description under hero, stretched and color-matched to buttons */}
      <section className="section section-tight container" style={{ marginTop: -8 }}>
        <p className="hero-banner-text">
          The Fair Blockchain Lottery. Choose the correct random number between 0 and 999 and win 70% of all deposits. 5 USDC per Entry. You can enter multiple times.
        </p>
      </section>

      {/* Dapp panels */}
      <section className="section section-tight container" style={{ marginTop: -6 }}>
        <div className="cards-grid-new">
          <div className="card panel">
            <RoundStatus />
          </div>
          <div className="card panel" id="enter">
            <EnterForm />
          </div>
          <div className="card panel">
            <ClaimPanel />
          </div>
        </div>
      </section>

      <section className="section section-tight container" style={{ marginTop: -4 }}>
        <p className="muted">Built on Base Sepolia • USDC • Provably fair via on-chain finality</p>
      </section>

    </main>
  );
}
