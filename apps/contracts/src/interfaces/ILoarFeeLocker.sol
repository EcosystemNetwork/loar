// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @title ILoarFeeLocker
/// @notice Interface for the fee escrow contract that holds protocol fees on behalf of fee owners.
interface ILoarFeeLocker {
    error NoFeesToClaim();
    error Unauthorized();

    event StoreTokens(
        address indexed sender,
        address indexed feeOwner,
        address indexed token,
        uint256 balance,
        uint256 amount
    );
    event ClaimTokensPermissioned(
        address indexed feeOwner, address indexed token, address recipient, uint256 amountClaimed
    );
    event ClaimTokens(address indexed feeOwner, address indexed token, uint256 amountClaimed);
    event AddDepositor(address indexed depositor);
    event RemoveDepositor(address indexed depositor);

    function storeFees(address feeOwner, address token, uint256 amount) external;

    function claim(address token) external;

    function addDepositor(address depositor) external;

    function removeDepositor(address depositor) external;

    function availableFees(address feeOwner, address token) external view returns (uint256);

    function supportsInterface(bytes4 interfaceId) external pure returns (bool);
}
