// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @title LoarToken ($LOAR)
/// @notice Platform utility token for LOAR — used to purchase generation credits
///         at a discounted rate (25% margin vs 35% for card/crypto).
///         Also used for quest rewards, affiliate payouts, and governance staking.
/// @dev ERC20 with permit (gasless approvals), burn, and owner-controlled minting.
contract LoarToken is ERC20, ERC20Permit, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion $LOAR

    /// @notice Treasury address that receives platform revenue
    address public treasury;

    /// @notice Addresses authorized to mint (platform backend, quest rewards, etc.)
    mapping(address => bool) public minters;

    event MinterUpdated(address indexed minter, bool authorized);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    error NotMinter();
    error ExceedsMaxSupply();
    error ZeroAddress();

    modifier onlyMinter() {
        if (!minters[msg.sender] && msg.sender != owner()) revert NotMinter();
        _;
    }

    constructor(
        address _treasury,
        address _initialHolder
    ) ERC20("LOAR", "LOAR") ERC20Permit("LOAR") Ownable(msg.sender) {
        if (_treasury == address(0) || _initialHolder == address(0)) revert ZeroAddress();
        treasury = _treasury;

        // Initial distribution:
        // 40% — platform treasury (rewards, liquidity, operations)
        // 30% — initial holder (team/founder vesting)
        // 20% — community rewards pool (quests, affiliates)
        // 10% — reserved for future partnerships
        uint256 treasuryAmount = (MAX_SUPPLY * 40) / 100;
        uint256 holderAmount = (MAX_SUPPLY * 30) / 100;
        uint256 communityAmount = (MAX_SUPPLY * 20) / 100;
        uint256 reserveAmount = MAX_SUPPLY - treasuryAmount - holderAmount - communityAmount;

        _mint(_treasury, treasuryAmount);
        _mint(_initialHolder, holderAmount);
        _mint(_treasury, communityAmount); // community pool managed by treasury
        _mint(_treasury, reserveAmount);   // reserve managed by treasury
    }

    /// @notice Mint new tokens (for quest rewards, affiliate payouts, etc.)
    /// @dev Only callable by authorized minters or owner. Cannot exceed MAX_SUPPLY.
    function mint(address to, uint256 amount) external onlyMinter {
        if (totalSupply() + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        _mint(to, amount);
    }

    /// @notice Update minter authorization
    function setMinter(address minter, bool authorized) external onlyOwner {
        if (minter == address(0)) revert ZeroAddress();
        minters[minter] = authorized;
        emit MinterUpdated(minter, authorized);
    }

    /// @notice Update treasury address
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }
}
