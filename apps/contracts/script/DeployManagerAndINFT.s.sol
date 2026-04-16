// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {IdentityNFT} from "../src/IdentityNFT.sol";

/**
 * @title DeployManagerAndINFT
 * @notice Deploys the updated UniverseManager (with createUniverseWithToken)
 *         and the new IdentityNFT contract. Wires them together and connects
 *         to the existing UniverseTokenDeployer.
 *
 * Required env vars:
 *   PRIVATE_KEY          — deployer key
 *   WETH                 — WETH address for the target chain
 *   TOKEN_DEPLOYER       — existing UniverseTokenDeployer address
 *   HOOK                 — existing LoarHookStaticFee address
 *   LOCKER               — existing LoarLpLockerMultiple address
 *
 * Run:
 *   WETH=0x4200000000000000000000000000000000000006 \
 *   TOKEN_DEPLOYER=0xDD4a87EfF3a45A718a4F3471C28De364e0F43E30 \
 *   HOOK=0xe35adBBc6da1000BE4DCbf49ccBE3B9B70c9a8cC \
 *   LOCKER=0x6C67EaC980DAF0AC8aDBD6a41E61a7833E2D5FF6 \
 *   forge script script/DeployManagerAndINFT.s.sol \
 *     --rpc-url <rpc> --broadcast -vvv
 */
contract DeployManagerAndINFTScript is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address d = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", d);
        address wethAddr = vm.envAddress("WETH");
        address tokenDeployer = vm.envAddress("TOKEN_DEPLOYER");
        address hook = vm.envAddress("HOOK");
        address locker = vm.envAddress("LOCKER");

        console.log("Deployer:", d);
        console.log("Treasury:", treasury);
        console.log("WETH:", wethAddr);
        console.log("TokenDeployer:", tokenDeployer);
        console.log("Hook:", hook);
        console.log("Locker:", locker);

        vm.startBroadcast(pk);

        // 1. Deploy new UniverseManager
        UniverseManager um = new UniverseManager(treasury, wethAddr);
        console.log("UniverseManager:", address(um));

        // 2. Deploy IdentityNFT (minter = UniverseManager)
        IdentityNFT inft = new IdentityNFT(address(um));
        console.log("IdentityNFT:", address(inft));

        // 3. Wire up
        um.setTokenDeployer(tokenDeployer);
        um.setIdentityNft(address(inft));

        // 4. Enable hook + locker on the new manager
        um.setHook(hook, true);
        um.setLocker(locker, hook, true);

        console.log("Wired: tokenDeployer, identityNft, hook, locker");

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("  NEW ADDRESSES - update .env + addresses.ts");
        console.log("========================================");
        console.log("");
        console.log("UNIVERSE_MANAGER=", address(um));
        console.log("VITE_UNIVERSE_MANAGER=", address(um));
        console.log("IDENTITY_NFT_ADDRESS=", address(inft));
        console.log("VITE_IDENTITY_NFT_ADDRESS=", address(inft));
    }
}
