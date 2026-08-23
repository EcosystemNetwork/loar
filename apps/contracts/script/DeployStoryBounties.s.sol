// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {StoryBounties} from "../src/revenue/StoryBounties.sol";

/**
 * @title DeployStoryBounties
 * @notice Deploys StoryBounties (UUPS proxy) standalone, wired to the LoarToken
 *         already deployed on this chain. StoryBounties was previously deployed
 *         only on Base Sepolia (84532); this fills the missing Ethereum Sepolia
 *         (11155111) deployment referenced by packages/abis/src/addresses.ts.
 *
 * Prerequisites:
 *   - LoarToken already deployed on the target chain (LOAR_TOKEN env)
 *
 * Run:
 *   forge script script/DeployStoryBounties.s.sol \
 *     --rpc-url sepolia --broadcast --verify \
 *     -vvv
 *
 * After deployment:
 *   1. Copy the printed address into packages/abis/src/addresses.ts under
 *      `StoryBounties['11155111']`.
 *   2. Re-run `wagmi generate` so the real ABI (not the inlined stub in
 *      apps/web/src/hooks/useStoryBounties.ts) is used.
 */
contract DeployStoryBountiesScript is Script {
    function run() public {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address d = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", d);
        address loarToken = vm.envAddress("LOAR_TOKEN");

        require(loarToken != address(0), "LOAR_TOKEN env required");

        console.log("Deployer:", d);
        console.log("Treasury:", treasury);
        console.log("LoarToken:", loarToken);

        vm.startBroadcast(pk);

        StoryBounties bounties = StoryBounties(
            address(
                new ERC1967Proxy(
                    address(new StoryBounties()),
                    abi.encodeCall(StoryBounties.initialize, (loarToken, treasury, d))
                )
            )
        );
        console.log("StoryBounties:", address(bounties));

        vm.stopBroadcast();

        console.log("\n=== Add to packages/abis/src/addresses.ts ===");
        console.log("StoryBounties['11155111'] =", address(bounties));
    }
}
