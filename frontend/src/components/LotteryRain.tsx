import React, { useEffect, useRef, useState } from "react";

interface DropSpec {
  id: number;
  left: string;
  size: number;
  delay: string;
  duration: string;
  number: number;
  drift: string;
  ttl: number; // ms until animation finishes
}

export default function LotteryRain({ count = 28 }: { count?: number }) {
  const [drops, setDrops] = useState<DropSpec[]>([]);
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    const spawnOne = () => {
      const left = `${Math.random() * 100}%`;
      const size = Math.round(26 + Math.random() * 44);
      const delaySec = Math.random() * 1.2; // faster stagger
      const durationSec = 2.2 + Math.random() * 2.6; // faster fall-through time
      const number = Math.floor(Math.random() * 1000); // 0-999 range
      const drift = `${(Math.random() - 0.5) * 40}px`;
      const id = Date.now() + Math.random();

      const drop: DropSpec = {
        id,
        left,
        size,
        delay: `${delaySec}s`,
        duration: `${durationSec}s`,
        number,
        drift,
        ttl: (delaySec + durationSec) * 1000,
      };

      setDrops((prev) => [...prev, drop]);
    };

    // Seed initial drops
    for (let i = 0; i < count; i++) {
      spawnOne();
    }

    return () => {
      setDrops([]);
    };
  }, [count]);

  return (
    <div
      className="fall-stage"
      suppressHydrationWarning
      style={{ position: "absolute", left: "36%", right: 0, width: "64%", pointerEvents: "none" }}
    >
      {drops.map((d) => (
        <div
          key={d.id}
          className="number"
          style={{
            left: d.left,
            // @ts-ignore custom props used in CSS
            "--size": `${d.size}px`,
            // @ts-ignore
            "--delay": d.delay,
            // @ts-ignore
            "--duration": d.duration,
            // @ts-ignore
            "--drift": d.drift,
            // @ts-ignore
            "--ground": `10px`,
            fontSize: d.size * 0.5,
          } as React.CSSProperties}
        >
          {d.number}
        </div>
      ))}
    </div>
  );
}