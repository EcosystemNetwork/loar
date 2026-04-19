// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice Minimal mock that supports ownerOf for registerUniverse lookups
contract MockUniverseManager {
    mapping(uint256 => address) private _owners;

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address owner = _owners[tokenId];
        require(owner != address(0), "ERC721: invalid token ID");
        return owner;
    }
}
