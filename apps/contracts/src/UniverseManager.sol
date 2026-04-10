// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Universe} from "./Universe.sol";
import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IOwnable} from "./interfaces/IOwnable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ILoarHook} from "./interfaces/ILoarHook.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {ILoarLpLocker} from "./interfaces/ILoarLpLocker.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import "./libraries/NodeOptions.sol";
import "./types/UniverseData.sol";

interface IUniverseTokenDeployer {
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external returns (
        address tokenAddress,
        address governor
    );
}

contract UniverseManager is IUniverseManager, ReentrancyGuard, Ownable {
    uint public teamFee;
    address public teamFeeRecipient;
    address public tokenDeployer;
    uint256 public constant TOKEN_SUPPLY = 100_000_000_000e18; // 100b with 18 decimals
    uint256 public constant BPS = 10_000;

    /// @notice Fee required to mint a universe (0.05 Base ETH).
    uint256 public constant MINT_FEE = 0.05 ether;

    /// @notice Address that receives the LP half of the mint fee to deepen $LOAR liquidity.
    address public lpRecipient;

    /// @notice Per-universe credit fund balance (wei) waiting to be converted to credits by the platform.
    mapping(uint256 => uint256) public universeCreditFund;

    /// @notice Total ETH held across all universe credit funds (must not be drained by claimEth).
    uint256 public totalCreditFundsHeld;

    mapping(uint id => UniverseData) universeDatas;
    mapping(address hook => bool enabled) public enabledHooks;
    mapping(address locker => mapping(address hook => bool enabled)) public enabledLockers;
    uint latestId;
    bool public deprecated;

    event SetTokenDeployer(address oldTokenDeployer, address newTokenDeployer);

    constructor(address _teamFeeRecipient, address _lpRecipient) Ownable(msg.sender) {
        teamFeeRecipient = _teamFeeRecipient;
        lpRecipient = _lpRecipient;
    }

    function setTokenDeployer(address _tokenDeployer) external onlyOwner {
        address oldTokenDeployer = tokenDeployer;
        tokenDeployer = _tokenDeployer;
        emit SetTokenDeployer(oldTokenDeployer, _tokenDeployer);
    }

    /// @notice Update the address that receives the LP half of the mint fee.
    function setLpRecipient(address _lpRecipient) external onlyOwner {
        require(_lpRecipient != address(0), "Zero address");
        address old = lpRecipient;
        lpRecipient = _lpRecipient;
        emit SetLpRecipient(old, _lpRecipient);
    }

    /// @notice Claim ETH held in the contract, excluding credit funds reserved for universes.
    function claimEth(address recipient) external onlyOwner {
        require(recipient != address(0), "Zero address");
        uint256 balance = address(this).balance;
        uint256 claimable = balance - totalCreditFundsHeld;
        require(claimable > 0, "No ETH to claim");
        (bool sent,) = recipient.call{value: claimable}("");
        require(sent, "ETH claim failed");
    }

    /// @notice Consume credit funds for a universe (called by owner after off-chain credit conversion).
    function consumeCreditFund(uint256 universeId, uint256 amount) external onlyOwner {
        require(universeCreditFund[universeId] >= amount, "Exceeds credit fund");
        universeCreditFund[universeId] -= amount;
        totalCreditFundsHeld -= amount;
    }

    receive() external payable {}

    function createUniverse(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner
    ) public payable nonReentrant returns (uint256 _id, address) {
        require(!deprecated, "Manager is deprecated");
        if (msg.value < MINT_FEE) revert InsufficientMintFee();
        if (lpRecipient == address(0)) revert LpRecipientNotSet();

        // ── Fee split: 50 % to LP recipient, 50 % held for universe credit pool ──
        uint256 lpAmount     = MINT_FEE / 2;           // 0.025 ETH → $LOAR LP
        uint256 creditAmount = MINT_FEE - lpAmount;    // 0.025 ETH → universe credit pool

        (bool lpSent,) = lpRecipient.call{value: lpAmount}("");
        require(lpSent, "LP fee transfer failed");

        // Refund any overpayment
        if (msg.value > MINT_FEE) {
            (bool refunded,) = msg.sender.call{value: msg.value - MINT_FEE}("");
            require(refunded, "Refund failed");
        }

        UniverseConfig memory config = UniverseConfig(
            nodeCreationOptions,
            nodeVisibilityOptions,
            initialOwner,
            name,
            imageURL,
            description,
            address(this)
        );
        Universe universe = new Universe(config);
        UniverseData memory data = UniverseData(
            IUniverse(universe),
            IERC20(address(0)),
            IGovernor(address(0)),
            IHooks(address(0)),
            ILoarLpLocker(address(0))
        );

        uint256 current_id = latestId;
        universeDatas[current_id] = data;
        universeCreditFund[current_id] = creditAmount;
        totalCreditFundsHeld += creditAmount;

        latestId++;

        emit UniverseCreated(address(universe), msg.sender);
        emit UniverseMintFee(current_id, msg.sender, lpAmount, creditAmount);

        return (current_id, address(universe));
    }

    function deployUniverseToken(
        DeploymentConfig memory deploymentConfig,
        uint id
    ) public payable nonReentrant returns (address tokenAddress) {
        IUniverse universe = universeDatas[id].universe;
        require(address(universe) != address(0), "Universe does not exist");
        if (universe.getAdmin() != msg.sender) {
          revert CallerIsNotOwner();
        }
        if (universe.getToken() != address(0)) {
          revert TokenAlreadyDeployed();
        }
      

        if (!enabledHooks[deploymentConfig.poolConfig.hook]) {
            revert HookNotEnabled();
        }

        if (!enabledLockers[deploymentConfig.lockerConfig.locker][deploymentConfig.poolConfig.hook]) {
            revert LockerNotEnabled();
        }

        (address _tokenAddress, address governor) =
            IUniverseTokenDeployer(tokenDeployer).deployTokenAndGovernance(
                deploymentConfig,
                id
            );

        require(_tokenAddress != address(0), "Token deployment returned zero address");
        require(governor != address(0), "Governor deployment returned zero address");

        tokenAddress = _tokenAddress;

        PoolKey memory poolkey = ILoarHook(deploymentConfig.poolConfig.hook).initializePool(
            tokenAddress,
            deploymentConfig.poolConfig.pairedToken,
            deploymentConfig.poolConfig.tickIfToken0IsLoar,
            deploymentConfig.poolConfig.tickSpacing,
            deploymentConfig.lockerConfig.locker,
            deploymentConfig.poolConfig.poolData
        );

        // Only LP portion (80%) is sent to this contract by UniverseTokenDeployer
        uint256 poolSupply = (TOKEN_SUPPLY * 8000) / 10000;
        IERC20(tokenAddress).approve(address(deploymentConfig.lockerConfig.locker), poolSupply);
        ILoarLpLocker(deploymentConfig.lockerConfig.locker).placeLiquidity(
            deploymentConfig.lockerConfig,
            deploymentConfig.poolConfig,
            poolkey,
            poolSupply,
            tokenAddress
        );

        universeDatas[id].token = IERC20(tokenAddress);
        universeDatas[id].universeGovernor = IGovernor(governor);
        universeDatas[id].hook = poolkey.hooks;
        universeDatas[id].locker = ILoarLpLocker(deploymentConfig.lockerConfig.locker);

        universe.setAdmin(governor);
        universe.setToken(tokenAddress);

        emit TokenCreated(
            msg.sender,
            tokenAddress,
            deploymentConfig.tokenConfig.tokenAdmin,
            deploymentConfig.tokenConfig.imageURL,
            deploymentConfig.tokenConfig.name,
            deploymentConfig.tokenConfig.symbol,
            deploymentConfig.tokenConfig.metadata,
            deploymentConfig.tokenConfig.context,
            deploymentConfig.poolConfig.tickIfToken0IsLoar,
            deploymentConfig.poolConfig.hook,
            poolkey.toId(),
            deploymentConfig.poolConfig.pairedToken,
            deploymentConfig.lockerConfig.locker,
            governor
        );
    }

    function setTeamFeeRecipient(address _teamFeeRecipient) public onlyOwner {
        address oldTeamFeeRecipient = teamFeeRecipient;
        teamFeeRecipient = _teamFeeRecipient;
        emit SetTeamFeeRecipient(oldTeamFeeRecipient, teamFeeRecipient);
    }

    function claimTeamFee(address token) external onlyOwner {
        if (teamFeeRecipient == address(0)) revert TeamFeeRecipientNotSet();

        uint256 balance = IERC20(token).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(token), teamFeeRecipient, balance);
        emit ClaimTeamFees(token, teamFeeRecipient, balance);
    }

    function setDeprecated(bool deprecated_) external onlyOwner {
        deprecated = deprecated_;
        emit SetDeprecated(deprecated_);
    }

    function setHook(address hook, bool enabled) external onlyOwner {
        // check that the hook supports the ILoarHook interface
        if (!ILoarHook(hook).supportsInterface(type(ILoarHook).interfaceId)) {
            revert InvalidHook();
        }

        enabledHooks[hook] = enabled;

        emit SetHook(hook, enabled);
    }

    function setLocker(address locker, address hook, bool enabled) external onlyOwner {
        // check that the locker supports the ILoarLpLocker interface
        if (!ILoarLpLocker(locker).supportsInterface(type(ILoarLpLocker).interfaceId)) {
            revert InvalidLocker();
        }

        enabledLockers[locker][hook] = enabled;

        emit SetLocker(locker, hook, enabled);
    }

    function getUniverseData(uint id) public view returns (
        IUniverse universe,
        IERC20 token,
        IGovernor universeGovernor,
        IHooks hook,
        ILoarLpLocker locker
    ) {
        UniverseData memory data = universeDatas[id];
        return (data.universe, data.token, data.universeGovernor, data.hook, data.locker);
    }
}
