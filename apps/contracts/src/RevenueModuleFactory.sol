// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/proxy/beacon/BeaconProxy.sol";
import {EpisodeEditionCollection} from "./revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "./revenue/CharacterNFT.sol";
import {EntityNFT} from "./revenue/EntityNFT.sol";
import {EntityEditionNFT} from "./revenue/EntityEditionNFT.sol";
import {EpisodeNFT} from "./revenue/EpisodeNFT.sol";

/// @title RevenueModuleFactory
/// @notice Deploys per-universe revenue modules as BeaconProxy instances.
///         Each NFT type has an UpgradeableBeacon — upgrade the beacon
///         and ALL universe instances upgrade instantly.
contract RevenueModuleFactory is Ownable {
    address public platform;
    address public rightsRegistry;
    address public paymentRouter;

    // ── Beacons (shared, upgradeable) ──
    UpgradeableBeacon public episodeBeacon;
    UpgradeableBeacon public characterBeacon;
    UpgradeableBeacon public entityBeacon;
    UpgradeableBeacon public entityEdBeacon;
    UpgradeableBeacon public episodeNftBeacon;

    // ── Fee defaults ──
    uint16 public episodePlatformFeeBps;
    uint16 public episodeRoyaltyBps;
    uint16 public characterAppearanceFeeBps;
    uint16 public entityPlatformFeeBps;
    uint16 public entityRoyaltyBps;

    // ── Per-universe proxies ──
    mapping(uint256 => address) public episodeCollection;
    mapping(uint256 => address) public characterCollection;
    mapping(uint256 => address) public entityCollection;
    mapping(uint256 => address) public entityEditionCollection;
    mapping(uint256 => address) public episodeNftCollection;

    event ModulesDeployed(
        uint256 indexed universeId,
        address episodeCollection,
        address characterCollection,
        address entityCollection,
        address entityEditionCollection,
        address episodeNftCollection
    );

    error AlreadyDeployed();
    error ZeroAddress();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    constructor(
        address _platform,
        address _rightsRegistry,
        address _paymentRouter,
        uint16 _episodePlatformFeeBps,
        uint16 _episodeRoyaltyBps,
        uint16 _characterAppearanceFeeBps,
        uint16 _entityPlatformFeeBps,
        uint16 _entityRoyaltyBps
    ) Ownable(msg.sender) {
        if (_platform == address(0) || _rightsRegistry == address(0) || _paymentRouter == address(0))
            revert ZeroAddress();
        platform = _platform;
        rightsRegistry = _rightsRegistry;
        paymentRouter = _paymentRouter;
        episodePlatformFeeBps = _episodePlatformFeeBps;
        episodeRoyaltyBps = _episodeRoyaltyBps;
        characterAppearanceFeeBps = _characterAppearanceFeeBps;
        entityPlatformFeeBps = _entityPlatformFeeBps;
        entityRoyaltyBps = _entityRoyaltyBps;

        // Deploy implementations + beacons (owner = deployer so they can upgrade)
        episodeBeacon = new UpgradeableBeacon(address(new EpisodeEditionCollection()), msg.sender);
        characterBeacon = new UpgradeableBeacon(address(new CharacterNFT()), msg.sender);
        entityBeacon = new UpgradeableBeacon(address(new EntityNFT()), msg.sender);
        entityEdBeacon = new UpgradeableBeacon(address(new EntityEditionNFT()), msg.sender);
        episodeNftBeacon = new UpgradeableBeacon(address(new EpisodeNFT()), msg.sender);
    }

    /// @notice Deploy all revenue modules for a universe as BeaconProxy instances.
    function deployModules(uint256 universeId)
        external
        returns (address episodes, address characters, address entities, address entityEditions, address episodeNfts)
    {
        if (episodeCollection[universeId] != address(0)) revert AlreadyDeployed();

        episodes = address(new BeaconProxy(address(episodeBeacon),
            abi.encodeCall(EpisodeEditionCollection.initialize, (
                universeId, platform, rightsRegistry, paymentRouter,
                episodePlatformFeeBps, episodeRoyaltyBps))));

        characters = address(new BeaconProxy(address(characterBeacon),
            abi.encodeCall(CharacterNFT.initialize, (
                universeId, platform, rightsRegistry, paymentRouter,
                characterAppearanceFeeBps))));

        entities = address(new BeaconProxy(address(entityBeacon),
            abi.encodeCall(EntityNFT.initialize, (
                universeId, platform, paymentRouter, rightsRegistry,
                entityPlatformFeeBps, entityRoyaltyBps))));

        entityEditions = address(new BeaconProxy(address(entityEdBeacon),
            abi.encodeCall(EntityEditionNFT.initialize, (
                universeId, platform, paymentRouter, rightsRegistry,
                entityPlatformFeeBps, entityRoyaltyBps))));

        episodeNfts = address(new BeaconProxy(address(episodeNftBeacon),
            abi.encodeCall(EpisodeNFT.initialize, (
                universeId, platform, rightsRegistry, paymentRouter,
                episodePlatformFeeBps))));

        episodeCollection[universeId] = episodes;
        characterCollection[universeId] = characters;
        entityCollection[universeId] = entities;
        entityEditionCollection[universeId] = entityEditions;
        episodeNftCollection[universeId] = episodeNfts;

        emit ModulesDeployed(universeId, episodes, characters, entities, entityEditions, episodeNfts);
    }

    // ── Admin ──

    function setPlatform(address p) external onlyOwner { if (p == address(0)) revert ZeroAddress(); platform = p; }
    function setRightsRegistry(address r) external onlyOwner { if (r == address(0)) revert ZeroAddress(); rightsRegistry = r; }
    function setPaymentRouter(address r) external onlyOwner { if (r == address(0)) revert ZeroAddress(); paymentRouter = r; }

    function setEpisodeFees(uint16 pfBps, uint16 rBps) external onlyOwner {
        if (pfBps > MAX_FEE_BPS || rBps > MAX_FEE_BPS) revert FeeTooHigh();
        episodePlatformFeeBps = pfBps; episodeRoyaltyBps = rBps;
    }

    function setCharacterAppearanceFee(uint16 feeBps) external onlyOwner {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        characterAppearanceFeeBps = feeBps;
    }

    function setEntityFees(uint16 pfBps, uint16 rBps) external onlyOwner {
        if (pfBps > MAX_FEE_BPS || rBps > MAX_FEE_BPS) revert FeeTooHigh();
        entityPlatformFeeBps = pfBps; entityRoyaltyBps = rBps;
    }
}
