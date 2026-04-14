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
///      A small transfer fee is skimmed on every transfer and routed to the
///      liquidity pool address, deepening protocol-owned liquidity over time.
contract LoarToken is ERC20, ERC20Permit, ERC20Burnable, Ownable {
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 1 billion $LOAR
    uint256 public constant MAX_TRANSFER_FEE_BPS = 500; // hard cap: 5%
    uint256 public constant MAX_FEE_INCREASE_PER_CHANGE = 10; // max +0.1% per change — rate-limits rug
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Treasury address that receives platform revenue
    address public treasury;

    /// @notice Liquidity pool address that receives transfer fees
    address public liquidityPool;

    /// @notice Transfer fee in basis points (default 1 = 0.01%)
    uint256 public transferFeeBps = 1;

    /// @notice Addresses exempt from the transfer fee (treasury, LP, minters, etc.)
    mapping(address => bool) public feeExempt;

    /// @notice Addresses authorized to mint (platform backend, quest rewards, etc.)
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
        address _initialHolder
    ) ERC20("LOAR", "LOAR") ERC20Permit("LOAR") Ownable(msg.sender) {
        if (_treasury == address(0) || _initialHolder == address(0)) revert ZeroAddress();
        treasury = _treasury;

        // Treasury and initial holder are fee-exempt by default
        feeExempt[_treasury] = true;
        feeExempt[_initialHolder] = true;
        feeExempt[address(this)] = true;

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
        feeExempt[treasury] = false;
        treasury = newTreasury;
        feeExempt[newTreasury] = true;
    }

    /// @notice Set the liquidity pool address that receives transfer fees
    function setLiquidityPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        emit LiquidityPoolUpdated(liquidityPool, newPool);
        // Old pool loses exemption, new pool gains it
        if (liquidityPool != address(0)) feeExempt[liquidityPool] = false;
        liquidityPool = newPool;
        feeExempt[newPool] = true;
    }

    /// @notice Update the transfer fee (in basis points). Cannot exceed MAX_TRANSFER_FEE_BPS.
    ///         Increases are rate-limited to MAX_FEE_INCREASE_PER_CHANGE per call.
    ///         Decreases are unrestricted.
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
    ///         Prevents accidental double-fee on integrations.
    function batchSetFeeExempt(address[] calldata accounts, bool exempt) external onlyOwner {
        require(accounts.length <= 200, "Batch too large");
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            feeExempt[accounts[i]] = exempt;
            emit FeeExemptUpdated(accounts[i], exempt);
        }
    }

    /// @dev Override ERC20 _update to skim a transfer fee to the liquidity pool.
    ///      Fee is skipped for mints, burns, and exempt addresses.
    function _update(address from, address to, uint256 amount) internal override {
        bool shouldTakeFee = liquidityPool != address(0)
            && transferFeeBps > 0
            && from != address(0)       // not a mint
            && to != address(0)         // not a burn
            && !feeExempt[from]
            && !feeExempt[to];

        if (shouldTakeFee) {
            uint256 fee = (amount * transferFeeBps) / BPS_DENOMINATOR;
            uint256 amountAfterFee = amount - fee;

            // Route fee to liquidity pool
            super._update(from, liquidityPool, fee);
            emit LiquidityFeeCollected(from, to, fee);

            // Send remainder to recipient
            super._update(from, to, amountAfterFee);
        } else {
            super._update(from, to, amount);
        }
    }
}
