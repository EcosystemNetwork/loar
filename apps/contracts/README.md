## LOAR Protocol Contracts

Built with [Foundry](https://book.getfoundry.sh/). All contracts deployed on **Sepolia testnet** (chain 11155111).

## Architecture

The protocol uses two upgradeability patterns:

- **UUPS Proxy** — Singleton contracts (PaymentRouter, RightsRegistry, etc.) behind ERC1967 proxies. Owner calls `upgradeToAndCall(newImpl, "")`.
- **Beacon Proxy** — Per-universe NFT contracts. The `RevenueModuleFactory` deploys 5 `BeaconProxy` instances per universe. Upgrading the beacon upgrades ALL universe instances of that type at once.

All upgradeable contracts use OpenZeppelin Upgradeable v5.0.2 with `Initializable` + `ReentrancyGuardUpgradeable`.

## Deployed Contracts

### Core Protocol

| Contract              | Address                                      |
| --------------------- | -------------------------------------------- |
| UniverseManager       | `0x7af142BbD14CaEECdA68f948F467Da0257f6B114` |
| LoarHookStaticFee     | `0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC` |
| LoarLpLockerMultiple  | `0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6` |
| LoarFeeLocker         | `0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f` |

### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                |
| ------------------- | -------------------------------------------- |
| PaymentRouter       | `0xD8b49c99aDb51575eea4FB795645fc9e1ce4Fa9C` |
| RightsRegistry      | `0x711eC315392f6f9FFd37e673B35acc63b9999323` |
| CanonMarketplace    | `0x8e6c09198267B07E3FC8C66F0343759111D63016` |
| CreditManager       | `0x7bB6cDdd392Bf8a6a6E58fd8600B87c8455E8240` |
| AdPlacement         | `0xB18db49DFAB0d8B05916260D457574348893601d` |
| SubscriptionManager | `0x99562C96389A91b17662ce5f15143f5b07b84090` |
| LicensingRegistry   | `0xE64563E0361f26228783e6cBAd3789563A6d5eA7` |
| CollabManager       | `0xD98755fdEA77Aa76b19DD979f9a3134502D18294` |
| AnalyticsRegistry   | `0x7Fa728f17e91AAa4aaD895b7b128Df193b73C0a8` |

### NFT Beacons & Factory

| Contract                 | Address                                      |
| ------------------------ | -------------------------------------------- |
| RevenueModuleFactory     | `0x056dDe6c068cE3FE17C2E6eE6cfA8F76eB5A5264` |
| EpisodeEdition Beacon    | `0xd70A0A63d1F80D6f28BeB3e8f3FC2a34dBEC3618` |
| Character Beacon         | `0xe15D941140e5504AF7C1b56AC14dA236963A99ae` |
| Entity Beacon            | `0x152ADc8350ee69162989c0C52f5ffb2f8A09E17B` |
| EntityEdition Beacon     | `0x7e62116B9A889150E6D07830a179f3cF803c2908` |
| EpisodeNFT Beacon        | `0x89c4b520319FDB6cd23cb8DC5E6b023B110F23fC` |

**Deployer/Owner:** `0x116C28e6DCABCa363f83217C712d79DCE168d90e`

## Contracts

### UniverseManager

Manager entrypoint for the protocol. Creates Universe contracts and deploys governance tokens.

```solidity
function createUniverse(
    string memory name,
    string memory imageUrl,
    string memory description,
    NodeCreationOptions nodeCreationsOptions,
    NodeVisibilityOptions nodeVisibilityOptions,
    address initialOwner
) public returns (uint256 _id, address)
```

### Universe

Directed acyclic graph where users contribute narrative nodes. Nodes can be canonized by governance vote.

```solidity
function createNode(
    bytes32 _contentHash,
    bytes32 _plotHash,
    uint _previous,
    string memory _link,
    string memory _plot
) public returns (uint)
```

### Revenue Contracts

| Contract            | Pattern | Purpose                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| PaymentRouter       | UUPS    | Routes payments with configurable fee splits to treasury   |
| RightsRegistry      | UUPS    | Tracks content rights, ownership, and operator permissions |
| CanonMarketplace    | UUPS    | Submit/vote/finalize/license canonical content             |
| CreditManager       | UUPS    | AI generation credits with tier-based pricing              |
| AdPlacement         | UUPS    | Ad slot creation, bidding, and impression tracking         |
| SubscriptionManager | UUPS    | Creator subscription tier management                       |
| LicensingRegistry   | UUPS    | 6 IP license types with royalty distribution               |
| CollabManager       | UUPS    | Multi-creator collaboration proposals & revenue splits     |
| AnalyticsRegistry   | UUPS    | On-chain engagement metrics and trending data              |

### NFT Contracts (Beacon Pattern)

| Contract               | Standard | Purpose                              |
| ---------------------- | -------- | ------------------------------------ |
| EpisodeEditionCollection | ERC1155  | Mintable episode editions with royalties |
| CharacterNFT           | ERC721   | Character ownership + appearance fees |
| EntityNFT              | ERC721   | World entity ownership               |
| EntityEditionNFT       | ERC1155  | Entity edition minting               |
| EpisodeNFT             | ERC721   | Per-episode NFT minting              |

Each NFT type has a shared **UpgradeableBeacon**. The `RevenueModuleFactory.deployModules()` creates 5 `BeaconProxy` instances per universe, each initialized with universe-specific parameters.

### LoarHookStaticFee

Uniswap v4 hook implementing a static fee on every swap through the protocol.

## Upgrading Contracts

### UUPS Singletons

```bash
# 1. Deploy new implementation
forge create src/PaymentRouter.sol:PaymentRouter --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY

# 2. Call upgrade on proxy
cast send <PROXY_ADDRESS> "upgradeToAndCall(address,bytes)" <NEW_IMPL> 0x \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

### Beacon NFTs

```bash
# 1. Deploy new implementation
forge create src/revenue/CharacterNFT.sol:CharacterNFT --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY

# 2. Upgrade beacon (upgrades ALL universe instances)
cast send <BEACON_ADDRESS> "upgradeTo(address)" <NEW_IMPL> \
  --rpc-url $RPC_11155111 --private-key $PRIVATE_KEY
```

## Scripts

| Script                 | Purpose                                               |
| ---------------------- | ----------------------------------------------------- |
| `DeployRevenue.s.sol`  | Full revenue infrastructure (implementations + beacons + proxies + factory) |
| `DeployProtocol.s.sol` | Core protocol (UniverseManager, hooks, lockers)       |
| `DeployUniverse.s.sol` | Deploy a single universe instance                     |
| `DeployHook.s.sol`     | Deploy a new Uniswap v4 hook                          |
| `DeployLocker.s.sol`   | Deploy a new LP locker                                |

## Development

```bash
# Build
forge build

# Test
forge test -vvv

# Test upgrades specifically
forge test --match-path test/Upgrade.t.sol -vvv

# Format
forge fmt

# Deploy revenue infrastructure
source ../../.env && export PRIVATE_KEY="0x$PRIVATE_KEY" && \
forge script script/DeployRevenue.s.sol --rpc-url "$RPC_11155111" --broadcast \
  --skip "script/Deploy{Protocol,Hook,Locker,Universe}*" \
  --sender 0x116C28e6DCABCa363f83217C712d79DCE168d90e
```

## ABI Generation

After contract changes, regenerate TypeScript bindings:

```bash
forge build                    # compile contracts
cd ../.. && pnpm exec wagmi generate  # generate hooks
```

Output: `packages/abis/src/generated.ts` — imported by `apps/web`.
