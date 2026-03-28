// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {EpisodeEditionCollection} from "./revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "./revenue/CharacterNFT.sol";

/// @title RevenueModuleFactory
/// @notice Deploys per-universe revenue modules: EpisodeEditionCollection (ERC-1155)
///         and CharacterNFT (ERC-721). Called after universe creation to wire up
///         the monetization layer for a universe.
///
///         This is the missing link between "universe exists" and "universe can earn."
contract RevenueModuleFactory is Ownable {
    address public platform;
    address public rightsRegistry;
    address public paymentRouter;

    uint16 public episodePlatformFeeBps;
    uint16 public episodeRoyaltyBps;
    uint16 public characterAppearanceFeeBps;

    /// @notice universeId => deployed EpisodeEditionCollection
    mapping(uint256 => address) public episodeCollection;
    /// @notice universeId => deployed CharacterNFT
    mapping(uint256 => address) public characterCollection;

    event ModulesDeployed(
        uint256 indexed universeId,
        address episodeCollection,
        address characterCollection
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
        uint16 _characterAppearanceFeeBps
    ) Ownable(msg.sender) {
        if (_platform == address(0) || _rightsRegistry == address(0) || _paymentRouter == address(0))
            revert ZeroAddress();
        platform = _platform;
        rightsRegistry = _rightsRegistry;
        paymentRouter = _paymentRouter;
        episodePlatformFeeBps = _episodePlatformFeeBps;
        episodeRoyaltyBps = _episodeRoyaltyBps;
        characterAppearanceFeeBps = _characterAppearanceFeeBps;
    }

    /// @notice Deploy episode and character modules for a universe.
    ///         Can only be called once per universeId.
    function deployModules(uint256 universeId)
        external
        returns (address episodes, address characters)
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

        episodeCollection[universeId] = address(episodeContract);
        characterCollection[universeId] = address(characterContract);

        emit ModulesDeployed(universeId, address(episodeContract), address(characterContract));
        return (address(episodeContract), address(characterContract));
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
}
