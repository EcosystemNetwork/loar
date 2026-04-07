// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title LicensingRegistry
/// @notice Manages IP licensing for original universes. When a universe gains traction,
///         creators can register licensing deals with external platforms (Netflix, Amazon, etc).
///         Also handles merch licensing for original IP (shirts, posters, figurines, comics).
contract LicensingRegistry is ReentrancyGuard {
    enum LicenseType { STREAMING, MERCH, GAMING, COMIC, AUDIO, OTHER }
    enum LicenseStatus { PROPOSED, ACTIVE, EXPIRED, REVOKED }

    struct License {
        uint256 id;
        uint256 universeId;
        LicenseType licenseType;
        LicenseStatus status;
        address licensor;          // universe creator
        address licensee;          // external platform/partner
        uint256 upfrontFee;
        uint16 royaltyBps;         // ongoing royalty percentage
        uint256 totalRoyalties;
        uint256 startTime;
        uint256 endTime;
        string terms;              // IPFS URI for full license terms
    }

    struct MerchItem {
        uint256 id;
        uint256 universeId;
        string name;
        string metadataURI;
        uint256 price;
        uint256 sold;
        address creator;
        bool active;
    }

    uint256 public nextLicenseId;
    uint256 public nextMerchId;

    mapping(uint256 => License) public licenses;
    mapping(uint256 => MerchItem) public merchItems;

    // universeId => license IDs
    mapping(uint256 => uint256[]) public universeLicenses;
    // universeId => merch IDs
    mapping(uint256 => uint256[]) public universeMerch;

    address public platform;
    uint16 public platformFeeBps;

    // Universe creator => claimable revenue
    mapping(address => uint256) public claimableRevenue;

    event LicenseCreated(uint256 indexed licenseId, uint256 universeId, LicenseType licenseType, address licensee, uint256 upfrontFee);
    event LicenseActivated(uint256 indexed licenseId);
    event RoyaltyPaid(uint256 indexed licenseId, uint256 amount);
    event LicenseRevoked(uint256 indexed licenseId);
    event MerchCreated(uint256 indexed merchId, uint256 universeId, string name, uint256 price);
    event MerchSold(uint256 indexed merchId, address buyer, uint256 price);
    event RevenueClaimed(address indexed creator, uint256 amount);

    error NotPlatform();
    error NotLicensor();
    error InvalidStatus();
    error TransferFailed();
    error NoRevenue();
    error MerchNotActive();
    error InsufficientPayment();

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(address _platform, uint16 _platformFeeBps) {
        platform = _platform;
        platformFeeBps = _platformFeeBps;
    }

    // ---- Licensing ----

    /// @notice Create a licensing deal
    function createLicense(
        uint256 universeId,
        LicenseType licenseType,
        address licensee,
        uint256 upfrontFee,
        uint16 royaltyBps,
        uint256 duration,
        string calldata terms
    ) external payable returns (uint256 licenseId) {
        licenseId = nextLicenseId++;

        licenses[licenseId] = License({
            id: licenseId,
            universeId: universeId,
            licenseType: licenseType,
            status: LicenseStatus.PROPOSED,
            licensor: msg.sender,
            licensee: licensee,
            upfrontFee: upfrontFee,
            royaltyBps: royaltyBps,
            totalRoyalties: 0,
            startTime: 0,
            endTime: 0,
            terms: terms
        });

        // Store duration in endTime temporarily
        licenses[licenseId].endTime = duration;
        universeLicenses[universeId].push(licenseId);

        emit LicenseCreated(licenseId, universeId, licenseType, licensee, upfrontFee);
    }

    /// @notice Activate a license (licensee pays upfront fee)
    function activateLicense(uint256 licenseId) external payable nonReentrant {
        License storage lic = licenses[licenseId];
        if (lic.status != LicenseStatus.PROPOSED) revert InvalidStatus();
        require(msg.sender == lic.licensee, "Not licensee");
        require(msg.value >= lic.upfrontFee, "Insufficient upfront fee");

        uint256 duration = lic.endTime;
        lic.startTime = block.timestamp;
        lic.endTime = block.timestamp + duration;
        lic.status = LicenseStatus.ACTIVE;

        // Revenue split on upfront
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 licensorCut = msg.value - platformCut;
        claimableRevenue[lic.licensor] += licensorCut;

        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit LicenseActivated(licenseId);
    }

    /// @notice Pay ongoing royalties for an active license
    function payRoyalty(uint256 licenseId) external payable {
        License storage lic = licenses[licenseId];
        require(lic.status == LicenseStatus.ACTIVE, "Not active");

        lic.totalRoyalties += msg.value;

        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 licensorCut = msg.value - platformCut;
        claimableRevenue[lic.licensor] += licensorCut;

        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit RoyaltyPaid(licenseId, msg.value);
    }

    /// @notice Revoke a license
    function revokeLicense(uint256 licenseId) external {
        License storage lic = licenses[licenseId];
        if (msg.sender != lic.licensor && msg.sender != platform) revert NotLicensor();
        lic.status = LicenseStatus.REVOKED;
        emit LicenseRevoked(licenseId);
    }

    // ---- Merch ----

    /// @notice Create a merchandise item
    function createMerch(
        uint256 universeId,
        string calldata name,
        string calldata metadataURI,
        uint256 price
    ) external returns (uint256 merchId) {
        merchId = nextMerchId++;
        merchItems[merchId] = MerchItem({
            id: merchId,
            universeId: universeId,
            name: name,
            metadataURI: metadataURI,
            price: price,
            sold: 0,
            creator: msg.sender,
            active: true
        });
        universeMerch[universeId].push(merchId);
        emit MerchCreated(merchId, universeId, name, price);
    }

    /// @notice Purchase merchandise
    function purchaseMerch(uint256 merchId) external payable nonReentrant {
        MerchItem storage item = merchItems[merchId];
        if (!item.active) revert MerchNotActive();
        if (msg.value < item.price) revert InsufficientPayment();

        item.sold++;

        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 creatorCut = msg.value - platformCut;
        claimableRevenue[item.creator] += creatorCut;

        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit MerchSold(merchId, msg.sender, msg.value);
    }

    /// @notice Claim accumulated revenue
    function claimRevenue() external nonReentrant {
        uint256 amount = claimableRevenue[msg.sender];
        if (amount == 0) revert NoRevenue();

        claimableRevenue[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RevenueClaimed(msg.sender, amount);
    }

    // ---- Views ----

    function getUniverseLicenses(uint256 universeId) external view returns (uint256[] memory) {
        return universeLicenses[universeId];
    }

    function getUniverseMerch(uint256 universeId) external view returns (uint256[] memory) {
        return universeMerch[universeId];
    }
}
