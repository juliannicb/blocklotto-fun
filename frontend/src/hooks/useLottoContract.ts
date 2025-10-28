// frontend/src/hooks/useLottoContract.ts
import { createPublicClient, createWalletClient, custom, http, type Abi } from "viem";
import { appChain } from "@/lib/wagmi";
// Use the central BlockLotto ABI that includes commit/reveal functions
import abi from "@/lib/BlockLotto.json"; // ensure tsconfig enables resolveJsonModule

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;

/** Typed ABI used across the app */
export const lottoAbi = abi as Abi;

export function getClients() {
  const publicClient = createPublicClient({
    chain: appChain,
    transport: http(RPC_URL),
  });

  const walletClient =
    typeof window !== "undefined" && (window as any).ethereum
      ? createWalletClient({
          chain: appChain,
          transport: custom((window as any).ethereum),
        })
      : undefined;

  return { publicClient, walletClient };
}
