// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/utils/Nonces.sol";

/// @title GovernanceERC20
/// @notice ERC20 token with voting and permit capabilities for universe governance.
/// @dev Extends OpenZeppelin's ERC20Votes for on-chain vote delegation and ERC20Permit for gasless approvals.
///      Mints the full supply to the deployer (UniverseTokenDeployer) on construction.
contract GovernanceERC20 is ERC20, ERC20Permit, ERC20Votes {
    string public imageUrl;
    string public metadata;
    string public context;
    address public immutable admin;
    address public constant universe = address(0);

    constructor(
        string memory _name,
        string memory _symbol,
        uint _maxSupply,
        address _admin,
        string memory _imageUrl,
        string memory _metadata,
        string memory _context
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        imageUrl = _imageUrl;
        metadata = _metadata;
        context = _context;
        admin = _admin;
        // Mint initial supply to the deployer
        _mint(msg.sender, _maxSupply);
    }

    // The following functions are overrides required by Solidity.

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(
        address owner
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
