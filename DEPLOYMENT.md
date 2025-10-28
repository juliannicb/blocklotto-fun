# BlockLotto – Fresh Deployment (Base Sepolia)

This guide deploys the smart contracts to Base Sepolia and wires your frontend to the new addresses.

## Prerequisites
- Node.js and pnpm installed.
- A funded Base Sepolia wallet private key with test ETH.
- Set up `.env` at repo root (copy from `.env.example`).

## 1) Configure environment
Create a `.env` file at repo root:

```
BASE_SEPOLIA_RPC=https://sepolia.base.org
PRIVATE_KEY=0x<your-funded-private-key>
USDC_SEPOLIA=<existing USDC address or mock>
FEE_TREASURY=0x<your-fee-treasury-address>
# Optional VRF (skip if unknown)
VRF_COORDINATOR=
VRF_KEY_HASH=
VRF_SUB_ID=
BASESCAN_API_KEY=<optional>
```

Notes:
- If you do not have a canonical USDC address on Base Sepolia, deploy a mock first:
  - `npx hardhat run scripts/deploy-mock-usdc.ts --network baseSepolia`
  - Copy the printed `Mock USDC` address into `USDC_SEPOLIA`.

## 2) Compile
```
pnpm build
```

## 3) Deploy BlockLotto
```
pnpm deploy:base-sepolia
```
The script prints `BlockLotto: 0x...` and creates Round #1.

## 4) Verify (optional)
If you set `BASESCAN_API_KEY`, you can verify:
```
npx hardhat run scripts/verify.ts --network baseSepolia 0x<blocklotto-address>
```

## 5) Wire up the frontend
Set `frontend/.env` based on `frontend/.env.example`:
```
NEXT_PUBLIC_RPC_URL=https://sepolia.base.org
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_CONTRACT_ADDRESS=0x<blocklotto-address>
NEXT_PUBLIC_USDC_ADDRESS=0x<usdc-or-mock-address>
NEXT_PUBLIC_DEMO_MODE=false
```

For Vercel, add these env vars in Project Settings (Production & Preview), then redeploy.

### Vercel Project Settings (Live Mode)
- Root Directory: `frontend`
- Framework Preset: Next.js
- Build Command: `npm run build`
- Environment Variables (Production & Preview):
  - `NEXT_PUBLIC_DEMO_MODE=false`
  - `NEXT_PUBLIC_CHAIN_ID=84532`
  - `NEXT_PUBLIC_RPC_URL=https://sepolia.base.org`
  - `NEXT_PUBLIC_CONTRACT_ADDRESS=0x<blocklotto-address>`
  - `NEXT_PUBLIC_USDC_ADDRESS=0x<usdc-or-mock-address>`

Important:
- Ensure `frontend/.env.local` is not used in Vercel (it’s ignored by .gitignore and should remain empty in the cloud). If you previously committed a local env, remove it from Git and redeploy.
- After changing envs, click “Redeploy” → “Clear build cache and redeploy” to guarantee the latest bundle is served.

### Demo Mode on Vercel

You can deploy the frontend without live contracts using demo mode — the app will be fully interactive using an in-browser mock store.

- Use `frontend/.env.demo` as a template. Either:
  - Copy locally: `cp frontend/.env.demo frontend/.env.local` and run `pnpm -C frontend dev`.
  - Or in Vercel → Settings → Environment Variables, add:
    - `NEXT_PUBLIC_DEMO_MODE=true`
    - `NEXT_PUBLIC_CHAIN_ID=84532`
    - `NEXT_PUBLIC_RPC_URL=https://sepolia.base.org`
    - Leave `NEXT_PUBLIC_CONTRACT_ADDRESS` and `NEXT_PUBLIC_USDC_ADDRESS` empty.

What works in demo mode:
- Connect a “Demo Wallet” (no blockchain required)
- Commit picks during the commit window (2 minutes)
- Reveal picks during the reveal window (2 minutes)
- Auto draw and settle after reveal closes (random winning number)
- See commitments, revealed entrants, winners, and prize amounts

All state is stored in `localStorage` per browser/tab, so it is ephemeral and isolated for each visitor.

## 6) Post-deploy operations
- To create additional rounds:
  - `npx hardhat run scripts/createRound.ts --network baseSepolia 0x<blocklotto-address>`
- To configure VRF once you have parameters:
  - call `setVRF(coordinator, keyHash, subId)` from the owner wallet.