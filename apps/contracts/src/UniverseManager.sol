// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {IUniverseFactory} from "./interfaces/IUniverseFactory.sol";
import {IUniverseMetadataRenderer} from "./interfaces/IUniverseMetadataRenderer.sol";
import {IBondingCurve} from "./interfaces/IBondingCurve.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {Pausable} from "@openzeppelin/utils/Pausable.sol";
import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {ILoarHook} from "./interfaces/ILoarHook.sol";
import {IGovernor} from "@openzeppelin/governance/IGovernor.sol";
import {ILoarLpLocker} from "./interfaces/ILoarLpLocker.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "./libraries/NodeOptions.sol";
import {UniverseData} from "./types/UniverseData.sol";
import {IdentityNFT} from "./IdentityNFT.sol";

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IGnosisSafe {
    function getOwners() external view returns (address[] memory);
    function getThreshold() external view returns (uint256);
}

interface IUniverseTokenDeployer {
    function deployTokenAndGovernance(
        IUniverseManager.DeploymentConfig memory deploymentConfig,
        uint256 universeId
    ) external returns (
        address tokenAddress,
        address governor,
        address bondingCurve
    );
}

/// @title UniverseManager
/// @notice Factory that creates universes and represents each as a transferable ERC-721 NFT.
///         The NFT shows up in wallets (OpenSea, Rainbow, etc.) and proves universe ownership.
///         Before governance token deployment, transferring the NFT transfers admin control.
///         After governance, the NFT represents creator identity; admin is the governor.
contract UniverseManager is IUniverseManager, ERC721, ReentrancyGuard, Ownable, Pausable {
    address public teamFeeRecipient;
    address public tokenDeployer;
    uint256 public constant TOKEN_SUPPLY = 1_000_000_000e18; // 1B with 18 decimals
    uint256 public constant BPS = 10_000;

    /// @notice Fee required to mint a universe (default 0.05 ETH).
    uint256 public mintFee;

    /// @notice WETH address used to seed liquidity pools with mint fee ETH.
    address public weth;

    /// @notice Identity NFT contract for co-creator / multi-sig signer INFTs.
    address public identityNft;

    /// @notice Factory contract that deploys Universe instances (bytecode extracted for EIP-170).
    address public universeFactory;

    /// @notice External renderer for on-chain tokenURI (Strings+Base64 extracted for EIP-170).
    address public metadataRenderer;

    /// @notice Once locked, metadataRenderer cannot be changed (protects existing tokenURIs).
    bool public metadataRendererLocked;

    /// @notice Per-universe LP seed balance (wei) held until token deployment seeds the pool.
    mapping(uint256 => uint256) public universeLpSeed;

    /// @notice Total ETH held across all universe LP seeds (must not be drained by claimEth).
    uint256 public totalLpSeedsHeld;

    mapping(uint id => UniverseData) universeDatas;
    mapping(address hook => bool enabled) public enabledHooks;
    mapping(address locker => mapping(address hook => bool enabled)) public enabledLockers;
    /// @notice Whitelist of tokens that can be claimed via claimTeamFee.
    mapping(address => bool) public claimableTokens;
    /// @notice Stored deployment config per universe for graduation (pool + locker config).
    mapping(uint256 => DeploymentConfig) public graduationConfigs;
    uint latestId;
    bool public deprecated;

    event SetTokenDeployer(address oldTokenDeployer, address newTokenDeployer);
    event MintFeeUpdated(uint256 oldFee, uint256 newFee);
    event WethUpdated(address oldWeth, address newWeth);
    event EthClaimed(address indexed recipient, uint256 amount);
    event AdminSyncFailed(uint256 indexed tokenId, address to);
    event MetadataRendererLocked(address renderer);
    /// @notice Emitted when multi-sig owner count exceeds 200 and signer minting is truncated (UNIVERSE-06).
    event SignersTruncated(uint256 indexed universeId, uint256 actualCount, uint16 mintedCount);

    constructor(address _teamFeeRecipient, address _weth) ERC721("LOAR Universe", "UNIVERSE") Ownable(msg.sender) {
        teamFeeRecipient = _teamFeeRecipient;
        require(_weth != address(0), "Zero WETH address");
        weth = _weth;
        mintFee = 0.05 ether;
    }

    function setMintFee(uint256 _mintFee) external onlyOwner {
        emit MintFeeUpdated(mintFee, _mintFee);
        mintFee = _mintFee;
    }

    function setWeth(address _weth) external onlyOwner {
        require(_weth != address(0), "Zero address");
        require(latestId == 0, "Cannot change WETH after universe creation");
        address old = weth;
        weth = _weth;
        emit WethUpdated(old, _weth);
    }

    function setTokenDeployer(address _tokenDeployer) external onlyOwner {
        address oldTokenDeployer = tokenDeployer;
        tokenDeployer = _tokenDeployer;
        emit SetTokenDeployer(oldTokenDeployer, _tokenDeployer);
    }

    function setIdentityNft(address _identityNft) external onlyOwner {
        address old = identityNft;
        identityNft = _identityNft;
        emit SetIdentityNft(old, _identityNft);
    }

    function setUniverseFactory(address _factory) external onlyOwner {
        require(_factory != address(0), "Zero address");
        universeFactory = _factory;
    }

    function setMetadataRenderer(address _renderer) external onlyOwner {
        require(!metadataRendererLocked, "Metadata renderer is locked");
        require(_renderer != address(0), "Zero address");
        metadataRenderer = _renderer;
    }

    /// @notice Permanently lock the metadata renderer — one-way, cannot be undone.
    function lockMetadataRenderer() external onlyOwner {
        metadataRendererLocked = true;
        emit MetadataRendererLocked(metadataRenderer);
    }

    /// @notice Claim ETH held in the contract, excluding LP seeds reserved for universes.
    function claimEth(address recipient) external onlyOwner {
        require(recipient != address(0), "Zero address");
        uint256 balance = address(this).balance;
        require(balance > totalLpSeedsHeld, "No ETH to claim");
        uint256 claimable = balance - totalLpSeedsHeld;
        (bool sent,) = recipient.call{value: claimable}("");
        require(sent, "ETH claim failed");
        emit EthClaimed(recipient, claimable);
    }

    /// @notice Emergency pause (H3 fix)
    function pause() external onlyOwner { _pause(); }

    /// @notice Unpause (H3 fix)
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable {}

    // ── Public entry points (thin wrappers) ─────────────────────────

    /// @notice Create a universe without a token (fun mode). Token can be deployed later.
    function createUniverse(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner
    ) public payable nonReentrant whenNotPaused returns (uint256 _id, address) {
        return _createUniverse(name, imageURL, description, nodeCreationOptions, nodeVisibilityOptions, initialOwner);
    }

    /// @notice Deploy a governance token for an existing universe (created without one).
    function deployUniverseToken(
        DeploymentConfig memory deploymentConfig,
        uint id
    ) public nonReentrant whenNotPaused returns (address tokenAddress) {
        return _deployUniverseToken(deploymentConfig, id);
    }

    /// @notice Atomic universe + token creation in a single transaction.
    ///         Creates the universe AND deploys its governance token + LP pool.
    ///         One wallet signature, one tx, no fragile intermediate state.
    function createUniverseWithToken(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner,
        DeploymentConfig memory deploymentConfig
    ) external payable nonReentrant whenNotPaused returns (
        uint256 universeId,
        address universeAddress,
        address tokenAddress
    ) {
        (universeId, universeAddress) = _createUniverse(
            name, imageURL, description,
            nodeCreationOptions, nodeVisibilityOptions,
            initialOwner
        );

        tokenAddress = _deployUniverseToken(deploymentConfig, universeId);

        emit UniverseCreatedWithToken(universeId, universeAddress, tokenAddress, address(universeDatas[universeId].universeGovernor));
    }

    // ── Internal implementations ────────────────────────────────────

    function _createUniverse(
        string memory name,
        string memory imageURL,
        string memory description,
        NodeCreationOptions nodeCreationOptions,
        NodeVisibilityOptions nodeVisibilityOptions,
        address initialOwner
    ) internal returns (uint256 _id, address) {
        require(!deprecated, "Manager is deprecated");
        if (msg.value < mintFee) revert InsufficientMintFee();

        // Cache overpayment for refund AFTER state updates (CEI pattern)
        uint256 overpayment = msg.value > mintFee ? msg.value - mintFee : 0;

        UniverseConfig memory config = UniverseConfig({
            nodeCreationOption: nodeCreationOptions,
            nodeVisibilityOption: nodeVisibilityOptions,
            universeAdmin: initialOwner,
            name: name,
            imageURL: imageURL,
            description: description,
            universeManager: address(this)
        });
        require(universeFactory != address(0), "Universe factory not set");
        address universeAddr = IUniverseFactory(universeFactory).createUniverse(config);
        IUniverse universe = IUniverse(universeAddr);
        UniverseData memory data = UniverseData({
            universe: universe,
            token: IERC20(address(0)),
            universeGovernor: IGovernor(address(0)),
            hook: IHooks(address(0)),
            locker: ILoarLpLocker(address(0)),
            bondingCurve: address(0)
        });

        uint256 currentId = latestId;
        universeDatas[currentId] = data;

        // 100% of mint fee is held as LP seed — wrapped to WETH and deposited
        // into the universe token's liquidity pool when token is deployed.
        universeLpSeed[currentId] = mintFee;
        totalLpSeedsHeld += mintFee;

        latestId++;

        // Mint identity NFT to the universe creator — shows in wallet, transferable
        _safeMint(initialOwner, currentId);

        // Mint Identity NFTs (INFT) to co-creators / multi-sig signers
        _mintIdentityNfts(initialOwner, currentId, address(universe), name, imageURL);

        emit UniverseCreated(address(universe), msg.sender);
        emit UniverseLpSeed(currentId, msg.sender, mintFee);

        // Refund overpayment AFTER all state updates (CEI pattern)
        if (overpayment > 0) {
            (bool refunded,) = msg.sender.call{value: overpayment}("");
            require(refunded, "Refund failed");
        }

        return (currentId, address(universe));
    }

    function _deployUniverseToken(
        DeploymentConfig memory deploymentConfig,
        uint id
    ) internal returns (address tokenAddress) {
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

        // Paired token must be WETH for LP seeding at graduation
        require(deploymentConfig.poolConfig.pairedToken == weth, "Paired token must be WETH");

        (address _tokenAddress, address governor, address bondingCurve) =
            IUniverseTokenDeployer(tokenDeployer).deployTokenAndGovernance(
                deploymentConfig,
                id
            );

        require(_tokenAddress != address(0), "Token deployment returned zero address");
        require(governor != address(0), "Governor deployment returned zero address");
        require(bondingCurve != address(0), "BondingCurve deployment returned zero address");

        tokenAddress = _tokenAddress;

        // Store deployment config for graduation (pool + locker config needed later)
        graduationConfigs[id] = deploymentConfig;

        // Forward LP seed ETH to bonding curve as initial reserve
        uint256 lpSeed = universeLpSeed[id];
        universeLpSeed[id] = 0;
        totalLpSeedsHeld -= lpSeed;

        if (lpSeed > 0) {
            (bool sent,) = bondingCurve.call{value: lpSeed}("");
            require(sent, "LP seed transfer to bonding curve failed");
        }

        // Store universe data — pool init happens at graduation
        universeDatas[id].token = IERC20(tokenAddress);
        universeDatas[id].universeGovernor = IGovernor(governor);
        universeDatas[id].bondingCurve = bondingCurve;

        universe.setAdmin(governor);
        universe.setToken(tokenAddress);

        emit BondingCurveCreated(
            id,
            tokenAddress,
            bondingCurve,
            4 ether,
            (TOKEN_SUPPLY * 8000) / 10000
        );

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
            PoolId.wrap(bytes32(0)),
            deploymentConfig.poolConfig.pairedToken,
            deploymentConfig.lockerConfig.locker,
            governor
        );
    }

    /// @notice Called by a universe's BondingCurve contract when it graduates.
    ///         Initializes Uniswap v4 pool and permanently locks LP with raised ETH + unsold tokens.
    function graduateFromBondingCurve(
        uint256 universeId,
        uint256 ethAmount,
        uint256 tokenAmount,
        address _token
    ) external payable nonReentrant whenNotPaused {
        UniverseData storage data = universeDatas[universeId];
        require(msg.sender == data.bondingCurve, "Only bonding curve can graduate");
        require(address(data.token) == _token, "Token mismatch");
        require(msg.value == ethAmount, "ETH amount mismatch");

        // Pull unsold tokens from bonding curve (already approved)
        if (tokenAmount > 0) {
            IERC20(_token).transferFrom(msg.sender, address(this), tokenAmount);
        }

        DeploymentConfig memory config = graduationConfigs[universeId];
        require(config.poolConfig.hook != address(0), "No graduation config");

        // Wrap ETH → WETH
        if (msg.value > 0) {
            IWETH(weth).deposit{value: msg.value}();
            IERC20(weth).approve(address(config.lockerConfig.locker), msg.value);
        }

        // Initialize Uniswap v4 pool
        PoolKey memory poolkey = ILoarHook(config.poolConfig.hook).initializePool(
            _token,
            config.poolConfig.pairedToken,
            config.poolConfig.tickIfToken0IsLoar,
            config.poolConfig.tickSpacing,
            config.lockerConfig.locker,
            config.poolConfig.poolData
        );

        // Lock LP permanently
        if (tokenAmount > 0) {
            IERC20(_token).approve(address(config.lockerConfig.locker), tokenAmount);
        }
        ILoarLpLocker(config.lockerConfig.locker).placeLiquidity(
            config.lockerConfig,
            config.poolConfig,
            poolkey,
            tokenAmount,
            _token,
            msg.value
        );

        // Update universe data — graduated
        data.hook = poolkey.hooks;
        data.locker = ILoarLpLocker(config.lockerConfig.locker);
        data.bondingCurve = address(0);

        emit TokenGraduated(universeId, _token, ethAmount, tokenAmount);
    }

    // ── Identity NFT minting ────────────────────────────────────────

    /// @dev Attempts to detect if `owner` is a Gnosis Safe. If so, mints an INFT
    ///      to each signer. If EOA, mints a single "1/1" INFT to the creator.
    ///      Uses try/catch so failures never block universe creation.
    function _mintIdentityNfts(
        address owner,
        uint256 universeId,
        address universeContract,
        string memory universeName,
        string memory universeImage
    ) internal {
        if (identityNft == address(0)) return; // INFT not configured yet

        IdentityNFT inft = IdentityNFT(identityNft);

        // Try to detect Gnosis Safe by calling getOwners().
        // IMPORTANT: check extcodesize first — Solidity's try/catch does NOT
        // catch ABI-decode failures when a call to a codeless address (EOA)
        // succeeds with empty returndata. The decoder panics in the caller
        // context which bypasses the catch block entirely.
        if (owner.code.length > 0) {
            try IGnosisSafe(owner).getOwners() returns (address[] memory owners) {
                if (owners.length > 0) {
                    // Multi-sig detected — mint to each signer
                    uint16 total = owners.length > 200 ? 200 : uint16(owners.length);
                    if (owners.length > 200) {
                        emit SignersTruncated(universeId, owners.length, total);
                    }
                    for (uint16 i = 0; i < total; i++) {
                        try inft.mint(
                            owners[i],
                            universeId,
                            uint8(i + 1),        // 1-based index
                            uint8(total),
                            owner,        // safe address
                            universeContract,
                            universeName,
                            universeImage
                        ) {} catch {
                            // Mint failed for this signer (maybe duplicate), continue
                        }
                    }
                    return;
                }
            } catch {
                // Not a Safe / call reverted — treat as EOA
            }
        }

        // EOA creator — mint a single "1/1" INFT
        try inft.mint(
            owner,
            universeId,
            1,            // signer 1
            1,            // of 1
            address(0),   // no safe
            universeContract,
            universeName,
            universeImage
        ) {} catch {
            // Non-blocking — INFT mint failure shouldn't break universe creation
        }
    }

    // ── Admin functions ─────────────────────────────────────────────

    function setTeamFeeRecipient(address _teamFeeRecipient) public onlyOwner {
        address oldTeamFeeRecipient = teamFeeRecipient;
        teamFeeRecipient = _teamFeeRecipient;
        emit SetTeamFeeRecipient(oldTeamFeeRecipient, teamFeeRecipient);
    }

    function setClaimableToken(address token, bool allowed) external onlyOwner {
        claimableTokens[token] = allowed;
    }

    function claimTeamFee(address token) external onlyOwner {
        if (teamFeeRecipient == address(0)) revert TeamFeeRecipientNotSet();
        require(claimableTokens[token], "Token not claimable");

        uint256 balance = IERC20(token).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(token), teamFeeRecipient, balance);
        emit ClaimTeamFees(token, teamFeeRecipient, balance);
    }

    /// @notice Emergency halt or resume trading on a universe's bonding curve.
    ///         Only callable by contract owner (should be a timelocked multisig).
    function setBondingCurveHalted(uint256 universeId, bool halted) external onlyOwner {
        address curve = universeDatas[universeId].bondingCurve;
        require(curve != address(0), "No active bonding curve");
        IBondingCurve(curve).setTradingHalted(halted);
    }

    function setDeprecated(bool deprecated_) external onlyOwner {
        deprecated = deprecated_;
        emit SetDeprecated(deprecated_);
    }

    function setHook(address hook, bool enabled) external onlyOwner {
        if (!ILoarHook(hook).supportsInterface(type(ILoarHook).interfaceId)) {
            revert InvalidHook();
        }
        enabledHooks[hook] = enabled;
        emit SetHook(hook, enabled);
    }

    function setLocker(address locker, address hook, bool enabled) external onlyOwner {
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
        ILoarLpLocker locker,
        address bondingCurve
    ) {
        UniverseData memory data = universeDatas[id];
        return (data.universe, data.token, data.universeGovernor, data.hook, data.locker, data.bondingCurve);
    }

    /// @notice Total universes created (also the next token ID)
    function totalSupply() external view returns (uint256) {
        return latestId;
    }

    // ── ERC-721 Identity NFT ───────────────────────────────────────

    /// @dev On transfer, sync the universe admin if governance hasn't been deployed yet.
    ///      Blocks transfer to address(0) (burn) when no governor, as that would
    ///      permanently brick universe admin with no recovery path.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);

        UniverseData storage data = universeDatas[tokenId];
        if (address(data.universe) != address(0) && address(data.universeGovernor) == address(0)) {
            require(to != address(0), "Cannot burn NFT without governor");
            try data.universe.setAdmin(to) {} catch {
                emit AdminSyncFailed(tokenId, to);
            }
        }

        return from;
    }

    /// @notice Fully on-chain tokenURI — delegates to external renderer (EIP-170 extraction).
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        require(metadataRenderer != address(0), "Metadata renderer not set");
        UniverseData storage data = universeDatas[tokenId];
        return IUniverseMetadataRenderer(metadataRenderer).tokenURI(
            tokenId, address(data.universe), address(data.token)
        );
    }
}
