// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {LoarToken} from "../src/LoarToken.sol";

/**
 * @title DeployLoarToken
 * @notice Deploys the $LOAR utility token to Sepolia testnet
 * @dev Before running, set these environment variables:
 *      - PRIVATE_KEY: Deployer private key
 *      - TREASURY (optional): Treasury address (defaults to deployer)
 *      - INITIAL_HOLDER (optional): Initial token holder (defaults to deployer)
 *
 * Run with: forge script script/DeployLoarToken.s.sol --rpc-url sepolia --broadcast --verify -vvv
 */
contract DeployLoarTokenScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address treasury = vm.envOr("TREASURY", deployer);
        address initialHolder = vm.envOr("INITIAL_HOLDER", deployer);

        console.log("Deployer:       ", deployer);
        console.log("Treasury:       ", treasury);
        console.log("Initial holder: ", initialHolder);

        vm.startBroadcast(deployerPrivateKey);

        LoarToken loarToken = new LoarToken(treasury, initialHolder);

        console.log("LoarToken deployed at:", address(loarToken));
        console.log("Total supply:", loarToken.totalSupply());
        console.log("Treasury balance:", loarToken.balanceOf(treasury));
        console.log("Holder balance:", loarToken.balanceOf(initialHolder));

        vm.stopBroadcast();
    }
}
