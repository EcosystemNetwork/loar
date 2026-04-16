// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title LicensingRegistry
/// @notice Manages IP licensing for original universes. When a universe gains traction,
///         creators can register licensing deals with external platforms (Netflix, Amazon, etc).
///         Also handles merch licensing for original IP (shirts, posters, figurines, comics).
contract LicensingRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
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

    // universeId => creator/admin
    mapping(uint256 => address) public universeCreators;

    address public platform;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;

    event LicenseCreated(uint256 indexed licenseId, uint256 universeId, LicenseType licenseType, address licensee, uint256 upfrontFee);
    event LicenseActivated(uint256 indexed licenseId);
    event RoyaltyPaid(uint256 indexed licenseId, uint256 amount);
    event LicenseRevoked(uint256 indexed licenseId);
    event MerchCreated(uint256 indexed merchId, uint256 universeId, string name, uint256 price);
    event MerchSold(uint256 indexed merchId, address buyer, uint256 price);

    error NotPlatform();
    error NotLicensor();
    error NotLicensee();
    error NotUniverseCreator();
    error InvalidStatus();
    error TransferFailed();
    error NoRevenue();
    error MerchNotActive();
    error InsufficientPayment();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        _checkPlatform();
        _;
    }

    function _checkPlatform() internal view {
        if (msg.sender != platform) revert NotPlatform();
    }

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform, address _paymentRouter, uint16 _platformFeeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_platform == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ---- Universe Registration ----

    event UniverseRegistered(uint256 indexed universeId, address creator);

    /// @notice Register a universe creator (platform only)
    function registerUniverse(uint256 universeId, address creator) external onlyPlatform {
        if (creator == address(0)) revert ZeroAddress();
        universeCreators[universeId] = creator;
        emit UniverseRegistered(universeId, creator);
    }

    // ---- Licensing ----

    /// @notice Create a licensing deal (universe creator or platform only)
    function createLicense(
        uint256 universeId,
        LicenseType licenseType,
        address licensee,
        uint256 upfrontFee,
        uint16 royaltyBps,
        uint256 duration,
        string calldata terms
    ) external whenNotPaused returns (uint256 licenseId) {
        if (msg.sender != universeCreators[universeId] && msg.sender != platform) revert NotUniverseCreator();
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
            endTime: duration, // stores duration while PROPOSED; becomes actual endTime on activation
            terms: terms
        });
        universeLicenses[universeId].push(licenseId);

        emit LicenseCreated(licenseId, universeId, licenseType, licensee, upfrontFee);
    }

    /// @notice Activate a license (licensee pays upfront fee)
    function activateLicense(uint256 licenseId) external payable nonReentrant whenNotPaused {
        License storage lic = licenses[licenseId];
        if (lic.status != LicenseStatus.PROPOSED) revert InvalidStatus();
        if (msg.sender != lic.licensee) revert NotLicensee();
        if (msg.value < lic.upfrontFee) revert InsufficientPayment();

        uint256 duration = lic.endTime;
        lic.startTime = block.timestamp;
        lic.endTime = block.timestamp + duration;
        lic.status = LicenseStatus.ACTIVE;

        // Route upfront fee through PaymentRouter
        if (msg.value > 0) {
            paymentRouter.route{value: msg.value}(lic.licensor, platformFeeBps);
        }

        emit LicenseActivated(licenseId);
    }

    error LicenseExpired();

    /// @notice Pay ongoing royalties for an active license (licensee or platform only)
    /// @dev Reverts if the license has expired — prevents paying royalties to stale deals
    function payRoyalty(uint256 licenseId) external payable nonReentrant whenNotPaused {
        License storage lic = licenses[licenseId];
        if (lic.status != LicenseStatus.ACTIVE) revert InvalidStatus();
        // Enforce expiry — cannot pay royalties to an expired license
        if (lic.endTime > 0 && block.timestamp > lic.endTime) {
            lic.status = LicenseStatus.EXPIRED;
            revert LicenseExpired();
        }
        // Only the licensee or platform can pay royalties to prevent accidental fund transfers
        if (msg.sender != lic.licensee && msg.sender != platform) revert NotLicensee();

        lic.totalRoyalties += msg.value;

        // Route royalty through PaymentRouter
        if (msg.value > 0) {
            paymentRouter.route{value: msg.value}(lic.licensor, platformFeeBps);
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

    /// @notice Create a merchandise item (universe creator or platform only)
    function createMerch(
        uint256 universeId,
        string calldata name,
        string calldata metadataURI,
        uint256 price
    ) external whenNotPaused returns (uint256 merchId) {
        if (msg.sender != universeCreators[universeId] && msg.sender != platform) revert NotUniverseCreator();
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
    function purchaseMerch(uint256 merchId) external payable nonReentrant whenNotPaused {
        MerchItem storage item = merchItems[merchId];
        if (!item.active) revert MerchNotActive();
        if (msg.value < item.price) revert InsufficientPayment();

        item.sold++;

        // Route merch payment through PaymentRouter
        if (msg.value > 0) {
            paymentRouter.route{value: msg.value}(item.creator, platformFeeBps);
        }

        emit MerchSold(merchId, msg.sender, msg.value);
    }

    // ---- Views ----

    function getUniverseLicenses(uint256 universeId) external view returns (uint256[] memory) {
        return universeLicenses[universeId];
    }

    /// @notice Paginated license query — avoids gas limit on large arrays
    function getUniverseLicensesPaginated(uint256 universeId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = universeLicenses[universeId];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    function getUniverseMerch(uint256 universeId) external view returns (uint256[] memory) {
        return universeMerch[universeId];
    }

    /// @notice Paginated merch query
    function getUniverseMerchPaginated(uint256 universeId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = universeMerch[universeId];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    /// @notice Count total licenses and merch for a universe
    function getUniverseCounts(uint256 universeId) external view returns (uint256 licenseCount, uint256 merchCount) {
        return (universeLicenses[universeId].length, universeMerch[universeId].length);
    }
}
