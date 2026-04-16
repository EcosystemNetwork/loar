// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IContentLicensing {
    enum DealType { BUY, RENT, LICENSE }
    enum DealStatus { ACTIVE, EXPIRED, REVOKED }

    struct ContentRegistration {
        bytes32 contentHash;
        address creator;
        uint256 universeId;
        bytes32 splitEntityHash;
        uint256 buyPrice;
        uint256 rentPricePerDay;
        uint256 licenseFee;
        uint16 licenseRoyaltyBps;
        bool active;
    }

    struct Deal {
        uint256 id;
        bytes32 contentHash;
        DealType dealType;
        DealStatus status;
        address buyer;
        uint256 pricePaid;
        uint256 startTime;
        uint256 endTime;
    }

    event ContentRegistered(bytes32 indexed contentHash, address creator, uint256 universeId, bytes32 splitEntityHash);
    event ContentBought(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 price);
    event ContentRented(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 price, uint256 endTime);
    event ContentLicensed(uint256 indexed dealId, bytes32 contentHash, address buyer, uint256 fee, uint256 endTime);
    event RoyaltyPaid(uint256 indexed dealId, uint256 amount);
    event ContentDeactivated(bytes32 indexed contentHash);
    event PricingUpdated(bytes32 indexed contentHash);

    function registerContent(
        bytes32 contentHash,
        uint256 universeId,
        bytes32 splitEntityHash,
        uint256 buyPrice,
        uint256 rentPricePerDay,
        uint256 licenseFee,
        uint16 licenseRoyaltyBps
    ) external;

    function buyContent(bytes32 contentHash) external payable returns (uint256 dealId);
    function rentContent(bytes32 contentHash, uint256 durationDays) external payable returns (uint256 dealId);
    function licenseContent(bytes32 contentHash, uint256 durationDays) external payable returns (uint256 dealId);
    function payRoyalty(uint256 dealId) external payable;
    function isDealActive(uint256 dealId) external view returns (bool);
    function getRegistration(bytes32 contentHash) external view returns (ContentRegistration memory);
    function getContentDeals(bytes32 contentHash) external view returns (uint256[] memory);
}
