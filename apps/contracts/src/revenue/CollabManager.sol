// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title CollabManager
/// @notice Manages cross-universe collaborations ("collisions").
///         Two universes can merge for special event episodes, joint NFTs,
///         and shared liquidity events.
contract CollabManager is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    enum CollabStatus { PROPOSED, ACCEPTED, ACTIVE, COMPLETED, CANCELLED }

    struct Collab {
        uint256 id;
        uint256 universeA;
        uint256 universeB;
        address proposer;          // creator of universe A
        address acceptor;          // creator of universe B
        CollabStatus status;
        uint256 revenueShareBps;   // universe A's share (rest goes to B)
        uint256 totalRevenue;
        uint256 startTime;
        uint256 endTime;
        string metadataURI;        // collab details
        uint256 episodeCount;
    }

    uint256 public nextCollabId;

    mapping(uint256 => Collab) public collabs;
    // universeId => active collab IDs
    mapping(uint256 => uint256[]) public universeCollabs;

    address public platform;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;

    event CollabProposed(uint256 indexed collabId, uint256 universeA, uint256 universeB, address proposer);
    event CollabAccepted(uint256 indexed collabId, address acceptor);
    event CollabActivated(uint256 indexed collabId, uint256 startTime, uint256 endTime);
    event CollabEpisodeCreated(uint256 indexed collabId, uint256 episodeCount, uint256 revenue);
    event CollabCompleted(uint256 indexed collabId, uint256 totalRevenue);
    event CollabCancelled(uint256 indexed collabId);
    event RevenueDistributed(uint256 indexed collabId, uint256 amountA, uint256 amountB);

    error NotProposer();
    error NotAcceptor();
    error InvalidStatus();
    error CollabNotActive();
    error NotPlatform();
    error TransferFailed();
    error FeeTooHigh();

    uint16 public constant MAX_FEE_BPS = 5000;

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _platform, address _paymentRouter, uint16 _platformFeeBps) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (_platform == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice Propose a cross-universe collaboration
    function proposeCollab(
        uint256 universeA,
        uint256 universeB,
        uint256 revenueShareBps,   // A's share in bps
        uint256 duration,           // seconds
        string calldata metadataURI
    ) external returns (uint256 collabId) {
        require(revenueShareBps <= 10000, "Invalid share");

        collabId = nextCollabId++;

        collabs[collabId] = Collab({
            id: collabId,
            universeA: universeA,
            universeB: universeB,
            proposer: msg.sender,
            acceptor: address(0),
            status: CollabStatus.PROPOSED,
            revenueShareBps: revenueShareBps,
            totalRevenue: 0,
            startTime: 0,
            endTime: 0,
            metadataURI: metadataURI,
            episodeCount: 0
        });

        // Store duration temporarily in endTime
        collabs[collabId].endTime = duration;

        emit CollabProposed(collabId, universeA, universeB, msg.sender);
    }

    /// @notice Accept a collaboration proposal
    function acceptCollab(uint256 collabId) external {
        Collab storage c = collabs[collabId];
        if (c.status != CollabStatus.PROPOSED) revert InvalidStatus();

        c.acceptor = msg.sender;
        c.status = CollabStatus.ACCEPTED;

        emit CollabAccepted(collabId, msg.sender);
    }

    /// @notice Activate a collaboration (starts the event window)
    function activateCollab(uint256 collabId) external {
        Collab storage c = collabs[collabId];
        if (c.status != CollabStatus.ACCEPTED) revert InvalidStatus();
        require(msg.sender == c.proposer || msg.sender == c.acceptor, "Not participant");

        uint256 duration = c.endTime; // was stored temporarily
        c.startTime = block.timestamp;
        c.endTime = block.timestamp + duration;
        c.status = CollabStatus.ACTIVE;

        universeCollabs[c.universeA].push(collabId);
        universeCollabs[c.universeB].push(collabId);

        emit CollabActivated(collabId, c.startTime, c.endTime);
    }

    /// @notice Record revenue from a collab episode (called by platform)
    function recordCollabRevenue(uint256 collabId) external payable onlyPlatform {
        Collab storage c = collabs[collabId];
        if (c.status != CollabStatus.ACTIVE) revert CollabNotActive();

        c.totalRevenue += msg.value;
        c.episodeCount++;

        // Platform cut
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        uint256 distributable = msg.value - platformCut;

        // Split between universes via PaymentRouter
        uint256 shareA = (distributable * c.revenueShareBps) / 10000;
        uint256 shareB = distributable - shareA;

        if (platformCut > 0) {
            paymentRouter.routeToTreasury{value: platformCut}();
        }
        if (shareA > 0) {
            paymentRouter.route{value: shareA}(c.proposer, 0);
        }
        if (shareB > 0) {
            paymentRouter.route{value: shareB}(c.acceptor, 0);
        }

        emit CollabEpisodeCreated(collabId, c.episodeCount, msg.value);
        emit RevenueDistributed(collabId, shareA, shareB);
    }

    /// @notice Complete a collaboration and enable revenue claims
    function completeCollab(uint256 collabId) external {
        Collab storage c = collabs[collabId];
        if (c.status != CollabStatus.ACTIVE) revert InvalidStatus();
        require(block.timestamp >= c.endTime || msg.sender == platform, "Not ended");

        c.status = CollabStatus.COMPLETED;
        emit CollabCompleted(collabId, c.totalRevenue);
    }

    /// @notice Cancel a proposed collab
    function cancelCollab(uint256 collabId) external {
        Collab storage c = collabs[collabId];
        if (c.status != CollabStatus.PROPOSED && c.status != CollabStatus.ACCEPTED) revert InvalidStatus();
        if (msg.sender != c.proposer) revert NotProposer();

        c.status = CollabStatus.CANCELLED;
        emit CollabCancelled(collabId);
    }

    /// @notice Get active collabs for a universe
    function getUniverseCollabs(uint256 universeId) external view returns (uint256[] memory) {
        return universeCollabs[universeId];
    }
}
