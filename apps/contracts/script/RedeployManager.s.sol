// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseTokenDeployer} from "../src/UniverseTokenDeployer.sol";
import {IdentityNFT} from "../src/IdentityNFT.sol";
import {UniverseFactory} from "../src/factories/UniverseFactory.sol";
import {UniverseMetadataRenderer} from "../src/UniverseMetadataRenderer.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../src/libraries/NodeOptions.sol";

/**
 * @title RedeployManager
 * @notice Redeploys UniverseManager + UniverseFactory + MetadataRenderer +
 *         TokenDeployer + IdentityNFT, then creates a test universe.
 *
 * Run:
 *   cd apps/contracts && source .env
 *   forge script script/RedeployManager.s.sol \
 *     --rpc-url sepolia --broadcast -vvv
 */
contract RedeployManagerScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        // Sepolia WETH
        address weth = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

        console.log("=== Redeploy UniverseManager ===");
        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(pk);

        // 1. Deploy MetadataRenderer (holds Strings + Base64)
        UniverseMetadataRenderer renderer = new UniverseMetadataRenderer();
        console.log("[1] MetadataRenderer:", address(renderer));

        // 2. Deploy UniverseManager (now under EIP-170 limit)
        UniverseManager um = new UniverseManager(deployer, weth);
        console.log("[2] UniverseManager:", address(um));

        // 3. Deploy UniverseFactory (needs manager for access control)
        UniverseFactory factory = new UniverseFactory(address(um));
        console.log("[3] UniverseFactory:", address(factory));

        // 4. Wire up factory + renderer
        um.setUniverseFactory(address(factory));
        um.setMetadataRenderer(address(renderer));
        console.log("[4] Factory + Renderer wired");

        // 5. Deploy TokenDeployer
        UniverseTokenDeployer utd = new UniverseTokenDeployer(address(um));
        um.setTokenDeployer(address(utd));
        console.log("[5] UniverseTokenDeployer:", address(utd));

        // 6. Deploy IdentityNFT
        IdentityNFT inft = new IdentityNFT(address(um));
        um.setIdentityNft(address(inft));
        console.log("[6] IdentityNFT:", address(inft));

        // 7. Set mint fee to 0 for easy testing
        um.setMintFee(0);
        console.log("[7] Mint fee set to 0");

        // 8. Create a test universe to verify everything works
        (uint256 universeId, address universeAddress) = um.createUniverse(
            "LOAR Testnet Universe",
            "https://loar.fun/logo.png",
            "Test universe with interchangeable video nodes",
            NodeCreationOptions.PUBLIC,
            NodeVisibilityOptions.PUBLIC,
            deployer
        );
        console.log("[8] Test Universe created:");
        console.log("    ID:", universeId);
        console.log("    Address:", universeAddress);

        vm.stopBroadcast();

        console.log("\n========================================");
        console.log("  UPDATE YOUR CONFIG FILES");
        console.log("========================================");
        console.log("UNIVERSE_MANAGER=", address(um));
        console.log("UNIVERSE_FACTORY=", address(factory));
        console.log("METADATA_RENDERER=", address(renderer));
        console.log("UNIVERSE_TOKEN_DEPLOYER=", address(utd));
        console.log("IDENTITY_NFT=", address(inft));
        console.log("TIMELINE_ADDRESS=", universeAddress);
    }
}
