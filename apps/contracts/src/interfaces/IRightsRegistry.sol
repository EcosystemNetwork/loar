// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

interface IRightsRegistry {
    enum RightsType {
        UNSET,
        FUN,
        ORIGINAL,
        LICENSED,
        PUBLIC_DOMAIN,
        FROZEN
    }

    function rights(bytes32 contentHash) external view returns (RightsType);
    function setRights(bytes32 contentHash, RightsType rightsType) external;
    function requestFreeze(bytes32 contentHash, string calldata reason) external;
    function confirmFreeze(bytes32 contentHash) external;
    function emergencyFreeze(bytes32 contentHash, string calldata reason) external;
    function unfreeze(bytes32 contentHash) external;
    function isMonetizable(bytes32 contentHash) external view returns (bool);
}
