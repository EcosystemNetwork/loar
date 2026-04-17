// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IUniverseMetadataRenderer {
    function tokenURI(
        uint256 tokenId,
        address universeAddr,
        address tokenAddr
    ) external view returns (string memory);
}
