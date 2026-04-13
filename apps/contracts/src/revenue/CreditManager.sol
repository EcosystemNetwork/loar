// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title CreditManager
/// @notice Manages AI generation credits with dual-margin pricing:
///         - Credit card / ETH / other crypto: 35% margin
///         - $LOAR token payments: 25% margin (incentivizes token use)
///
///         Credits are the internal unit for all generation actions.
///         1 credit = 1 unit of generation capacity (costs vary by action type).
contract CreditManager is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    // ── Structs ──────────────────────────────────────────────────

    struct CreditPackage {
        uint256 id;
        string name;
        uint256 credits;
        uint256 priceWei;         // ETH price (35% margin baked in)
        uint256 priceLoar;        // $LOAR price (25% margin baked in)
        uint256 bonusCredits;     // extra credits as purchase incentive
        bool active;
    }

    struct UserCredits {
        uint256 balance;
        uint256 totalPurchased;
        uint256 totalSpent;
        uint256 totalBonusReceived;
    }

    // ── State ────────────────────────────────────────────────────

    IERC20 public loarToken;
    address public platform;
    address public treasury;
    IPaymentRouter public paymentRouter;

    uint256 public nextPackageId;
    mapping(uint256 => CreditPackage) public packages;
    mapping(address => UserCredits) public userCredits;

    // Holder discount: universe token address => discount in basis points
    // Applied when holder of a universe token purchases credits
    mapping(address => uint16) public holderDiscountBps;

    // Generation costs per type (in credits)
    mapping(bytes32 => uint256) public generationCosts;

    // ── Margin constants (informational, actual margins baked into package prices) ──
    uint16 public constant FIAT_MARGIN_BPS = 3500;   // 35%
    uint16 public constant LOAR_MARGIN_BPS = 2500;    // 25%

    // ── Events ───────────────────────────────────────────────────

    event PackageCreated(uint256 indexed packageId, string name, uint256 credits, uint256 priceWei, uint256 priceLoar);
    event CreditsPurchasedWithEth(address indexed user, uint256 packageId, uint256 credits, uint256 bonus, uint256 paid);
    event CreditsPurchasedWithLoar(address indexed user, uint256 packageId, uint256 credits, uint256 bonus, uint256 loarPaid);
    event CreditsSpent(address indexed user, uint256 amount, string generationType, uint256 universeId);
    event CreditsGranted(address indexed user, uint256 amount, string reason);
    event GenerationCostUpdated(string genType, uint256 newCost);

    // ── Errors ───────────────────────────────────────────────────

    error InsufficientCredits();
    error InsufficientPayment();
    error InsufficientLoarBalance();
    error InsufficientLoarAllowance();
    error PackageNotActive();
    error NotPlatform();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyPlatform() {
        _checkPlatform();
        _;
    }

    function _checkPlatform() internal view {
        if (msg.sender != platform) revert NotPlatform();
    }

    // ── Constructor ──────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _loarToken, address _platform, address _treasury, address _paymentRouter) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        // loarToken can be address(0) initially — set later via updateLoarToken()
        if (_platform == address(0) || _treasury == address(0))
            revert ZeroAddress();

        loarToken = IERC20(_loarToken);
        platform = _platform;
        treasury = _treasury;
        paymentRouter = IPaymentRouter(_paymentRouter);

        // Default generation costs (in credits)
        generationCosts[keccak256("image")] = 3;
        generationCosts[keccak256("video_draft")] = 5;
        generationCosts[keccak256("video_standard")] = 13;
        generationCosts[keccak256("video_premium")] = 35;
        generationCosts[keccak256("story")] = 5;
        generationCosts[keccak256("spinoff")] = 20;
        generationCosts[keccak256("character")] = 8;
        generationCosts[keccak256("scene")] = 15;
        generationCosts[keccak256("voiceover")] = 10;
        generationCosts[keccak256("caption")] = 2;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Package Management ───────────────────────────────────────

    /// @notice Create a credit purchase package with both ETH and $LOAR pricing
    /// @param name Display name (e.g., "Starter Pack")
    /// @param credits Base credits included
    /// @param priceWei ETH price (includes 35% margin)
    /// @param priceLoar $LOAR price (includes 25% margin)
    /// @param bonusCredits Additional bonus credits (loyalty incentive)
    function createPackage(
        string calldata name,
        uint256 credits,
        uint256 priceWei,
        uint256 priceLoar,
        uint256 bonusCredits
    ) external onlyPlatform returns (uint256 packageId) {
        packageId = nextPackageId++;
        packages[packageId] = CreditPackage({
            id: packageId,
            name: name,
            credits: credits,
            priceWei: priceWei,
            priceLoar: priceLoar,
            bonusCredits: bonusCredits,
            active: true
        });
        emit PackageCreated(packageId, name, credits, priceWei, priceLoar);
    }

    // ── Purchase with ETH (35% margin) ───────────────────────────

    /// @notice Buy credits with ETH. 35% platform margin.
    ///         If a holderDiscount is configured for a token and buyer holds that token,
    ///         they receive bonus credits proportional to the discount.
    function purchaseWithEth(uint256 packageId, address discountToken) external payable nonReentrant {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();
        if (msg.value < pkg.priceWei) revert InsufficientPayment();

        uint256 bonusFromDiscount = 0;
        if (discountToken != address(0) && holderDiscountBps[discountToken] > 0) {
            // Wrap in try/catch to prevent DoS via malicious token contracts
            // that revert or consume excessive gas in balanceOf()
            try IERC20(discountToken).balanceOf(msg.sender) returns (uint256 bal) {
                if (bal > 0) {
                    bonusFromDiscount = (pkg.credits * holderDiscountBps[discountToken]) / 10000;
                }
            } catch {
                // Token call failed — skip discount, proceed without bonus
            }
        }

        uint256 totalCredits = pkg.credits + pkg.bonusCredits + bonusFromDiscount;
        userCredits[msg.sender].balance += totalCredits;
        userCredits[msg.sender].totalPurchased += pkg.credits;
        userCredits[msg.sender].totalBonusReceived += pkg.bonusCredits + bonusFromDiscount;

        // Route ETH to treasury via PaymentRouter
        paymentRouter.routeToTreasury{value: msg.value}();

        emit CreditsPurchasedWithEth(msg.sender, packageId, pkg.credits, pkg.bonusCredits + bonusFromDiscount, msg.value);
    }

    /// @notice Buy credits with ETH (no holder discount).
    function purchaseWithEth(uint256 packageId) external payable nonReentrant {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();
        if (msg.value < pkg.priceWei) revert InsufficientPayment();

        uint256 totalCredits = pkg.credits + pkg.bonusCredits;
        userCredits[msg.sender].balance += totalCredits;
        userCredits[msg.sender].totalPurchased += pkg.credits;
        userCredits[msg.sender].totalBonusReceived += pkg.bonusCredits;

        paymentRouter.routeToTreasury{value: msg.value}();

        emit CreditsPurchasedWithEth(msg.sender, packageId, pkg.credits, pkg.bonusCredits, msg.value);
    }

    // ── Purchase with $LOAR (25% margin) ─────────────────────────

    /// @notice Buy credits with $LOAR tokens. 25% platform margin.
    ///         User must approve this contract to spend their $LOAR first.
    function purchaseWithLoar(uint256 packageId) external nonReentrant {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();

        uint256 loarAmount = pkg.priceLoar;

        // Check balance and allowance
        if (loarToken.balanceOf(msg.sender) < loarAmount) revert InsufficientLoarBalance();
        if (loarToken.allowance(msg.sender, address(this)) < loarAmount) revert InsufficientLoarAllowance();

        // Route $LOAR through PaymentRouter for consistent revenue accounting
        if (address(paymentRouter) != address(0)) {
            loarToken.transferFrom(msg.sender, address(this), loarAmount);
            loarToken.approve(address(paymentRouter), loarAmount);
            paymentRouter.routeLoarToTreasury(loarAmount);
        } else {
            // Fallback: direct treasury transfer (pre-PaymentRouter)
            bool success = loarToken.transferFrom(msg.sender, treasury, loarAmount);
            if (!success) revert TransferFailed();
        }

        // $LOAR buyers get a bonus on top of the package bonus
        uint256 loarBonus = pkg.credits / 10; // Extra 10% credits for $LOAR payments
        uint256 totalCredits = pkg.credits + pkg.bonusCredits + loarBonus;

        userCredits[msg.sender].balance += totalCredits;
        userCredits[msg.sender].totalPurchased += pkg.credits;
        userCredits[msg.sender].totalBonusReceived += pkg.bonusCredits + loarBonus;

        emit CreditsPurchasedWithLoar(msg.sender, packageId, pkg.credits, pkg.bonusCredits + loarBonus, loarAmount);
    }

    // ── Spend Credits ────────────────────────────────────────────

    /// @notice Spend credits for AI generation (called by platform backend)
    function spendCredits(
        address user,
        uint256 amount,
        string calldata generationType,
        uint256 universeId
    ) external onlyPlatform {
        if (userCredits[user].balance < amount) revert InsufficientCredits();

        userCredits[user].balance -= amount;
        userCredits[user].totalSpent += amount;

        emit CreditsSpent(user, amount, generationType, universeId);
    }

    // ── Grant Credits (quests, affiliates, promotions) ───────────

    /// @notice Grant free credits
    function grantCredits(
        address user,
        uint256 amount,
        string calldata reason
    ) external onlyPlatform {
        userCredits[user].balance += amount;
        userCredits[user].totalPurchased += amount;

        emit CreditsGranted(user, amount, reason);
    }

    // ── Admin ────────────────────────────────────────────────────

    function setGenerationCost(string calldata genType, uint256 cost) external onlyPlatform {
        generationCosts[keccak256(abi.encodePacked(genType))] = cost;
        emit GenerationCostUpdated(genType, cost);
    }

    function setHolderDiscount(address token, uint16 discountBps) external onlyPlatform {
        holderDiscountBps[token] = discountBps;
    }

    function deactivatePackage(uint256 packageId) external onlyPlatform {
        packages[packageId].active = false;
    }

    function updateLoarToken(address newToken) external onlyPlatform {
        if (newToken == address(0)) revert ZeroAddress();
        loarToken = IERC20(newToken);
    }

    // ── View ─────────────────────────────────────────────────────

    function getBalance(address user) external view returns (uint256) {
        return userCredits[user].balance;
    }

    function getGenerationCost(string calldata genType) external view returns (uint256) {
        return generationCosts[keccak256(abi.encodePacked(genType))];
    }

    function getUserStats(address user) external view returns (
        uint256 balance,
        uint256 totalPurchased,
        uint256 totalSpent,
        uint256 totalBonusReceived
    ) {
        UserCredits storage uc = userCredits[user];
        return (uc.balance, uc.totalPurchased, uc.totalSpent, uc.totalBonusReceived);
    }
}
