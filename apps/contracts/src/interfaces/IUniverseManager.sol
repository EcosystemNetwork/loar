// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../libraries/NodeOptions.sol";
import {IUniverse} from "./IUniverse.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {IHooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {ILoarLpLocker} from "./ILoarLpLocker.sol";

/// @title IUniverseManager
/// @notice Interface for the factory contract that creates universes, deploys governance tokens,
///         initializes Uniswap v4 pools, and locks LP positions.
interface IUniverseManager {
    struct UniverseConfig {
        NodeCreationOptions nodeCreationOption;
        NodeVisibilityOptions nodeVisibilityOption;
        address universeAdmin;
        string name;
        string imageURL;
        string description;
        address universeManager;
    }
    struct TokenConfig {
        address tokenAdmin;
        string name;
        string symbol;
        string imageURL;
        string metadata;
        string context;
    }

    struct PoolConfig {
        address hook;
        address pairedToken;
        int24 tickIfToken0IsLoar;
        int24 tickSpacing;
        bytes poolData;
    }

    struct AllocationConfig {
        uint16 curveBps;      // % → bonding curve (min 5000 = 50%)
        uint16 creatorBps;    // % → universe creator
        uint16 treasuryBps;   // % → protocol treasury (min 200 = 2%)
        uint16 communityBps;  // % → community rewards
    }

    struct DeploymentConfig {
        TokenConfig tokenConfig;
        PoolConfig poolConfig;
        LockerConfig lockerConfig;
        AllocationConfig allocationConfig;
    }

    struct LockerConfig {
        address locker;
        // reward info
        address[] rewardAdmins;
        address[] rewardRecipients;
        uint16[] rewardBps;
        // liquidity placement info
        int24[] tickLower;
        int24[] tickUpper;
        uint16[] positionBps;
        bytes lockerData;
    }

    event UniverseCreated(
        address universe,
        address creator
    );
    /// @notice Emitted when the mint fee ETH is stored as LP seed for the universe's token pool.
    event UniverseLpSeed(
        uint256 indexed universeId,
        address indexed creator,
        uint256 amount
    );
    event TokenDeployed();
    event BondingCurveCreated(
        uint256 indexed universeId,
        address indexed token,
        address indexed bondingCurve,
        uint256 graduationEth,
        uint256 curveSupply
    );
    event TokenGraduated(
        uint256 indexed universeId,
        address indexed token,
        uint256 ethRaised,
        uint256 lpTokens
    );
    event SetTeamFeeRecipient(
        address oldTeamFeeRecipient,
        address newTeamFeeRecipient
    );
    event ClaimTeamFees(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );
    event TokenCreated(
        address msgSender,
        address indexed tokenAddress,
        address indexed tokenAdmin,
        string tokenImage,
        string tokenName,
        string tokenSymbol,
        string tokenMetadata,
        string tokenContext,
        int24 startingTick,
        address poolHook,
        PoolId poolId,
        address pairedToken,
        address locker,
        address governor
    );
    event UniverseCreatedWithToken(
        uint256 indexed universeId,
        address universe,
        address token,
        address governor
    );
    event SetIdentityNft(address oldIdentityNft, address newIdentityNft);
    event SetLocker(address locker, address hook, bool enabled);
    event SetDeprecated(bool deprecated);
    event SetHook(address hook, bool enabled);
    error Deprecated();
    error TeamFeeRecipientNotSet();
    error InsufficientMintFee();
    error DeployerIsNotOwner();
    error HookNotEnabled();
    error InvalidHook();
    error InvalidLocker();
    error LockerNotEnabled();
    error CallerIsNotOwner();
    error TokenAlreadyDeployed();


    function createUniverse(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner
    ) external payable returns (uint _id, address);

    function deployUniverseToken(
        DeploymentConfig memory deploymentConfig,
        uint id
    ) external returns (address tokenAddress);

    function createUniverseWithToken(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner,
        DeploymentConfig memory deploymentConfig
    ) external payable returns (
        uint256 universeId,
        address universeAddress,
        address tokenAddress
    );

    function graduateFromBondingCurve(
        uint256 universeId,
        uint256 ethAmount,
        uint256 tokenAmount,
        address token
    ) external payable;

    function enabledHooks(address hook) external view returns (bool);

    function enabledLockers(address locker, address hook) external view returns (bool);

    function getUniverseData(uint id) external view returns (
        IUniverse universe,
        IERC20 token,
        IGovernor universeGovernor,
        IHooks hook,
        ILoarLpLocker locker,
        address bondingCurve
    );
}
