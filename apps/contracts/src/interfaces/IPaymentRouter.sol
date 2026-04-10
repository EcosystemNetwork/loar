// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

interface IPaymentRouter {
    function route(address creator, uint16 feeBps) external payable;
    function routeToTreasury() external payable;
    function claimable(address creator) external view returns (uint256);
    function claim() external;

    /// @notice Route a $LOAR payment: platform cut to treasury, creator's cut accrued
    function routeLoar(address creator, uint16 feeBps, uint256 amount) external;
    /// @notice Route $LOAR entirely to treasury
    function routeLoarToTreasury(uint256 amount) external;
    /// @notice $LOAR claimable per creator
    function claimableLoar(address creator) external view returns (uint256);
    /// @notice Creator pulls accumulated $LOAR earnings
    function claimLoar() external;
}
