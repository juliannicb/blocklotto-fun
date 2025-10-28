// Addresses (may be undefined in demo mode)
export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}` | undefined;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}` | undefined;

// Demo mode if explicitly enabled or if addresses are missing
export const DEMO_MODE = (process.env.NEXT_PUBLIC_DEMO_MODE === "true") || !CONTRACT_ADDRESS || !USDC_ADDRESS;
export const HAS_ADDRESSES = !!(CONTRACT_ADDRESS && USDC_ADDRESS);

export const USDC_DECIMALS = 6;
export const ENTRY_USDC = 5 * 10 ** USDC_DECIMALS; // 5 USDC
