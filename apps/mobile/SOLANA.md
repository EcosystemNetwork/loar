# Solana on mobile

The mobile app supports Sign-In With Solana on Android via the [Mobile Wallet
Adapter (MWA) protocol](https://docs.solanamobile.com/protocol/intro).

## Dev-client requirement

MWA's `transact()` is a **native Android module**. The standard Expo Go runtime
does not include it. Before Solana sign-in will work on a phone, build a
custom dev client:

```sh
cd apps/mobile
pnpm exec expo prebuild --platform android
pnpm exec eas build --profile development --platform android
# install the produced .apk on the device, run `pnpm start` and connect.
```

iOS path: MWA doesn't ship for iOS (Solana Mobile is Android-first). iOS users
fall back to a Phantom universal-link flow — `signInWithSolana()` throws a
clear error on iOS so the UI can show a "Connect via web instead" CTA.

## Env vars

```env
EXPO_PUBLIC_SOLANA_CLUSTER=devnet
EXPO_PUBLIC_SERVER_URL=https://api.loar.fun  # or http://localhost:3000 in dev
```

## Usage

```ts
import { signInWithSolana } from './src/lib/solana-auth';
import * as SecureStore from 'expo-secure-store';

async function onPressSolanaSignIn() {
  const { token, address } = await signInWithSolana();
  await SecureStore.setItemAsync('siwe-token', token);
  await SecureStore.setItemAsync('user-address', address);
}
```

The JWT returned by the server has `ns='solana'` and `sub=<base58 address>`.
All subsequent tRPC + REST calls authenticate with `Authorization: Bearer
<token>` — identical wire format to the Circle DCW email-auth flow.

## Wallet support

Whichever Solana wallet the user has installed gets shown in MWA's picker:
Phantom, Solflare, Backpack, Trust, etc. — the protocol abstracts the wallet
implementation.

## Capabilities

- Sign-in (SIWS) ✅ wired
- Cross-chain link to EVM session — share the same `/auth/solana/link`
  endpoint with the web client; not yet wired to mobile UI
- Sending Solana transactions from the device — covered by MWA's `signAndSend`
  call; layer this on top once mobile mint UI lands
