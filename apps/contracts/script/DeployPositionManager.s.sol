// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.26;

import "forge-std/Script.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IAllowanceTransfer} from "permit2/interfaces/IAllowanceTransfer.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";

contract DeployPositionManager is Script {
    function run() external {
        // Base Sepolia addresses
        address poolManager = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
        address permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        address weth = 0x4200000000000000000000000000000000000006;
        uint256 unsubscribeGasLimit = 100_000;

        vm.startBroadcast();

        PositionManager pm = new PositionManager(
            IPoolManager(poolManager),
            IAllowanceTransfer(permit2),
            unsubscribeGasLimit,
            IPositionDescriptor(address(0)), // No descriptor needed for LP ops
            IWETH9(weth)
        );

        console.log("PositionManager deployed:", address(pm));
        console.log("nextTokenId:", pm.nextTokenId());

        vm.stopBroadcast();
    }
}
