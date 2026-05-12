# Mobile App Store Submission Checklist

> **Status**: Pre-submission checklist. Mobile is beta; this doc is the gate
> between beta and a public listing in App Store + Google Play.
>
> **Last updated**: 2026-04-19

## Preconditions

- [ ] Apple Developer account ($99/year) active, team ID on file
- [ ] Google Play Developer account ($25 one-time) active
- [ ] Legal entity registered for the dev accounts (can be individual;
      noted here because some banking + tax flows only work with LLC/Inc.)
- [x] `apps/mobile/app.json` bundle identifier + package are final
      (`fun.loar.vault` — set 2026-04-19, pre-submission)
- [ ] App name "LOAR Vault" confirmed or renamed — must match listings
- [ ] Privacy policy published at https://loar.fun/privacy and linkable
      from the store listings
- [ ] Terms of Service published at https://loar.fun/terms

## Bundle identifier decision

**Decided 2026-04-19 (pre-submission): `fun.loar.vault`** — both
`ios.bundleIdentifier` and `android.package` in `apps/mobile/app.json`
match the `loar.fun` marketing domain. This is locked in once the app
is submitted to either store; do not change post-submission without
creating a new listing.

## iOS — Apple Store Connect

### Required listing fields

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| App name            | LOAR Vault                                                                |
| Subtitle (30 chars) | Co-create AI story universes                                              |
| Primary category    | Entertainment                                                             |
| Secondary category  | Graphics & Design                                                         |
| Content rights      | Contains third-party content: no (or yes with license)                    |
| Age rating          | 17+ (frequent/intense mature themes — user-generated AI content)          |
| Price               | Free                                                                      |
| Availability        | All countries **except** OFAC-sanctioned list (see compliance-kyc-aml.md) |

### Screenshots (all required sizes)

- 6.7" (iPhone 15 Pro Max): 1290 × 2796 — 3 to 10 screenshots
- 6.5" (iPhone 11 Pro Max): 1242 × 2688 — 3 to 10 screenshots
- 5.5" (iPhone 8 Plus): 1242 × 2208 — 3 to 10 screenshots
- iPad Pro 12.9" (if supportsTablet): 2048 × 2732 — currently `false`, skip

Use the feature-highlight set: onboarding → universe view → generation →
mint → wallet screen.

### App Privacy manifest (required for new submissions since May 2024)

Add `apps/mobile/ios/PrivacyInfo.xcprivacy` with the declarations below.
Expo typically generates this via `expo-build-properties`; verify after
`eas build`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeCryptocurrencyWallet</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeUserID</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <true/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
        <string>NSPrivacyCollectedDataTypePurposeAuthentication</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyCollectedDataType</key>
      <string>NSPrivacyCollectedDataTypeCrashData</string>
      <key>NSPrivacyCollectedDataTypeLinked</key>
      <false/>
      <key>NSPrivacyCollectedDataTypeTracking</key>
      <false/>
      <key>NSPrivacyCollectedDataTypePurposes</key>
      <array>
        <string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
        <string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
      </array>
    </dict>
  </array>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>C617.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>E174.1</string>
      </array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>35F9.1</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
```

### Info.plist additions (missing from current `app.json`)

If we add photo upload for user avatars / universe covers:

```json
"NSPhotoLibraryUsageDescription": "Used to pick images for your profile and universe covers.",
"NSPhotoLibraryAddUsageDescription": "Used to save generated content to your photo library.",
"NSMicrophoneUsageDescription": "Used for voice-to-text prompts.",
"NSAppTransportSecurity": { "NSAllowsArbitraryLoads": false }
```

### Review notes for Apple

The app uses crypto wallets but **does not offer exchange / fiat on-ramp**.
Add this to "App Review Information → Notes":

> LOAR Vault is a creator tool with an embedded Developer-Controlled
> Wallet (provisioned via Circle) so users can sign in with email or
> social login. We do not offer fiat on/off-ramps and do not act as a
> broker. All token transactions happen on Base L2 and are signed by
> Circle's KMS on the user's behalf. Crypto purchase flows link out to
> third-party on-ramp providers in Safari, not in-app.

Apple rejects crypto apps that obscure these boundaries. Spell it out.

## Android — Play Console

### Required fields

| Field                   | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| App name                | LOAR Vault                                                 |
| Short description (80)  | Co-create AI story universes with crypto-native creators.  |
| Full description (4000) | TODO — copy from `ops/mobile-listing-copy.md` when written |
| Category                | Entertainment                                              |
| Content rating          | IARC questionnaire — likely Mature 17+                     |
| Target audience         | 18+                                                        |
| Countries               | All except OFAC-sanctioned                                 |

### Data safety form

- Collects wallet address (non-optional, for app functionality)
- Collects email (optional, for notifications)
- Collects device identifiers (crash reporting only, no tracking)
- **No tracking** (no advertiser IDs, no cross-app profiling)
- All transit is encrypted (HTTPS)
- Storage: user can request deletion via Profile → Delete Account

### Screenshots

- Phone: 16:9 or 9:16, min 1080 px long edge — 2 to 8 screenshots
- 7" tablet + 10" tablet: skip (no tablet support yet)

### AAB upload

- Build with `eas build --platform android --profile production`
- Signing: Google Play App Signing (upload key managed by eas)
- Target SDK: per Play Console latest requirement (check at submission time)

## Pre-submission smoke checks

- [ ] `apps/mobile` builds clean on both platforms (`eas build --profile production`)
- [ ] Production API endpoint (`loar.fun/server`) is reachable from device
- [ ] Circle DCW credentials point at the **production** project, not dev
- [ ] Sentry DSN for mobile (`apps/mobile/src/lib/sentry.ts` per memory) is set
- [ ] Deep links work: `loarvault://open?u=<test-universe-address>`
- [ ] Sign-in → universe view → back → sign-out → sign-in cycle works 10×
- [ ] App works on iOS with Low Power Mode on + spotty 3G (generation UX)
- [ ] No console logs in release builds
- [ ] No debug / devtools overlays on production builds
- [ ] Accessibility: VoiceOver reads the primary flow; minimum tap target
      44×44 pt; contrast ≥ 4.5:1 on body text
- [ ] Reject review: confirm we have a response plan for the common
      rejection reasons (crypto category, gas fees, in-app purchase of
      digital assets — 3.1.1 guideline).

## Common Apple rejection patterns to avoid

1. **3.1.1 — IAP required for digital content**. Apple interprets
   "purchasing credits for AI generation" as a digital good. Credits MUST
   be sold via StoreKit IAP on iOS. On Android this is currently looser
   but Play is moving the same direction.
2. **3.1.5 — Cryptocurrencies**. Mining on-device is disallowed; exchange
   functionality requires you to be a regulated exchange. "Using" a wallet
   is fine. We are fine.
3. **4.3 — Spam**. Generative apps often get flagged as low-quality if
   the UX looks templated. Show creator-owned IP in screenshots, not
   generic AI outputs.
4. **5.1.1 — Data collection**. Every data type you collect MUST be in
   the privacy manifest AND the listing's privacy form.

## Handoff

- Initial submission: founder or ops lead operates the App Store Connect +
  Play Console accounts. Don't share login; use delegate roles.
- Each release: version bump in `app.json` → `eas build` → `eas submit`.
- Rollouts: Android supports staged rollout at 10 / 25 / 50 / 100 %.
  iOS does not; monitor Sentry for the first 48 h after release.

## Related

- [compliance-kyc-aml.md](compliance-kyc-aml.md) — geographic availability
- [privacy-policy.md](privacy-policy.md) — linkable privacy policy
- [terms-of-service.md](terms-of-service.md) — linkable ToS
