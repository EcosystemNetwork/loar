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
| UniverseManager       | `0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce` |
| LoarHookStaticFee     | `0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc` |
| LoarLpLockerMultiple  | `0xc00225D9463C15280748dC2E21D8D8625982Ad54` |
| LoarFeeLocker         | `0x1E10b62bd2817d0C2414909027E1E63653fcCd8e` |

### Revenue Singletons (UUPS Proxies)

| Contract            | Proxy Address                                |
| ------------------- | -------------------------------------------- |
| PaymentRouter       | `0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6` |
| RightsRegistry      | `0x3A14A746990498d5a4eCe867db10a197f91856Bc` |
| CanonMarketplace    | `0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81` |
| CreditManager       | `0x5110FCCaf50316D8F874F22428dC1a832F591639` |
| SubscriptionManager | `0x53542bA1e3445804D9a225C967E2677F017D1d47` |
| LicensingRegistry   | `0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C` |
| CollabManager       | `0xE981454B4149BEa3a9018fa2ab77482F388ba01f` |
| AnalyticsRegistry   | `0xB86539C4bf30036B6bd1513320cF38Bc839c7922` |

### NFT Beacons & Factory

| Contract                 | Address                                      |
| ------------------------ | -------------------------------------------- |
| RevenueModuleFactory     | `0x6D5CEf09F044224A51bd59EB841769255070e5dA` |
| EpisodeEdition Beacon    | `0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed` |
| Character Beacon         | `0x0BEcc54417e9AaC9289C748eb72ECBb55292756f` |
| Entity Beacon            | `0xF951065C7d4d28805188F60a3F8bd398B7776EC8` |
| EntityEdition Beacon     | `0xb3D7889c393b710edF2e087Cd2b7148a2556f47b` |
| EpisodeNFT Beacon        | `0x3ebb4FFd384Fc971F445AA950055203916b749a5` |

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
