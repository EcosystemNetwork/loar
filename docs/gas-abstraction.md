# Gas Abstraction

Platform-sponsored gas for key user actions via thirdweb's ERC-4337 account abstraction.

## Overview

LOAR uses thirdweb's built-in paymaster to sponsor gas fees for high-value platform actions. This reduces friction for new users (no ETH needed to mint their first NFT) and encourages governance participation (free voting).

Users with external wallets (MetaMask, Coinbase Wallet, etc.) retain their EOA and pay gas normally for non-sponsored actions. In-app wallet users get a smart account that routes all sponsored actions through the paymaster.

## What's Sponsored

| Action            | Function Names                                                         | Rationale                                  |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------------------ |
| Minting           | `mint`, `safeMint`, `mintNode`, `mintEpisode`, `mintNFT`, `createNode` | Core creative loop must be frictionless    |
| Voting            | `vote`, `castVote`, `submitVote`                                       | Encourage governance participation         |
| Universe creation | `createUniverse`, `deployUniverse`                                     | Onboarding funnel — first universe is free |
| Entity creation   | `createEntity`                                                         | Worldbuilding studio actions               |

## What's NOT Sponsored

| Action                                 | Reason                                   |
| -------------------------------------- | ---------------------------------------- |
| Token swaps (`swap`)                   | Financial action — user should bear cost |
| Transfers (`transfer`, `transferFrom`) | Financial action                         |
| Approvals (`approve`)                  | User-initiated token permission          |
| Buy/Sell (`buy`, `sell`)               | Marketplace transactions                 |
| Any unlisted function                  | Default is non-sponsored                 |

## Configuration

### 1. Get a thirdweb secret key

1. Go to [thirdweb.com/dashboard](https://thirdweb.com/dashboard)
2. Navigate to **API Keys** (or **Settings > API Keys**)
3. Create a key or use an existing one
4. Copy the **Secret Key** (not the Client ID)

### 2. Set the environment variable

```bash
# In .env (root)
VITE_THIRDWEB_SECRET_KEY=your-secret-key-here
```

### 3. Configure dashboard policies (production)

In the thirdweb dashboard, configure allowlists to restrict which contracts and methods can be sponsored:

- **Allowed contracts**: Only your deployed contract addresses
- **Allowed chains**: Only Base (8453) for mainnet, Base Sepolia (84532) for testnet
- **Spending limits**: Set daily/monthly gas credit caps

### 4. Enable account abstraction on ConnectButton

In `wallet-connect-button.tsx`, add the `accountAbstraction` prop:

```tsx
import { getConnectButtonAAConfig } from '@/lib/paymaster';

<ConnectButton
  client={thirdwebClient}
  accountAbstraction={getConnectButtonAAConfig()}
  // ... existing props
/>;
```

This causes in-app wallet users to automatically get a smart account. External wallet users are unaffected.

## Architecture

```
User action (e.g., mint)
    |
    v
useSponsoredTransaction hook
    |
    +-- Is paymaster configured? (VITE_THIRDWEB_SECRET_KEY set?)
    |   |
    |   No --> Normal transaction (user pays gas)
    |   |
    |   Yes
    |   |
    +-- Is this a sponsored action? (functionName in SPONSORED_ACTIONS?)
    |   |
    |   No --> Normal transaction (user pays gas)
    |   |
    |   Yes
    |   |
    +-- Attempt sponsored tx via thirdweb paymaster
        |
        +-- Success --> wasSponsored = true
        |
        +-- Failure --> Fall back to normal tx (user pays gas)
```

## Cost Implications

### Estimating spend

Each sponsored transaction costs the platform the gas fee that the user would have paid. On Base L2, this is typically:

- **Minting**: ~0.0001-0.001 ETH ($0.20-$2.00 at $2000/ETH)
- **Voting**: ~0.00005-0.0002 ETH ($0.10-$0.40)
- **Universe creation**: ~0.001-0.005 ETH ($2.00-$10.00)

### Controlling costs

1. **thirdweb dashboard limits**: Set daily/monthly spending caps
2. **SPONSORED_ACTIONS set**: Remove actions from `paymaster.ts` to stop sponsoring them
3. **Disable entirely**: Remove `VITE_THIRDWEB_SECRET_KEY` from env
4. **Per-user limits**: Not yet implemented — would require server-side tracking

### Gas credits

thirdweb provides gas credits with their Growth plan. Monitor usage in the thirdweb dashboard under **Usage > Gas Credits**.

## Adding or Removing Sponsored Actions

Edit `apps/web/src/lib/paymaster.ts`:

```ts
// To add a sponsored action:
export const SPONSORED_ACTIONS = new Set<string>([
  // ... existing actions
  'myNewAction', // Add here
]);

// To remove:
// Simply delete the entry from the Set
```

No other changes needed — `useSponsoredTransaction` reads from this set dynamically.

## Using the Hook

Replace `useWriteContract` from `useThirdwebWrite` with `useSponsoredTransaction`:

```ts
// Before
import { useWriteContract } from '@/hooks/useThirdwebWrite';

// After
import { useSponsoredTransaction } from '@/hooks/useSponsoredTransaction';

// Usage is identical
const { writeContractAsync, data, isPending, error, wasSponsored } = useSponsoredTransaction();

const hash = await writeContractAsync({
  address: CONTRACT_ADDRESS,
  abi: contractAbi,
  functionName: 'mint',
  args: [tokenId, uri],
});

// New: check if gas was sponsored
if (wasSponsored) {
  toast.success('Minted! Gas was covered by LOAR.');
}
```

## Files

| File                                            | Purpose                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/web/src/lib/paymaster.ts`                 | Paymaster config, sponsored action registry, AA config helpers         |
| `apps/web/src/hooks/useSponsoredTransaction.ts` | React hook — drop-in replacement for useWriteContract with sponsorship |
| `.env.example`                                  | `VITE_THIRDWEB_SECRET_KEY` variable                                    |

## Limitations and TODOs

- **EOA sponsorship**: Currently, gas sponsorship only works automatically for smart accounts (in-app wallet users). External wallet (EOA) users always pay their own gas. Thirdweb may expose a direct paymaster option for EOAs in a future SDK version.
- **Per-user rate limiting**: No server-side tracking of sponsored tx per user yet. A malicious user could burn gas credits by spamming mints. Mitigate via thirdweb dashboard spending limits.
- **SDK version sensitivity**: Built against thirdweb v5.119.x. The account abstraction API may change in future versions — check thirdweb migration guides when upgrading.
