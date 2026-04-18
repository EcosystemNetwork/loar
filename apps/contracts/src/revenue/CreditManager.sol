// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title CreditManager
/// @notice Manages AI generation credits with dual-margin pricing:
///         - Credit card / ETH / other crypto: 35% margin
///         - $LOAR token payments: 25% margin (incentivizes token use)
///
///         Credits are the internal unit for all generation actions.
///         1 credit = 1 unit of generation capacity (costs vary by action type).
contract CreditManager is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

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

    // Rate limiting for grantCredits (CREDIT-01)
    // NOTE: Defaults set in initialize(), not here — inline initializers don't execute in proxy context
    uint256 public dailyGrantLimit;
    uint256 public grantedToday;
    uint256 public currentGrantDay;
    uint256 public maxGrantPerUser;

    /// @notice CREDIT-06: Cumulative grants per user. Prevents the balance-based
    ///         cap from being reset by spending — previously a user could spend
    ///         credits to drop balance, then receive unlimited follow-on grants.
    mapping(address => uint256) public grantedPerUser;

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
    event PlatformUpdated(address indexed oldPlatform, address indexed newPlatform);

    // ── Errors ───────────────────────────────────────────────────

    error InsufficientCredits();
    error InsufficientPayment();
    error InsufficientLoarBalance();
    error InsufficientLoarAllowance();
    error PackageNotActive();
    error NotPlatform();
    error TransferFailed();
    error ZeroAddress();
    error DailyGrantLimitExceeded();
    error MaxGrantPerUserExceeded();

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
        __Pausable_init();
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

        // CREDIT-01: Set rate limits in initialize (inline initializers don't run in proxy)
        dailyGrantLimit = 100_000;
        maxGrantPerUser = 10_000;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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
    function purchaseWithEth(uint256 packageId, address discountToken) external payable nonReentrant whenNotPaused {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();
        if (msg.value < pkg.priceWei) revert InsufficientPayment();

        uint256 bonusFromDiscount = 0;
        if (discountToken != address(0) && holderDiscountBps[discountToken] > 0) {
            // Wrap in try/catch to prevent DoS via malicious token contracts
            // that revert or consume excessive gas in balanceOf()
            try IERC20(discountToken).balanceOf(msg.sender) returns (uint256 bal) {
                if (bal >= 1e18) {
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

        // Route exact price to treasury; refund overpayment
        paymentRouter.routeToTreasury{value: pkg.priceWei}();
        uint256 refund = msg.value - pkg.priceWei;
        if (refund > 0) {
            (bool sent,) = msg.sender.call{value: refund}("");
            if (!sent) revert TransferFailed();
        }

        emit CreditsPurchasedWithEth(msg.sender, packageId, pkg.credits, pkg.bonusCredits + bonusFromDiscount, pkg.priceWei);
    }

    /// @notice Buy credits with ETH (no holder discount).
    function purchaseWithEth(uint256 packageId) external payable nonReentrant whenNotPaused {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();
        if (msg.value < pkg.priceWei) revert InsufficientPayment();

        uint256 totalCredits = pkg.credits + pkg.bonusCredits;
        userCredits[msg.sender].balance += totalCredits;
        userCredits[msg.sender].totalPurchased += pkg.credits;
        userCredits[msg.sender].totalBonusReceived += pkg.bonusCredits;

        // Route exact price to treasury; refund overpayment
        paymentRouter.routeToTreasury{value: pkg.priceWei}();
        uint256 refund = msg.value - pkg.priceWei;
        if (refund > 0) {
            (bool sent,) = msg.sender.call{value: refund}("");
            if (!sent) revert TransferFailed();
        }

        emit CreditsPurchasedWithEth(msg.sender, packageId, pkg.credits, pkg.bonusCredits, pkg.priceWei);
    }

    // ── Purchase with $LOAR (25% margin) ─────────────────────────

    /// @notice Buy credits with $LOAR tokens. 25% platform margin.
    ///         User must approve this contract to spend their $LOAR first.
    function purchaseWithLoar(uint256 packageId) external nonReentrant whenNotPaused {
        CreditPackage storage pkg = packages[packageId];
        if (!pkg.active) revert PackageNotActive();

        uint256 loarAmount = pkg.priceLoar;

        // Check balance and allowance
        if (loarToken.balanceOf(msg.sender) < loarAmount) revert InsufficientLoarBalance();
        if (loarToken.allowance(msg.sender, address(this)) < loarAmount) revert InsufficientLoarAllowance();

        // CREDIT-05: Require PaymentRouter — no fallback path that bypasses accounting
        require(address(paymentRouter) != address(0), "PaymentRouter not set");
        loarToken.safeTransferFrom(msg.sender, address(this), loarAmount);
        loarToken.forceApprove(address(paymentRouter), loarAmount);
        paymentRouter.routeLoarToTreasury(loarAmount);

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
    ) external onlyPlatform whenNotPaused {
        if (userCredits[user].balance < amount) revert InsufficientCredits();

        userCredits[user].balance -= amount;
        userCredits[user].totalSpent += amount;

        emit CreditsSpent(user, amount, generationType, universeId);
    }

    // ── Grant Credits (quests, affiliates, promotions) ───────────

    /// @notice Grant free credits (rate-limited)
    function grantCredits(
        address user,
        uint256 amount,
        string calldata reason
    ) external onlyPlatform whenNotPaused {
        // Daily rate limit reset
        uint256 today = block.timestamp / 1 days;
        if (today != currentGrantDay) {
            currentGrantDay = today;
            grantedToday = 0;
        }
        if (grantedToday + amount > dailyGrantLimit) revert DailyGrantLimitExceeded();
        grantedToday += amount;

        // CREDIT-06: Per-user cap on cumulative grants (not live balance) —
        // spending credits must not reset the cap.
        if (grantedPerUser[user] + amount > maxGrantPerUser) revert MaxGrantPerUserExceeded();
        grantedPerUser[user] += amount;

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
        require(discountBps <= 5000, "Max 50% discount");
        holderDiscountBps[token] = discountBps;
    }

    function setPlatform(address newPlatform) external onlyOwner {
        if (newPlatform == address(0)) revert ZeroAddress();
        address oldPlatform = platform;
        platform = newPlatform;
        emit PlatformUpdated(oldPlatform, newPlatform);
    }

    function setDailyGrantLimit(uint256 _limit) external onlyOwner {
        dailyGrantLimit = _limit;
    }

    function setMaxGrantPerUser(uint256 _limit) external onlyOwner {
        maxGrantPerUser = _limit;
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

    /// @dev Reserved storage gap for future upgrades — reduced by 1 slot for `grantedPerUser`
    uint256[48] private __gap;
}
