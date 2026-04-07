// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {EpisodeEditionCollection} from "./revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "./revenue/CharacterNFT.sol";
import {EntityNFT} from "./revenue/EntityNFT.sol";
import {EntityEditionNFT} from "./revenue/EntityEditionNFT.sol";

/// @title RevenueModuleFactory
/// @notice Deploys per-universe revenue modules. Called after universe creation
///         to wire up the full monetization layer for a universe.
///
///         Modules deployed per universe:
///           EpisodeEditionCollection — ERC-1155 episode editions
///           CharacterNFT             — ERC-721 character (person) NFTs
///           EntityNFT                — ERC-721 for place, event, vehicle
///           EntityEditionNFT         — ERC-1155 for thing, lore, species, technology
///
///         Global singletons (shared across universes, deployed separately):
///           CollectiveTokenFactory   — ERC-20 for factions and organizations
///           StructuralDeed           — ERC-721 world-layer deeds
///           SlopMarket               — P2P marketplace for all entity token types
contract RevenueModuleFactory is Ownable {
    address public platform;
    address public rightsRegistry;
    address public paymentRouter;

    uint16 public episodePlatformFeeBps;
    uint16 public episodeRoyaltyBps;
    uint16 public characterAppearanceFeeBps;
    uint16 public entityPlatformFeeBps;
    uint16 public entityRoyaltyBps;

    /// @notice universeId => deployed EpisodeEditionCollection
    mapping(uint256 => address) public episodeCollection;
    /// @notice universeId => deployed CharacterNFT
    mapping(uint256 => address) public characterCollection;
    /// @notice universeId => deployed EntityNFT (place, event, vehicle)
    mapping(uint256 => address) public entityCollection;
    /// @notice universeId => deployed EntityEditionNFT (thing, lore, species, technology)
    mapping(uint256 => address) public entityEditionCollection;

    event ModulesDeployed(
        uint256 indexed universeId,
        address episodeCollection,
        address characterCollection,
        address entityCollection,
        address entityEditionCollection
    );
    event PlatformUpdated(address newPlatform);

    error AlreadyDeployed();
    error ZeroAddress();

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
    }

    /// @notice Deploy all revenue modules for a universe.
    ///         Can only be called once per universeId.
    function deployModules(uint256 universeId)
        external
        returns (
            address episodes,
            address characters,
            address entities,
            address entityEditions
        )
    {
        if (episodeCollection[universeId] != address(0)) revert AlreadyDeployed();

        EpisodeEditionCollection episodeContract = new EpisodeEditionCollection(
            universeId,
            platform,
            rightsRegistry,
            paymentRouter,
            episodePlatformFeeBps,
            episodeRoyaltyBps
        );

        CharacterNFT characterContract = new CharacterNFT(
            platform,
            characterAppearanceFeeBps
        );

        EntityNFT entityContract = new EntityNFT(
            platform,
            paymentRouter,
            entityPlatformFeeBps,
            entityRoyaltyBps
        );

        EntityEditionNFT entityEditionContract = new EntityEditionNFT(
            platform,
            paymentRouter,
            entityPlatformFeeBps,
            entityRoyaltyBps
        );

        episodeCollection[universeId]       = address(episodeContract);
        characterCollection[universeId]     = address(characterContract);
        entityCollection[universeId]        = address(entityContract);
        entityEditionCollection[universeId] = address(entityEditionContract);

        emit ModulesDeployed(
            universeId,
            address(episodeContract),
            address(characterContract),
            address(entityContract),
            address(entityEditionContract)
        );

        return (
            address(episodeContract),
            address(characterContract),
            address(entityContract),
            address(entityEditionContract)
        );
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setPlatform(address newPlatform) external onlyOwner {
        if (newPlatform == address(0)) revert ZeroAddress();
        platform = newPlatform;
        emit PlatformUpdated(newPlatform);
    }

    function setRightsRegistry(address newRegistry) external onlyOwner {
        if (newRegistry == address(0)) revert ZeroAddress();
        rightsRegistry = newRegistry;
    }

    function setPaymentRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        paymentRouter = newRouter;
    }

    function setEpisodeFees(uint16 platformFeeBps, uint16 royaltyBps_) external onlyOwner {
        episodePlatformFeeBps = platformFeeBps;
        episodeRoyaltyBps = royaltyBps_;
    }

    function setCharacterAppearanceFee(uint16 feeBps) external onlyOwner {
        characterAppearanceFeeBps = feeBps;
    }

    function setEntityFees(uint16 platformFeeBps, uint16 royaltyBps_) external onlyOwner {
        entityPlatformFeeBps = platformFeeBps;
        entityRoyaltyBps = royaltyBps_;
    }
}
