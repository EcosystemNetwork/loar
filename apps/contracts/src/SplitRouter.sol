// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IPaymentRouter} from "./interfaces/IPaymentRouter.sol";

/// @title SplitRouter
/// @notice Routes ETH payments to multiple recipients based on basis point splits.
///         Wraps PaymentRouter — deducts platform fee first, then distributes
///         the remainder among co-creators according to their configured shares.
///
///         Use case: Co-created universes, collaborative episodes, shared IP.
///         Each entity (universe, content, episode) can have its own split config.
contract SplitRouter is ReentrancyGuard, Ownable {
    struct Split {
        address recipient;
        uint16 bps; // basis points out of 10000
    }

    IPaymentRouter public paymentRouter;
    uint256 public paymentRouterChangeRequestedAt;
    address public pendingPaymentRouter;
    uint256 public constant ROUTER_CHANGE_DELAY = 2 days;

    /// @notice entityHash => configured splits
    mapping(bytes32 => Split[]) internal _splits;
    /// @notice entityHash => address that controls the splits
    mapping(bytes32 => address) public splitOwner;
    /// @notice Addresses authorized to register split ownership (e.g., UniverseManager, revenue contracts)
    mapping(address => bool) public registrars;

    /// @notice SPLIT-02: Tracks last split change time to enforce cooldown
    mapping(bytes32 => uint256) public splitsLastChangedAt;
    /// @notice SPLIT-02: Minimum delay between split reconfigurations (prevents frontrunning payments)
    uint256 public constant SPLIT_CHANGE_COOLDOWN = 1 days;

    uint16 public constant MAX_RECIPIENTS = 10;
    uint16 public constant MAX_FEE_BPS = 5000;

    event SplitsConfigured(
        bytes32 indexed entityHash, address indexed owner, uint256 recipientCount
    );
    event SplitPayment(
        bytes32 indexed entityHash,
        uint256 totalAmount,
        uint256 recipientCount,
        uint16 platformFeeBps
    );
    event RegistrarUpdated(address indexed registrar, bool authorized);
    event PaymentRouterChangeRequested(address indexed pendingRouter, uint256 executeAfter);
    event PaymentRouterChanged(address indexed oldRouter, address indexed newRouter);

    error InvalidSplitTotal();
    error TooManyRecipients();
    error NotSplitOwner();
    error NotRegistrar();
    error NoSplitsConfigured();
    error ZeroAddress();
    error FeeTooHigh();
    error NoChangeRequested();
    error TimelockNotElapsed();
    error SplitChangeCooldownActive();

    constructor(address _paymentRouter) Ownable(msg.sender) {
        if (_paymentRouter == address(0)) revert ZeroAddress();
        paymentRouter = IPaymentRouter(_paymentRouter);
    }

    /// @notice Add or remove a registrar (trusted contract that can register initial split ownership)
    function setRegistrar(address registrar, bool authorized) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        registrars[registrar] = authorized;
        emit RegistrarUpdated(registrar, authorized);
    }

    /// @notice Register initial split ownership for an entity. Only callable by registrars.
    ///         Prevents front-running — only trusted contracts can claim unowned entities.
    function registerSplitOwner(bytes32 entityHash, address owner_) external {
        if (!registrars[msg.sender]) revert NotRegistrar();
        if (owner_ == address(0)) revert ZeroAddress();
        if (splitOwner[entityHash] != address(0)) revert NotSplitOwner(); // already owned
        splitOwner[entityHash] = owner_;
    }

    /// @notice Configure splits for an entity (universe, content, episode)
    /// @param entityHash Unique identifier (keccak256 of entity type + ID)
    /// @param splits Array of recipient + bps pairs. Must sum to 10000.
    function setSplits(bytes32 entityHash, Split[] calldata splits) external {
        // Only the registered owner can set splits. Unowned entities must be registered first.
        if (splitOwner[entityHash] != msg.sender) {
            revert NotSplitOwner();
        }
        // SPLIT-02: Enforce cooldown to prevent frontrunning payments by reconfiguring splits
        if (block.timestamp < splitsLastChangedAt[entityHash] + SPLIT_CHANGE_COOLDOWN) {
            revert SplitChangeCooldownActive();
        }
        if (splits.length == 0 || splits.length > MAX_RECIPIENTS) revert TooManyRecipients();

        uint256 totalBps = 0;
        for (uint256 i = 0; i < splits.length; i++) {
            if (splits[i].recipient == address(0)) revert ZeroAddress();
            totalBps += splits[i].bps;
        }
        if (totalBps != 10000) revert InvalidSplitTotal();

        // Store splits
        delete _splits[entityHash];
        for (uint256 i = 0; i < splits.length; i++) {
            _splits[entityHash].push(splits[i]);
        }
        splitOwner[entityHash] = msg.sender;
        splitsLastChangedAt[entityHash] = block.timestamp;

        emit SplitsConfigured(entityHash, msg.sender, splits.length);
    }

    /// @notice Route a payment through splits. Platform fee deducted first,
    ///         then remainder distributed to co-creators.
    /// @param entityHash Entity whose splits to use
    /// @param platformFeeBps Platform fee in basis points
    function routeWithSplits(bytes32 entityHash, uint16 platformFeeBps)
        external
        payable
        nonReentrant
    {
        if (platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        Split[] storage splits = _splits[entityHash];
        if (splits.length == 0) revert NoSplitsConfigured();
        if (msg.value == 0) return;

        // Deduct platform fee to treasury
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 distributable = msg.value - platformCut;

        if (platformCut > 0) {
            paymentRouter.routeToTreasury{value: platformCut}();
        }

        // Distribute remainder to co-creators via PaymentRouter (0 fee — already taken).
        // NOTE: Due to integer division, earlier recipients may lose fractional wei.
        // The last recipient receives the remainder (distributable - distributed) to
        // collect all rounding dust, ensuring no ETH is left in the contract.
        uint256 distributed = 0;
        for (uint256 i = 0; i < splits.length; i++) {
            uint256 share;
            if (i == splits.length - 1) {
                share = distributable - distributed; // last gets remainder
            } else {
                share = (distributable * splits[i].bps) / 10000;
            }
            if (share > 0) {
                paymentRouter.route{value: share}(splits[i].recipient, 0);
                distributed += share;
            }
        }

        emit SplitPayment(entityHash, msg.value, splits.length, platformFeeBps);
    }

    /// @notice Get splits for an entity
    function getSplits(bytes32 entityHash) external view returns (Split[] memory) {
        return _splits[entityHash];
    }

    /// @notice Transfer split ownership
    function transferSplitOwnership(bytes32 entityHash, address newOwner) external {
        if (splitOwner[entityHash] != msg.sender) revert NotSplitOwner();
        if (newOwner == address(0)) revert ZeroAddress();
        splitOwner[entityHash] = newOwner;
    }

    /// @notice Request a PaymentRouter change (timelock step 1)
    function requestPaymentRouterChange(address _paymentRouter) external onlyOwner {
        if (_paymentRouter == address(0)) revert ZeroAddress();
        pendingPaymentRouter = _paymentRouter;
        paymentRouterChangeRequestedAt = block.timestamp;
        emit PaymentRouterChangeRequested(_paymentRouter, block.timestamp + ROUTER_CHANGE_DELAY);
    }

    /// @notice Execute a pending PaymentRouter change after timelock delay (step 2)
    function executePaymentRouterChange() external onlyOwner {
        if (pendingPaymentRouter == address(0)) revert NoChangeRequested();
        if (block.timestamp < paymentRouterChangeRequestedAt + ROUTER_CHANGE_DELAY) {
            revert TimelockNotElapsed();
        }

        address oldRouter = address(paymentRouter);
        paymentRouter = IPaymentRouter(pendingPaymentRouter);
        emit PaymentRouterChanged(oldRouter, pendingPaymentRouter);

        pendingPaymentRouter = address(0);
        paymentRouterChangeRequestedAt = 0;
    }
}
