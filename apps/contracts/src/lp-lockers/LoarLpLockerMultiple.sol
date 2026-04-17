// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IUniverseManager} from "../interfaces/IUniverseManager.sol";
import {ILoarFeeLocker} from "../interfaces/ILoarFeeLocker.sol";
import {ILoarLpLocker} from "../interfaces/ILoarLpLocker.sol";
import {ILoarLpLockerMultiple} from "../interfaces/ILoarLpLockerMultiple.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {IPermit2} from "permit2/src/interfaces/IPermit2.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

/// @title LoarLpLockerMultiple
/// @notice Permanently locks Uniswap v4 LP positions and distributes swap fee rewards to configurable recipients.
/// @dev Supports multiple tick-range positions per token and up to 7 reward recipients with basis-point splits.
///      LP NFTs are locked forever — only accrued fees can be collected and distributed via the FeeLocker.
contract LoarLpLockerMultiple is ILoarLpLockerMultiple, ReentrancyGuard, Ownable {
    using TickMath for int24;
    using SafeERC20 for IERC20;

    string public constant VERSION = "1";

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant MAX_REWARD_PARTICIPANTS = 7;
    uint256 public constant MAX_LP_POSITIONS = 7;

    IPositionManager public immutable positionManager;
    IPermit2 public immutable permit2;
    ILoarFeeLocker public immutable feeLocker;
    address public immutable factory;
    mapping(address token => TokenRewardInfo tokenRewardInfo) internal _tokenRewards;

    uint256 public constant REWARD_CHANGE_DELAY = 2 days;

    /// @notice Pending 2-step reward recipient changes: token => rewardIndex => new recipient
    mapping(address => mapping(uint256 => address)) public pendingRewardRecipient;
    /// @notice Pending 2-step reward admin changes: token => rewardIndex => new admin
    mapping(address => mapping(uint256 => address)) public pendingRewardAdmin;
    /// @notice Timestamp when a reward change was requested: token => rewardIndex => timestamp
    mapping(address => mapping(uint256 => uint256)) public rewardChangeRequestedAt;

    /// @notice Tokens that are part of active LP pools and must not be drained via withdrawERC20.
    mapping(address => bool) public protectedToken;

    constructor(
        address owner_,
        address factory_, // Address of the loar factory
        address feeLocker_,
        address positionManager_, // Address of the position manager
        address permit2_ // address of the permit2 contract
    ) Ownable(owner_) {
        factory = factory_;
        feeLocker = ILoarFeeLocker(feeLocker_);
        positionManager = IPositionManager(positionManager_);
        permit2 = IPermit2(permit2_);
    }

    modifier onlyFactory() {
        _checkFactory();
        _;
    }

    function _checkFactory() internal view {
        if (msg.sender != factory) {
            revert Unauthorized();
        }
    }

    function tokenRewards(address token) external view returns (TokenRewardInfo memory) {
        return _tokenRewards[token];
    }

    function placeLiquidity(
        IUniverseManager.LockerConfig memory lockerConfig,
        IUniverseManager.PoolConfig memory poolConfig,
        PoolKey memory poolKey,
        uint256 poolSupply,
        address token,
        uint256 pairedAmount
    ) external onlyFactory nonReentrant returns (uint256 positionId) {
        // ensure that we don't already have a reward for this token
        if (_tokenRewards[token].positionId != 0) {
            revert TokenAlreadyHasRewards();
        }

        // create the reward info
        TokenRewardInfo memory tokenRewardInfo = TokenRewardInfo({
            token: token,
            poolKey: poolKey,
            positionId: 0, // set below
            numPositions: lockerConfig.tickLower.length,
            rewardBps: lockerConfig.rewardBps,
            rewardAdmins: lockerConfig.rewardAdmins,
            rewardRecipients: lockerConfig.rewardRecipients
        });

        // check that all arrays are the same length
        if (
            tokenRewardInfo.rewardBps.length != tokenRewardInfo.rewardAdmins.length
                || tokenRewardInfo.rewardBps.length != tokenRewardInfo.rewardRecipients.length
        ) {
            revert MismatchedRewardArrays();
        }

        // check that the number of reward participants is not greater than the max
        if (tokenRewardInfo.rewardBps.length > MAX_REWARD_PARTICIPANTS) {
            revert TooManyRewardParticipants();
        }

        // check that there is at least one reward
        if (tokenRewardInfo.rewardBps.length == 0) {
            revert NoRewardRecipients();
        }

        // check that the reward amounts add up to 10000
        uint16 totalRewards = 0;
        for (uint256 i = 0; i < tokenRewardInfo.rewardBps.length; i++) {
            totalRewards += tokenRewardInfo.rewardBps[i];
            if (tokenRewardInfo.rewardBps[i] == 0) {
                revert ZeroRewardAmount();
            }
        }
        if (totalRewards != BASIS_POINTS) {
            revert InvalidRewardBps();
        }

        // check that no address is the zero address
        for (uint256 i = 0; i < tokenRewardInfo.rewardBps.length; i++) {
            if (
                tokenRewardInfo.rewardAdmins[i] == address(0)
                    || tokenRewardInfo.rewardRecipients[i] == address(0)
            ) {
                revert ZeroRewardAddress();
            }
        }

        // pull in the token supply
        IERC20(token).safeTransferFrom(msg.sender, address(this), poolSupply);

        // pull in paired token (WETH) for two-sided liquidity if provided
        address pairedToken = poolConfig.pairedToken;
        if (pairedAmount > 0) {
            IERC20(pairedToken).safeTransferFrom(msg.sender, address(this), pairedAmount);
        }

        positionId = _mintLiquidity(poolConfig, lockerConfig, poolKey, poolSupply, token, pairedAmount);

        // store the reward info
        tokenRewardInfo.positionId = positionId;
        _tokenRewards[token] = tokenRewardInfo;

        // Mark both pool currencies as protected from owner withdrawal
        protectedToken[Currency.unwrap(poolKey.currency0)] = true;
        protectedToken[Currency.unwrap(poolKey.currency1)] = true;

        emit TokenRewardAdded({
            token: tokenRewardInfo.token,
            poolKey: tokenRewardInfo.poolKey,
            poolSupply: poolSupply,
            positionId: tokenRewardInfo.positionId,
            numPositions: tokenRewardInfo.numPositions,
            rewardBps: tokenRewardInfo.rewardBps,
            rewardAdmins: tokenRewardInfo.rewardAdmins,
            rewardRecipients: tokenRewardInfo.rewardRecipients,
            tickLower: lockerConfig.tickLower,
            tickUpper: lockerConfig.tickUpper,
            positionBps: lockerConfig.positionBps
        });
    }

    function _mintLiquidity(
        IUniverseManager.PoolConfig memory poolConfig,
        IUniverseManager.LockerConfig memory lockerConfig,
        PoolKey memory poolKey,
        uint256 poolSupply,
        address token,
        uint256 pairedAmount
    ) internal returns (uint256 positionId) {
        // check that all position infos are the same length
        if (
            lockerConfig.tickLower.length != lockerConfig.tickUpper.length
                || lockerConfig.tickLower.length != lockerConfig.positionBps.length
        ) {
            revert MismatchedPositionInfos();
        }

        // ensure that there is at least one position
        if (lockerConfig.tickLower.length == 0) {
            revert NoPositions();
        }

        // ensure that the max number of positions is not exceeded
        if (lockerConfig.tickLower.length > MAX_LP_POSITIONS) {
            revert TooManyPositions();
        }

        // make sure the locker position config is valid
        uint256 positionBpsTotal = 0;
        for (uint256 i = 0; i < lockerConfig.tickLower.length; i++) {
            if (lockerConfig.tickLower[i] > lockerConfig.tickUpper[i]) {
                revert TicksBackwards();
            }
            if (
                lockerConfig.tickLower[i] < TickMath.MIN_TICK
                    || lockerConfig.tickUpper[i] > TickMath.MAX_TICK
            ) {
                revert TicksOutOfTickBounds();
            }
            if (
                lockerConfig.tickLower[i] % poolConfig.tickSpacing != 0
                    || lockerConfig.tickUpper[i] % poolConfig.tickSpacing != 0
            ) {
                revert TicksNotMultipleOfTickSpacing();
            }
            if (lockerConfig.tickLower[i] < poolConfig.tickIfToken0IsLoar) {
                revert TickRangeLowerThanStartingTick();
            }

            positionBpsTotal += lockerConfig.positionBps[i];
        }
        if (positionBpsTotal != BASIS_POINTS) {
            revert InvalidPositionBps();
        }

        bool token0IsLoar = token < poolConfig.pairedToken;

        // encode actions
        bytes[] memory params = new bytes[](lockerConfig.tickLower.length + 1);
        bytes memory actions;

        int24 startingTick =
            token0IsLoar ? poolConfig.tickIfToken0IsLoar : -poolConfig.tickIfToken0IsLoar;

        for (uint256 i = 0; i < lockerConfig.tickLower.length; i++) {
            // add mint action
            actions = abi.encodePacked(actions, uint8(Actions.MINT_POSITION));

            // determine token amount for this position
            uint256 tokenAmount = poolSupply * lockerConfig.positionBps[i] / BASIS_POINTS;
            // Split paired amount (WETH) proportionally across positions
            uint256 pairedForPosition = pairedAmount * lockerConfig.positionBps[i] / BASIS_POINTS;
            uint256 amount0 = token0IsLoar ? tokenAmount : pairedForPosition;
            uint256 amount1 = token0IsLoar ? pairedForPosition : tokenAmount;

            // determine tick bounds for this position
            int24 tickLower_ =
                token0IsLoar ? lockerConfig.tickLower[i] : -lockerConfig.tickLower[i];
            int24 tickUpper_ =
                token0IsLoar ? lockerConfig.tickUpper[i] : -lockerConfig.tickUpper[i];
            int24 tickLower = token0IsLoar ? tickLower_ : tickUpper_;
            int24 tickUpper = token0IsLoar ? tickUpper_ : tickLower_;
            uint160 lowerSqrtPrice = TickMath.getSqrtPriceAtTick(tickLower);
            uint160 upperSqrtPrice = TickMath.getSqrtPriceAtTick(tickUpper);

            // determine liquidity amount
            uint256 liquidity = LiquidityAmounts.getLiquidityForAmounts(
                startingTick.getSqrtPriceAtTick(), lowerSqrtPrice, upperSqrtPrice, amount0, amount1
            );

            params[i] = abi.encode(
                poolKey,
                tickLower, // tick lower
                tickUpper, // tick upper
                liquidity, // liquidity
                amount0, // amount0Max
                amount1, // amount1Max
                address(this), // recipient of position
                abi.encode(address(this))
            );
        }

        // add settle action
        actions = abi.encodePacked(actions, uint8(Actions.SETTLE_PAIR));
        params[lockerConfig.tickLower.length] = abi.encode(poolKey.currency0, poolKey.currency1);

        // approvals for universe token
        {
            IERC20(token).approve(address(permit2), poolSupply);
            permit2.approve(
                // forge-lint: disable-next-line(unsafe-typecast)
                token, address(positionManager), uint160(poolSupply), uint48(block.timestamp)
            );
        }

        // approvals for paired token (WETH) if seeding two-sided liquidity
        if (pairedAmount > 0) {
            address pairedToken = poolConfig.pairedToken;
            IERC20(pairedToken).approve(address(permit2), pairedAmount);
            permit2.approve(
                pairedToken, address(positionManager), uint160(pairedAmount), uint48(block.timestamp)
            );
        }

        // grab position id we're about to mint
        positionId = positionManager.nextTokenId();
        // add liquidity
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
    }

    // collect rewards while pool is unlocked (e.g. in an afterSwap hook)
    function collectRewardsWithoutUnlock(address token) external nonReentrant {
        _collectRewards(token, true);
    }

    // collect rewards while pool is locked
    function collectRewards(address token) external nonReentrant {
        _collectRewards(token, false);
    }

    // Collect rewards for a token
    function _collectRewards(address token, bool withoutUnlock) internal {
        // get the reward info
        TokenRewardInfo memory tokenRewardInfo = _tokenRewards[token];

        // collect the rewards
        (uint256 amount0, uint256 amount1) = _bringFeesIntoContract(
            tokenRewardInfo.poolKey,
            tokenRewardInfo.positionId,
            tokenRewardInfo.numPositions,
            withoutUnlock
        );

        IERC20 rewardToken0 = IERC20(Currency.unwrap(tokenRewardInfo.poolKey.currency0));
        IERC20 rewardToken1 = IERC20(Currency.unwrap(tokenRewardInfo.poolKey.currency1));

        // determine reward distribution
        uint256[] memory rewards0 = new uint256[](tokenRewardInfo.rewardBps.length);
        uint256[] memory rewards1 = new uint256[](tokenRewardInfo.rewardBps.length);
        uint256 reward0Total = 0;
        uint256 reward1Total = 0;

        for (uint256 i = 0; i < tokenRewardInfo.rewardBps.length - 1; i++) {
            rewards0[i] = uint256(tokenRewardInfo.rewardBps[i]) * amount0 / BASIS_POINTS;
            rewards1[i] = uint256(tokenRewardInfo.rewardBps[i]) * amount1 / BASIS_POINTS;
            reward0Total += rewards0[i];
            reward1Total += rewards1[i];
        }
        rewards0[tokenRewardInfo.rewardBps.length - 1] = amount0 - reward0Total;
        rewards1[tokenRewardInfo.rewardBps.length - 1] = amount1 - reward1Total;

        // distribute the rewards
        for (uint256 i = 0; i < tokenRewardInfo.rewardBps.length; i++) {
            if (rewards0[i] > 0) {
                SafeERC20.forceApprove(rewardToken0, address(feeLocker), rewards0[i]);
                feeLocker.storeFees(
                    tokenRewardInfo.rewardRecipients[i], address(rewardToken0), rewards0[i]
                );
            }
            if (rewards1[i] > 0) {
                SafeERC20.forceApprove(rewardToken1, address(feeLocker), rewards1[i]);
                feeLocker.storeFees(
                    tokenRewardInfo.rewardRecipients[i], address(rewardToken1), rewards1[i]
                );
            }
        }

        // emit the claim event
        emit ClaimedRewards(tokenRewardInfo.token, amount0, amount1, rewards0, rewards1);
    }

    function _bringFeesIntoContract(
        PoolKey memory poolKey,
        uint256 positionId,
        uint256 numPositions,
        bool withoutUnlock
    ) internal returns (uint256 amount0, uint256 amount1) {
        bytes memory actions;
        bytes[] memory params = new bytes[](numPositions + 1);

        for (uint256 i = 0; i < numPositions; i++) {
            actions = abi.encodePacked(actions, uint8(Actions.DECREASE_LIQUIDITY));
            /// @dev collecting fees is achieved with liquidity=0, the second parameter
            params[i] = abi.encode(positionId + i, 0, 0, 0, abi.encode());
        }

        Currency currency0 = poolKey.currency0;
        Currency currency1 = poolKey.currency1;
        actions = abi.encodePacked(actions, uint8(Actions.TAKE_PAIR));
        params[numPositions] = abi.encode(currency0, currency1, address(this));

        uint256 balance0Before = IERC20(Currency.unwrap(currency0)).balanceOf(address(this));
        uint256 balance1Before = IERC20(Currency.unwrap(currency1)).balanceOf(address(this));

        // when claiming from the hook, we need to call modifyLiquiditiesWithoutUnlock since
        // the pool will be in an unlocked state
        if (withoutUnlock) {
            positionManager.modifyLiquiditiesWithoutUnlock(actions, params);
        } else {
            positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        }

        uint256 balance0After = IERC20(Currency.unwrap(currency0)).balanceOf(address(this));
        uint256 balance1After = IERC20(Currency.unwrap(currency1)).balanceOf(address(this));

        return (balance0After - balance0Before, balance1After - balance1Before);
    }

    // Request a reward recipient change (2-step with delay)
    function requestRewardRecipientChange(address token, uint256 rewardIndex, address newRecipient)
        external
    {
        TokenRewardInfo storage tokenRewardInfo = _tokenRewards[token];
        require(rewardIndex < tokenRewardInfo.rewardAdmins.length, "Index out of bounds");
        require(newRecipient != address(0), "Cannot set zero address recipient");

        // Only admin can request a reward recipient change
        if (msg.sender != tokenRewardInfo.rewardAdmins[rewardIndex]) {
            revert Unauthorized();
        }

        pendingRewardRecipient[token][rewardIndex] = newRecipient;
        rewardChangeRequestedAt[token][rewardIndex] = block.timestamp;

        emit RewardRecipientChangeRequested(
            token, rewardIndex, newRecipient, block.timestamp + REWARD_CHANGE_DELAY
        );
    }

    // Execute a pending reward recipient change after delay
    function executeRewardRecipientChange(address token, uint256 rewardIndex) external {
        TokenRewardInfo storage tokenRewardInfo = _tokenRewards[token];
        require(rewardIndex < tokenRewardInfo.rewardAdmins.length, "Index out of bounds");

        uint256 requestedAt = rewardChangeRequestedAt[token][rewardIndex];
        address newRecipient = pendingRewardRecipient[token][rewardIndex];

        if (requestedAt == 0 || newRecipient == address(0)) {
            revert RewardChangeNotRequested();
        }
        if (block.timestamp < requestedAt + REWARD_CHANGE_DELAY) {
            revert RewardChangeDelayNotMet();
        }

        // Only admin can execute the change
        if (msg.sender != tokenRewardInfo.rewardAdmins[rewardIndex]) {
            revert Unauthorized();
        }

        address oldRecipient = tokenRewardInfo.rewardRecipients[rewardIndex];
        tokenRewardInfo.rewardRecipients[rewardIndex] = newRecipient;

        // Clear pending state
        delete pendingRewardRecipient[token][rewardIndex];
        delete rewardChangeRequestedAt[token][rewardIndex];

        emit RewardRecipientUpdated(token, rewardIndex, oldRecipient, newRecipient);
    }

    // Request a reward admin change (2-step with delay)
    function requestRewardAdminChange(address token, uint256 rewardIndex, address newAdmin)
        external
    {
        TokenRewardInfo storage tokenRewardInfo = _tokenRewards[token];
        require(rewardIndex < tokenRewardInfo.rewardAdmins.length, "Index out of bounds");
        require(newAdmin != address(0), "Cannot set zero address admin");

        // Only current admin can request an admin change
        if (msg.sender != tokenRewardInfo.rewardAdmins[rewardIndex]) {
            revert Unauthorized();
        }

        pendingRewardAdmin[token][rewardIndex] = newAdmin;
        rewardChangeRequestedAt[token][rewardIndex] = block.timestamp;

        emit RewardAdminChangeRequested(
            token, rewardIndex, newAdmin, block.timestamp + REWARD_CHANGE_DELAY
        );
    }

    // Execute a pending reward admin change after delay
    function executeRewardAdminChange(address token, uint256 rewardIndex) external {
        TokenRewardInfo storage tokenRewardInfo = _tokenRewards[token];
        require(rewardIndex < tokenRewardInfo.rewardAdmins.length, "Index out of bounds");

        uint256 requestedAt = rewardChangeRequestedAt[token][rewardIndex];
        address newAdmin = pendingRewardAdmin[token][rewardIndex];

        if (requestedAt == 0 || newAdmin == address(0)) {
            revert RewardChangeNotRequested();
        }
        if (block.timestamp < requestedAt + REWARD_CHANGE_DELAY) {
            revert RewardChangeDelayNotMet();
        }

        // Only current admin can execute the change
        if (msg.sender != tokenRewardInfo.rewardAdmins[rewardIndex]) {
            revert Unauthorized();
        }

        address oldAdmin = tokenRewardInfo.rewardAdmins[rewardIndex];
        tokenRewardInfo.rewardAdmins[rewardIndex] = newAdmin;

        // Clear pending state
        delete pendingRewardAdmin[token][rewardIndex];
        delete rewardChangeRequestedAt[token][rewardIndex];

        emit RewardAdminUpdated(token, rewardIndex, oldAdmin, newAdmin);
    }

    // Enable contract to receive LP Tokens
    function onERC721Received(address, address from, uint256 id, bytes calldata)
        external
        returns (bytes4)
    {
        // Only Loar Factory can send NFTs here
        if (from != factory) {
            revert Unauthorized();
        }

        emit Received(from, id);
        return IERC721Receiver.onERC721Received.selector;
    }

    // Withdraw ETH from the contract
    function withdrawEth(address recipient) public onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        (bool success, ) = payable(recipient).call{value: address(this).balance}("");
        require(success, "ETH transfer failed");
    }

    // Withdraw ERC20 tokens from the contract (only non-pool tokens)
    function withdrawERC20(address token, address recipient) public onlyOwner nonReentrant {
        require(!protectedToken[token], "Cannot withdraw pool currency");
        IERC20 token_ = IERC20(token);
        SafeERC20.safeTransfer(token_, recipient, token_.balanceOf(address(this)));
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId
            || interfaceId == type(ILoarLpLocker).interfaceId;
    }
}
