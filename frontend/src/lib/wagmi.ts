// src/lib/wagmi.ts
import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";

// Provide safe defaults so builds don’t fail if env vars are missing
const DEFAULT_RPC = "https://sepolia.base.org"; // public Base Sepolia RPC
const DEFAULT_CHAIN_ID = 84532; // Base Sepolia chain id

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? DEFAULT_RPC;
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? String(DEFAULT_CHAIN_ID));
export const IS_LOCAL = CHAIN_ID === 31337;

export const appChain = defineChain({
  id: CHAIN_ID,
  name: IS_LOCAL ? "Localhost" : "Base Sepolia",
  network: IS_LOCAL ? "localhost" : "base-sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: IS_LOCAL ? "Local" : "Basescan", url: IS_LOCAL ? "" : "https://sepolia.basescan.org" },
  },
});

export const config = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: {
    [appChain.id]: http(RPC_URL),
  },
  ssr: true,
});
