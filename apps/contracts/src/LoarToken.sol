// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {Pausable} from "@openzeppelin/utils/Pausable.sol";

/// @title LoarToken ($LOAR)
/// @notice Platform utility token for LOAR — used to purchase generation credits
///         at a discounted rate (25% margin vs 35% for card/crypto).
///         Also used for quest rewards, affiliate payouts, and governance staking.
/// @dev ERC20 with permit (gasless approvals), burn, and owner-controlled minting.
///      TOKEN-02: Fee-on-transfer removed. All protocol contracts assume exact-amount transfers.
contract LoarToken is ERC20, ERC20Permit, ERC20Burnable, Ownable, Pausable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion $LOAR

    /// @notice Treasury address that receives platform revenue
    address public treasury;

    /// @notice Addresses exempt from fees or other protocol-level restrictions
    mapping(address => bool) public feeExempt;

    /// @notice Addresses authorized to mint (platform backend, quest rewards, etc.)
    mapping(address => bool) public minters;

    /// @notice Cumulative tokens ever minted (never decreases, even after burns).
    ///         Used instead of totalSupply() for the MAX_SUPPLY cap so that burns
    ///         cannot reopen minting headroom.
    uint256 public totalMinted;

    event MinterUpdated(address indexed minter, bool authorized);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeeExemptUpdated(address indexed account, bool exempt);

    error NotMinter();
    error ExceedsMaxSupply();
    error ZeroAddress();

    modifier onlyMinter() {
        _checkMinter();
        _;
    }

    function _checkMinter() internal view {
        if (!minters[msg.sender] && msg.sender != owner()) revert NotMinter();
    }

    constructor(
        address _treasury,
        address _initialHolder
    ) ERC20("LOAR", "LOAR") ERC20Permit("LOAR") Ownable(msg.sender) {
        if (_treasury == address(0) || _initialHolder == address(0)) revert ZeroAddress();
        treasury = _treasury;

        // Treasury and initial holder are fee-exempt by default
        feeExempt[_treasury] = true;
        feeExempt[_initialHolder] = true;
        feeExempt[address(this)] = true;

        // Initial distribution: 20% of MAX_SUPPLY
        // Remaining 80% mintable via quest rewards, faucet, affiliates, etc.
        // 10% — platform treasury (operations, initial liquidity)
        // 10% — initial holder (team/founder vesting)
        uint256 treasuryAmount = (MAX_SUPPLY * 10) / 100;
        uint256 holderAmount = (MAX_SUPPLY * 10) / 100;

        _mint(_treasury, treasuryAmount);
        _mint(_initialHolder, holderAmount);

        // Track initial distribution against the permanent cap
        totalMinted = treasuryAmount + holderAmount;
    }

    /// @notice Mint new tokens (for quest rewards, affiliate payouts, etc.)
    /// @dev Only callable by authorized minters or owner. Uses totalMinted (not totalSupply())
    ///      so that burns cannot reopen minting headroom — the cap is permanent.
    function mint(address to, uint256 amount) external onlyMinter {
        if (totalMinted + amount > MAX_SUPPLY) revert ExceedsMaxSupply();
        totalMinted += amount;
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
        feeExempt[treasury] = false;
        treasury = newTreasury;
        feeExempt[newTreasury] = true;
    }

    /// @notice Set fee exemption for an address
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    /// @notice Batch-set fee exemptions for multiple addresses
    function batchSetFeeExempt(address[] calldata accounts, bool exempt) external onlyOwner {
        require(accounts.length <= 200, "Batch too large");
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            feeExempt[accounts[i]] = exempt;
            emit FeeExemptUpdated(accounts[i], exempt);
        }
    }

    /// @notice Emergency pause — halts all transfers. Only callable by owner.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause — resumes all transfers. Only callable by owner.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @dev Override ERC20 _update to enforce pause on all transfers.
    ///      TOKEN-02: Fee-on-transfer removed. All protocol contracts assume exact-amount transfers.
    function _update(address from, address to, uint256 amount) internal override whenNotPaused {
        super._update(from, to, amount);
    }
}
