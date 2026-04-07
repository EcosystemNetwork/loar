// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

interface IPaymentRouter {
    function route(address creator, uint16 feeBps) external payable;
    function routeToTreasury() external payable;
    function claimable(address creator) external view returns (uint256);
    function claim() external;
}
