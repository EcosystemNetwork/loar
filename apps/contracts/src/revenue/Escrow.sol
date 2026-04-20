// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title Escrow
/// @notice Holds funds in escrow for marketplace trades (NFTs, licenses, subscriptions).
///         Buyer deposits → Seller delivers → Buyer confirms OR dispute window expires → Funds release.
///         Disputes resolved by platform admin or DAO timelock.
///
/// Flow:
///   1. createEscrow()  — buyer deposits ETH/LOAR, escrow created
///   2. confirmDelivery() — buyer confirms, funds released to seller (minus platform fee)
///   3. If buyer doesn't confirm within dispute window → seller can claimExpired()
///   4. disputeEscrow() — buyer opens dispute within window → admin resolves
///   5. resolveDispute() — admin releases to buyer, seller, or splits
contract Escrow is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    enum EscrowStatus {
        ACTIVE,
        COMPLETED,
        DISPUTED,
        RESOLVED,
        EXPIRED_CLAIMED
    }

    struct EscrowData {
        uint256 id;
        address buyer;
        address seller;
        uint256 amount; // ETH held
        bytes32 contentHash; // content/NFT being traded
        string metadataURI; // IPFS URI for trade details
        EscrowStatus status;
        uint256 createdAt;
        uint256 disputeDeadline; // buyer must confirm or dispute before this
        uint256 platformFeeBps; // snapshot of fee at creation time
    }

    uint256 public nextEscrowId;

    mapping(uint256 => EscrowData) public escrows;

    /// @notice Pull-pattern claimable balances
    mapping(address => uint256) public claimable;

    IPaymentRouter public paymentRouter;
    address public platform;
    uint16 public defaultFeeBps;
    uint256 public disputeWindow; // seconds — default 7 days

    uint16 public constant MAX_FEE_BPS = 1000; // ESCROW-04: capped at 10% (was 50%)

    // ── Events ──────────────────────────────────────────────────────────
    event EscrowCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        bytes32 contentHash
    );
    event DeliveryConfirmed(uint256 indexed id, address indexed buyer);
    event EscrowDisputed(uint256 indexed id, address indexed buyer, string reason);
    event DisputeResolved(uint256 indexed id, uint256 buyerAmount, uint256 sellerAmount);
    event ExpiredClaimed(uint256 indexed id, address indexed seller);
    event Claimed(address indexed account, uint256 amount);
    event PlatformUpdated(address indexed oldPlatform, address indexed newPlatform);

    // ── Errors ──────────────────────────────────────────────────────────
    error ZeroAddress();
    error ZeroAmount();
    error FeeTooHigh();
    error NotBuyer();
    error NotSeller();
    error InvalidStatus();
    error DisputeWindowActive();
    error DisputeWindowExpired();
    error NothingToClaim();
    error TransferFailed();
    error AmountMismatch();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _platform,
        address _paymentRouter,
        uint16 _defaultFeeBps,
        uint256 _disputeWindow
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        if (_platform == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_defaultFeeBps > MAX_FEE_BPS) revert FeeTooHigh();

        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        defaultFeeBps = _defaultFeeBps;
        disputeWindow = _disputeWindow;
    }

    // ── Core Flow ───────────────────────────────────────────────────────

    /// @notice Create an escrow by depositing ETH. Seller must deliver within dispute window.
    function createEscrow(address seller, bytes32 contentHash, string calldata metadataURI)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 escrowId)
    {
        if (seller == address(0)) revert ZeroAddress();
        if (msg.value == 0) revert ZeroAmount();

        escrowId = nextEscrowId++;

        escrows[escrowId] = EscrowData({
            id: escrowId,
            buyer: msg.sender,
            seller: seller,
            amount: msg.value,
            contentHash: contentHash,
            metadataURI: metadataURI,
            status: EscrowStatus.ACTIVE,
            createdAt: block.timestamp,
            disputeDeadline: block.timestamp + disputeWindow,
            platformFeeBps: defaultFeeBps
        });

        emit EscrowCreated(escrowId, msg.sender, seller, msg.value, contentHash);
    }

    /// @notice Buyer confirms delivery — releases funds to seller (minus platform fee).
    function confirmDelivery(uint256 escrowId) external nonReentrant {
        EscrowData storage e = escrows[escrowId];
        if (msg.sender != e.buyer) revert NotBuyer();
        if (e.status != EscrowStatus.ACTIVE) revert InvalidStatus();

        e.status = EscrowStatus.COMPLETED;

        _distribute(e);

        emit DeliveryConfirmed(escrowId, msg.sender);
    }

    /// @notice Buyer opens a dispute before the deadline.
    function disputeEscrow(uint256 escrowId, string calldata reason) external {
        EscrowData storage e = escrows[escrowId];
        if (msg.sender != e.buyer) revert NotBuyer();
        if (e.status != EscrowStatus.ACTIVE) revert InvalidStatus();
        if (block.timestamp > e.disputeDeadline) revert DisputeWindowExpired();

        e.status = EscrowStatus.DISPUTED;

        emit EscrowDisputed(escrowId, msg.sender, reason);
    }

    /// @notice Admin/DAO resolves a dispute by splitting funds between buyer and seller.
    function resolveDispute(uint256 escrowId, uint256 buyerAmount, uint256 sellerAmount)
        external
        onlyOwner
        nonReentrant
    {
        EscrowData storage e = escrows[escrowId];
        if (e.status != EscrowStatus.DISPUTED) revert InvalidStatus();

        uint256 fee = (e.amount * e.platformFeeBps) / 10000;
        uint256 distributable = e.amount - fee;
        if (buyerAmount + sellerAmount != distributable) revert AmountMismatch();

        e.status = EscrowStatus.RESOLVED;

        if (fee > 0) {
            claimable[platform] += fee;
        }
        if (buyerAmount > 0) {
            claimable[e.buyer] += buyerAmount;
        }
        if (sellerAmount > 0) {
            claimable[e.seller] += sellerAmount;
        }

        emit DisputeResolved(escrowId, buyerAmount, sellerAmount);
    }

    /// @notice Seller claims funds after dispute window expires without buyer action.
    function claimExpired(uint256 escrowId) external nonReentrant {
        EscrowData storage e = escrows[escrowId];
        if (msg.sender != e.seller) revert NotSeller();
        if (e.status != EscrowStatus.ACTIVE) revert InvalidStatus();
        if (block.timestamp <= e.disputeDeadline) revert DisputeWindowActive();

        e.status = EscrowStatus.EXPIRED_CLAIMED;

        _distribute(e);

        emit ExpiredClaimed(escrowId, msg.sender);
    }

    /// @notice Pull-pattern: claim any resolved dispute funds.
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(msg.sender, amount);
    }

    // ── Admin ───────────────────────────────────────────────────────────

    function setDisputeWindow(uint256 _window) external onlyOwner {
        require(_window <= 30 days, "Max 30 day dispute window");
        disputeWindow = _window;
    }

    function setDefaultFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        defaultFeeBps = _feeBps;
    }

    function setPlatform(address _platform) external onlyOwner {
        if (_platform == address(0)) revert ZeroAddress();
        address old = platform;
        // Migrate any accrued platform fees from the previous address onto
        // the new address. Without this, rotating out a compromised key
        // leaves every fee resolved before the rotation claimable by the
        // attacker — the exact risk the rotation is trying to close.
        if (old != _platform && old != address(0)) {
            uint256 pending = claimable[old];
            if (pending > 0) {
                claimable[old] = 0;
                claimable[_platform] += pending;
            }
        }
        emit PlatformUpdated(old, _platform);
        platform = _platform;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Internal ────────────────────────────────────────────────────────

    /// @dev Distribute escrowed amount: platform fee routed through PaymentRouter (M2 fix),
    ///      rest accrues to seller via pull pattern.
    function _distribute(EscrowData storage e) internal {
        uint256 fee = (e.amount * e.platformFeeBps) / 10000;
        uint256 sellerAmount = e.amount - fee;

        if (fee > 0) {
            // M2 fix: route through PaymentRouter if available, otherwise fallback to claimable
            if (address(paymentRouter) != address(0)) {
                try paymentRouter.routeToTreasury{value: fee}() {
                // Successfully routed through PaymentRouter
                }
                catch {
                    // Fallback: accumulate in claimable mapping
                    claimable[platform] += fee;
                }
            } else {
                claimable[platform] += fee;
            }
        }
        if (sellerAmount > 0) {
            claimable[e.seller] += sellerAmount;
        }
    }

    // ── View ────────────────────────────────────────────────────────────

    function getEscrow(uint256 escrowId) external view returns (EscrowData memory) {
        return escrows[escrowId];
    }

    // ── Upgrade ─────────────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @dev Reserved storage gap for future upgrades (M4)
    uint256[50] private __gap;
}
