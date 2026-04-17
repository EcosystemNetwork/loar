// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseTokenDeployer} from "../src/UniverseTokenDeployer.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {UniverseMetadataRenderer} from "../src/UniverseMetadataRenderer.sol";
import {IdentityNFT} from "../src/IdentityNFT.sol";
import {LoarFeeLocker} from "../src/LoarFeeLocker.sol";
import {LoarLpLockerMultiple} from "../src/lp-lockers/LoarLpLockerMultiple.sol";
import {LoarHookStaticFee} from "../src/hooks/LoarHookStaticFee.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";

/**
 * @title DeployProtocol
 * @notice Deploys the entire Loar protocol infrastructure
 * @dev Before running, set these environment variables:
 *      - PRIVATE_KEY: Deployer private key
 *      - POOL_MANAGER: Uniswap v4 PoolManager address on Sepolia
 *      - POSITION_MANAGER: Uniswap v4 PositionManager address on Sepolia
 *      - PERMIT2: Permit2 address on Sepolia
 *      - WETH: WETH9 address on Sepolia
 *      - TEAM_FEE_RECIPIENT: Address to receive team fees
 *
 * Run with: forge script script/DeployProtocol.s.sol --rpc-url sepolia --broadcast --verify
 */
contract DeployProtocolScript is Script {
    UniverseManager public universeManager;
    UniverseFactory public universeFactory;
    UniverseMetadataRenderer public metadataRenderer;
    UniverseTokenDeployer public tokenDeployer;
    IdentityNFT public identityNft;
    LoarFeeLocker public feeLocker;
    LoarLpLockerMultiple public lpLocker;
    LoarHookStaticFee public hook;

    // Sepolia addresses - SET THESE BEFORE DEPLOYING
    address public poolManager = address(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);
    address public positionManager = address(0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4);
    address public permit2 = address(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    address public weth = address(0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9); 

    function setUp() public {}

    function getChainId() public view returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerPrivateKey);
        address teamFeeRecipient = deployerAddress; // Default to deployer, can be changed later

        // Try to get addresses from env vars, fallback to hardcoded
        if (vm.envOr("POOL_MANAGER", address(0)) != address(0)) {
            poolManager = vm.envAddress("POOL_MANAGER");
        }
        if (vm.envOr("POSITION_MANAGER", address(0)) != address(0)) {
            positionManager = vm.envAddress("POSITION_MANAGER");
        }
        if (vm.envOr("PERMIT2", address(0)) != address(0)) {
            permit2 = vm.envAddress("PERMIT2");
        }
        if (vm.envOr("WETH", address(0)) != address(0)) {
            weth = vm.envAddress("WETH");
        }
        if (vm.envOr("TEAM_FEE_RECIPIENT", address(0)) != address(0)) {
            teamFeeRecipient = vm.envAddress("TEAM_FEE_RECIPIENT");
        }

        // Validate chain
        uint256 currentChain = getChainId();
        require(
            currentChain == 11155111 || currentChain == 84532 || currentChain == 8453,
            "Unsupported chain - must be Sepolia (11155111), Base Sepolia (84532), or Base (8453)"
        );

        // Validate required addresses
        require(poolManager != address(0), "POOL_MANAGER not set");
        require(positionManager != address(0), "POSITION_MANAGER not set");
        require(permit2 != address(0), "PERMIT2 not set");
        require(weth != address(0), "WETH not set");

        console.log("=== Deployment Configuration ===");
        console.log("Deployer address:", deployerAddress);
        console.log("Deployer balance:", deployerAddress.balance);
        console.log("ChainId:", getChainId());
        console.log("PoolManager:", poolManager);
        console.log("PositionManager:", positionManager);
        console.log("Permit2:", permit2);
        console.log("WETH:", weth);
        console.log("Team Fee Recipient:", teamFeeRecipient);
        console.log("\n=== Starting Deployment ===\n");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy UniverseFactory (holds Universe creation bytecode, EIP-170 extraction)
        console.log("1/9 Deploying UniverseFactory...");
        universeFactory = new UniverseFactory();
        console.log("   UniverseFactory deployed at:", address(universeFactory));

        // 2. Deploy UniverseMetadataRenderer (holds Strings + Base64, EIP-170 extraction)
        console.log("2/9 Deploying UniverseMetadataRenderer...");
        metadataRenderer = new UniverseMetadataRenderer();
        console.log("   UniverseMetadataRenderer deployed at:", address(metadataRenderer));

        // 3. Deploy UniverseManager
        console.log("3/9 Deploying UniverseManager...");
        universeManager = new UniverseManager(teamFeeRecipient, weth);
        console.log("   UniverseManager deployed at:", address(universeManager));

        // Wire factory + renderer
        universeManager.setUniverseFactory(address(universeFactory));
        universeManager.setMetadataRenderer(address(metadataRenderer));
        console.log("   Factory + Renderer wired");

        // 4. Deploy UniverseTokenDeployer
        console.log("4/9 Deploying UniverseTokenDeployer...");
        tokenDeployer = new UniverseTokenDeployer(address(universeManager));
        console.log("   UniverseTokenDeployer deployed at:", address(tokenDeployer));

        // Set TokenDeployer on UniverseManager
        universeManager.setTokenDeployer(address(tokenDeployer));
        console.log("   TokenDeployer set successfully");

        // 5. Deploy IdentityNFT (minter = UniverseManager)
        console.log("5/9 Deploying IdentityNFT...");
        identityNft = new IdentityNFT(address(universeManager));
        universeManager.setIdentityNft(address(identityNft));
        console.log("   IdentityNFT deployed at:", address(identityNft));

        // 6. Deploy FeeLocker
        console.log("6/9 Deploying LoarFeeLocker...");
        feeLocker = new LoarFeeLocker(deployerAddress);
        console.log("   LoarFeeLocker deployed at:", address(feeLocker));

        // 7. Deploy LpLocker
        console.log("7/9 Deploying LoarLpLockerMultiple...");
        lpLocker = new LoarLpLockerMultiple(
            deployerAddress, // owner
            address(universeManager), // factory
            address(feeLocker),
            positionManager,
            permit2
        );
        console.log("   LoarLpLockerMultiple deployed at:", address(lpLocker));

        // 8. Deploy Hook with deterministic address using CREATE2
        console.log("8/9 Deploying LoarHookStaticFee...");

        // Calculate the required hook address flags
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        console.log("   Mining for hook address with correct flags...");
        console.log("   Required flags:", uint256(flags));

        // Use HookMiner to find the correct salt for CREATE2 deployment
        bytes memory constructorArgs = abi.encode(poolManager, address(universeManager), weth);
        (address hookAddress, bytes32 salt) = HookMiner.find(
            0x4e59b44847b379578588920cA78FbF26c0B4956C, // CREATE2_DEPLOYER
            flags,
            type(LoarHookStaticFee).creationCode,
            constructorArgs
        );

        console.log("   Found valid salt:", uint256(salt));
        console.log("   Expected hook address:", hookAddress);

        // Deploy hook with the mined salt
        hook = new LoarHookStaticFee{salt: salt}(
            poolManager,
            address(universeManager),
            weth
        );

        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("   LoarHookStaticFee deployed at:", address(hook));

        // 9. Configure protocol relationships
        console.log("9/9 Configuring Protocol...");

        console.log("Adding lpLocker as depositor in feeLocker...");
        feeLocker.addDepositor(address(lpLocker));

        console.log("Enabling hook in universeManager...");
        universeManager.setHook(address(hook), true);

        console.log("Enabling locker for hook in universeManager...");
        universeManager.setLocker(address(lpLocker), address(hook), true);

        vm.stopBroadcast();

        console.log("\n=== Deployment Complete ===\n");
        console.log("UniverseFactory:", address(universeFactory));
        console.log("UniverseMetadataRenderer:", address(metadataRenderer));
        console.log("UniverseManager:", address(universeManager));
        console.log("UniverseTokenDeployer:", address(tokenDeployer));
        console.log("IdentityNFT:", address(identityNft));
        console.log("LoarFeeLocker:", address(feeLocker));
        console.log("LoarLpLockerMultiple:", address(lpLocker));
        console.log("LoarHookStaticFee:", address(hook));
        console.log("\n=== Update addresses.ts ===");
        console.log("1. Update all addresses in packages/abis/src/addresses.ts");
        console.log("2. Run: npx wagmi generate");
        console.log("3. Test universe creation");
    }
}
