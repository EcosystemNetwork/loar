// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

interface ISplitRouter {
    struct Split {
        address recipient;
        uint16 bps;
    }

    function registerSplitOwner(bytes32 entityHash, address owner_) external;
    function setSplits(bytes32 entityHash, Split[] calldata splits) external;
    function routeWithSplits(bytes32 entityHash, uint16 platformFeeBps) external payable;
    function getSplits(bytes32 entityHash) external view returns (Split[] memory);
    function splitOwner(bytes32 entityHash) external view returns (address);
    function transferSplitOwnership(bytes32 entityHash, address newOwner) external;
}
