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
///      H4 fix: Symbol validated for length and checked against a blocklist of common stock tickers.
contract GovernanceERC20 is ERC20, ERC20Permit, ERC20Votes {
    string public imageUrl;
    string public metadata;
    string public context;
    address public immutable admin;
    address public constant universe = address(0);

    /// @notice Deployer address that can manage the symbol blocklist
    address public immutable deployer;

    /// @notice Blocked symbols to prevent NYSE/NASDAQ ticker collisions (H4 fix)
    mapping(string => bool) public blockedSymbols;

    error SymbolTooShort();
    error SymbolTooLong();
    error SymbolBlocked();

    constructor(
        string memory _name,
        string memory _symbol,
        uint _maxSupply,
        address _admin,
        string memory _imageUrl,
        string memory _metadata,
        string memory _context
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        // H4 fix: validate symbol length (3-10 characters)
        require(bytes(_symbol).length >= 3, "Symbol too short");
        require(bytes(_symbol).length <= 10, "Symbol too long");

        imageUrl = _imageUrl;
        metadata = _metadata;
        context = _context;
        admin = _admin;
        deployer = msg.sender;
        // Mint initial supply to the deployer
        _mint(msg.sender, _maxSupply);
    }

    /// @notice Add symbols to the blocklist (deployer only, H4 fix)
    function addBlockedSymbols(string[] calldata symbols) external {
        require(msg.sender == deployer || msg.sender == admin, "Not authorized");
        for (uint256 i = 0; i < symbols.length; i++) {
            blockedSymbols[symbols[i]] = true;
        }
    }

    /// @notice Remove symbols from the blocklist (deployer only, H4 fix)
    function removeBlockedSymbols(string[] calldata symbols) external {
        require(msg.sender == deployer || msg.sender == admin, "Not authorized");
        for (uint256 i = 0; i < symbols.length; i++) {
            blockedSymbols[symbols[i]] = false;
        }
    }

    /// @notice Check if a symbol is blocked
    function isSymbolBlocked(string calldata _symbol) external view returns (bool) {
        return blockedSymbols[_symbol];
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
