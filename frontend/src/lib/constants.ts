export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`; // <-- add this env var
export const USDC_DECIMALS = 6;
export const ENTRY_USDC = 5 * 10 ** USDC_DECIMALS; // 5 USDC
