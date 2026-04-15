// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Universe} from "./Universe.sol";
import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ILoarHook} from "./interfaces/ILoarHook.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {ILoarLpLocker} from "./interfaces/ILoarLpLocker.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IHooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "./libraries/NodeOptions.sol";
import {UniverseData} from "./types/UniverseData.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";
import {Base64} from "@openzeppelin/utils/Base64.sol";

interface IUniverseTokenDeployer {
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external returns (
        address tokenAddress,
        address governor
    );
}

/// @title UniverseManager
/// @notice Factory that creates universes and represents each as a transferable ERC-721 NFT.
///         The NFT shows up in wallets (OpenSea, Rainbow, etc.) and proves universe ownership.
///         Before governance token deployment, transferring the NFT transfers admin control.
///         After governance, the NFT represents creator identity; admin is the governor.
contract UniverseManager is IUniverseManager, ERC721, ReentrancyGuard, Ownable {
    using Strings for uint256;
    using Strings for address;
    uint public constant teamFee = 0;
    address public teamFeeRecipient;
    address public tokenDeployer;
    uint256 public constant TOKEN_SUPPLY = 100_000_000_000e18; // 100b with 18 decimals
    uint256 public constant BPS = 10_000;

    /// @notice Fee required to mint a universe (default 0.05 ETH).
    uint256 public mintFee;

    /// @notice Split basis points: how much of mint fee goes to LP (rest to credit fund). Default 5000 = 50%.
    uint16 public mintFeeLpBps;

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
    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event MintFeeLpBpsUpdated(uint16 oldBps, uint16 newBps);

    constructor(address _teamFeeRecipient, address _lpRecipient) ERC721("LOAR Universe", "UNIVERSE") Ownable(msg.sender) {
        teamFeeRecipient = _teamFeeRecipient;
        lpRecipient = _lpRecipient;
        mintFee = 0.05 ether;
        mintFeeLpBps = 5000; // 50% to LP, 50% to credit fund
    }

    function setMintFee(uint256 _mintFee) external onlyOwner {
        emit MintFeeUpdated(mintFee, _mintFee);
        mintFee = _mintFee;
    }

    function setMintFeeLpBps(uint16 _mintFeeLpBps) external onlyOwner {
        require(_mintFeeLpBps <= 10_000, "Invalid bps");
        emit MintFeeLpBpsUpdated(mintFeeLpBps, _mintFeeLpBps);
        mintFeeLpBps = _mintFeeLpBps;
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
        require(balance > totalCreditFundsHeld, "No ETH to claim");
        uint256 claimable = balance - totalCreditFundsHeld;
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
        if (msg.value < mintFee) revert InsufficientMintFee();
        if (lpRecipient == address(0)) revert LpRecipientNotSet();

        // ── Fee split: configurable LP/credit split via mintFeeLpBps ──
        uint256 lpAmount     = (mintFee * mintFeeLpBps) / 10_000;
        uint256 creditAmount = mintFee - lpAmount;

        (bool lpSent,) = lpRecipient.call{value: lpAmount}("");
        require(lpSent, "LP fee transfer failed");

        // Refund any overpayment
        if (msg.value > mintFee) {
            (bool refunded,) = msg.sender.call{value: msg.value - mintFee}("");
            require(refunded, "Refund failed");
        }

        UniverseConfig memory config = UniverseConfig({
            nodeCreationOption: nodeCreationOptions,
            nodeVisibilityOption: nodeVisibilityOptions,
            universeAdmin: initialOwner,
            name: name,
            imageURL: imageURL,
            description: description,
            universeManager: address(this)
        });
        Universe universe = new Universe(config);
        UniverseData memory data = UniverseData({
            universe: IUniverse(universe),
            token: IERC20(address(0)),
            universeGovernor: IGovernor(address(0)),
            hook: IHooks(address(0)),
            locker: ILoarLpLocker(address(0))
        });

        uint256 currentId = latestId;
        universeDatas[currentId] = data;
        universeCreditFund[currentId] = creditAmount;
        totalCreditFundsHeld += creditAmount;

        latestId++;

        // Mint identity NFT to the universe creator — shows in wallet, transferable
        _safeMint(initialOwner, currentId);

        emit UniverseCreated(address(universe), msg.sender);
        emit UniverseMintFee(currentId, msg.sender, lpAmount, creditAmount);

        return (currentId, address(universe));
    }

    function deployUniverseToken(
        DeploymentConfig memory deploymentConfig,
        uint id
    ) public payable nonReentrant returns (address tokenAddress) {
        IUniverse universe = universeDatas[id].universe;
        require(address(universe) != address(0), "Universe does not exist");
        if (ownerOf(id) != msg.sender) {
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

    /// @notice Total universes created (also the next token ID)
    function totalSupply() external view returns (uint256) {
        return latestId;
    }

    // ── ERC-721 Identity NFT ───────────────────────────────────────

    /// @dev On transfer, sync the universe admin if governance hasn't been deployed yet.
    ///      After governance token deployment, admin = governor (immovable), so the NFT
    ///      represents creator identity only — doesn't change on-chain control.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);

        // Sync admin on the Universe contract if no governance token deployed yet
        UniverseData storage data = universeDatas[tokenId];
        if (address(data.universe) != address(0) && address(data.universeGovernor) == address(0)) {
            // Pre-governance: NFT holder = admin
            data.universe.setAdmin(to);
        }

        return from;
    }

    /// @notice Fully on-chain tokenURI with universe metadata — shows name, image,
    ///         description, and universe contract address in any wallet or marketplace.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        UniverseData storage data = universeDatas[tokenId];
        IUniverse universe = data.universe;

        string memory universeName = universe.universeName();
        string memory universeDesc = universe.universeDescription();
        string memory universeImage = universe.universeImageUrl();
        address universeAddr = address(universe);
        bool hasToken = address(data.token) != address(0);

        // Build JSON metadata on-chain (no external server needed)
        string memory json = string(abi.encodePacked(
            '{"name":"', universeName,
            '","description":"', universeDesc,
            '","image":"', universeImage,
            '","external_url":"https://loar.fun/universe/', universeAddr.toHexString(),
            '","attributes":[',
                '{"trait_type":"Universe Contract","value":"', universeAddr.toHexString(), '"}',
                ',{"trait_type":"Universe ID","value":"', tokenId.toString(), '"}',
                ',{"trait_type":"Has Token","value":"', hasToken ? 'true' : 'false', '"}',
                hasToken ? string(abi.encodePacked(
                    ',{"trait_type":"Token","value":"', address(data.token).toHexString(), '"}'
                )) : '',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }
}
