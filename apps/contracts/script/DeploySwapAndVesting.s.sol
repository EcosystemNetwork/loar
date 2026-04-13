// SPDX-License-Identifier: MIT
pragma solidity =0.8.28;

import "forge-std/Script.sol";
import {LoarSwapRouter} from "../src/LoarSwapRouter.sol";
import {TokenVesting} from "../src/TokenVesting.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DeploySwapAndVesting is Script {
    function run() external {
        // PoolManager addresses per chain
        address poolManager;
        uint256 chainId = block.chainid;

        if (chainId == 11155111) {
            // Sepolia
            poolManager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        } else if (chainId == 84532) {
            // Base Sepolia
            poolManager = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
        } else {
            revert("Unsupported chain");
        }

        vm.startBroadcast();

        // Deploy LoarSwapRouter
        LoarSwapRouter swapRouter = new LoarSwapRouter(IPoolManager(poolManager));
        console.log("LoarSwapRouter deployed at:", address(swapRouter));

        // Deploy TokenVesting
        TokenVesting vesting = new TokenVesting(msg.sender);
        console.log("TokenVesting deployed at:", address(vesting));

        vm.stopBroadcast();
    }
}
