// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";

/// @title LoarTokenSpoke ($LOAR — Spoke Chain)
/// @notice Deployed on non-hub EVM chains (Ethereum, Arbitrum, Optimism, etc.)
///         where Wormhole NTT mints/burns supply via burn-and-mint mode.
/// @dev Identical to LoarToken.sol except:
///      - No MAX_SUPPLY cap (NTT manages global supply invariant across chains)
///      - NTT Manager is the sole minter (set at deploy, can be updated)
///      - Same 0.05% auto-liquidity transfer fee
contract LoarTokenSpoke is ERC20, ERC20Permit, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1B cap — defense-in-depth even with NTT
    uint256 public constant MAX_TRANSFER_FEE_BPS = 500; // hard cap: 5%
    uint256 public constant MAX_FEE_INCREASE_PER_CHANGE = 10; // max +0.1% per change — rate-limits rug
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Treasury address that receives platform revenue
    address public treasury;

    /// @notice Liquidity pool address that receives transfer fees
    address public liquidityPool;

    /// @notice Transfer fee in basis points (default 5 = 0.05%)
    uint256 public transferFeeBps = 5;

    /// @notice Addresses exempt from the transfer fee
    mapping(address => bool) public feeExempt;

    /// @notice Addresses authorized to mint (NTT Manager)
    mapping(address => bool) public minters;

    event MinterUpdated(address indexed minter, bool authorized);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event LiquidityPoolUpdated(address indexed oldPool, address indexed newPool);
    event TransferFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeExemptUpdated(address indexed account, bool exempt);
    event LiquidityFeeCollected(address indexed from, address indexed to, uint256 fee);

    error NotMinter();
    error ExceedsMaxSupply();
    error ZeroAddress();
    error FeeTooHigh();
    error FeeIncreaseExceedsLimit();

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
    /// @dev Per-chain cap as defense-in-depth. NTT enforces the global invariant across chains.
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
        feeExempt[treasury] = false;
        treasury = newTreasury;
        feeExempt[newTreasury] = true;
    }

    /// @notice Set the liquidity pool address that receives transfer fees
    function setLiquidityPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        emit LiquidityPoolUpdated(liquidityPool, newPool);
        if (liquidityPool != address(0)) feeExempt[liquidityPool] = false;
        liquidityPool = newPool;
        feeExempt[newPool] = true;
    }

    /// @notice Update the transfer fee (in basis points).
    ///         Increases are rate-limited to MAX_FEE_INCREASE_PER_CHANGE per call.
    function setTransferFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_TRANSFER_FEE_BPS) revert FeeTooHigh();
        if (newFeeBps > transferFeeBps && newFeeBps - transferFeeBps > MAX_FEE_INCREASE_PER_CHANGE) {
            revert FeeIncreaseExceedsLimit();
        }
        emit TransferFeeUpdated(transferFeeBps, newFeeBps);
        transferFeeBps = newFeeBps;
    }

    /// @notice Set fee exemption for an address
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    /// @notice Batch-set fee exemptions for DEX routers, pools, hooks, etc.
    function batchSetFeeExempt(address[] calldata accounts, bool exempt) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            feeExempt[accounts[i]] = exempt;
            emit FeeExemptUpdated(accounts[i], exempt);
        }
    }

    /// @dev Override ERC20 _update to skim transfer fee to LP.
    function _update(address from, address to, uint256 amount) internal override {
        bool shouldTakeFee = liquidityPool != address(0)
            && transferFeeBps > 0
            && from != address(0)
            && to != address(0)
            && !feeExempt[from]
            && !feeExempt[to];

        if (shouldTakeFee) {
            uint256 fee = (amount * transferFeeBps) / BPS_DENOMINATOR;
            uint256 amountAfterFee = amount - fee;

            super._update(from, liquidityPool, fee);
            emit LiquidityFeeCollected(from, to, fee);
            super._update(from, to, amountAfterFee);
        } else {
            super._update(from, to, amount);
        }
    }
}
