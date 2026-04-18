// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {Pausable} from "@openzeppelin/utils/Pausable.sol";

/// @title LoarTokenSpoke ($LOAR — Spoke Chain)
/// @notice Deployed on non-hub EVM chains (Ethereum, Arbitrum, Optimism, etc.)
///         where Wormhole NTT mints/burns supply via burn-and-mint mode.
/// @dev Identical to LoarToken.sol except:
///      - NTT Manager is the sole minter (set at deploy, can be updated)
///      - Per-chain MAX_SUPPLY as defense-in-depth (NTT manages global invariant)
///      TOKEN-02: Fee-on-transfer removed. All protocol contracts assume exact-amount transfers.
contract LoarTokenSpoke is ERC20, ERC20Permit, ERC20Burnable, Ownable, Pausable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1B cap — defense-in-depth even with NTT

    /// @notice Treasury address that receives platform revenue
    address public treasury;

    /// @notice Cumulative tokens minted (never decreases). Prevents burn-and-remint cap bypass.
    uint256 public totalMinted;

    /// @notice Addresses exempt from fees or other protocol-level restrictions
    mapping(address => bool) public feeExempt;

    /// @notice Addresses authorized to mint (NTT Manager)
    mapping(address => bool) public minters;

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
        address _nttManager
    ) ERC20("LOAR", "LOAR") ERC20Permit("LOAR") Ownable(msg.sender) {
        if (_treasury == address(0) || _nttManager == address(0)) revert ZeroAddress();
        treasury = _treasury;

        // NTT Manager is the sole minter on spoke chains
        minters[_nttManager] = true;
        emit MinterUpdated(_nttManager, true);

        // NTT Manager + treasury are fee-exempt
        feeExempt[_treasury] = true;
        feeExempt[_nttManager] = true;
        feeExempt[address(this)] = true;
    }

    /// @notice Mint tokens (called by NTT Manager when tokens arrive from another chain).
    /// @dev SPOKE-01: totalMinted tracks cumulative mints (like hub) to prevent burn-and-remint cap bypass.
    ///      Per-chain cap as defense-in-depth. NTT enforces the global invariant across chains.
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

    /// @notice Emergency pause — halts all transfers. Only callable by owner.
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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

    /// @dev Override ERC20 _update to enforce pause on all transfers.
    ///      TOKEN-02: Fee-on-transfer removed. All protocol contracts assume exact-amount transfers.
    function _update(address from, address to, uint256 amount) internal override whenNotPaused {
        super._update(from, to, amount);
    }
}
