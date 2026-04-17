// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @dev Minimal interface for looking up the actual governance token of a universe.
///      Prevents sockpuppet token attacks (C5) by validating caller-supplied token
///      against the on-chain source of truth.
interface IUniverseManagerLookup {
    function getUniverseData(uint id) external view returns (
        address universe, address token, address governor, address hook, address locker, address bondingCurve
    );
}

/// @title CanonMarketplace
/// @notice Governance-gated marketplace for submitting world-building entities into canon.
///         Covers all creator entity kinds: characters, plot arcs, locations, lore rules,
///         items, factions, species, vehicles, technology, and organizations.
///         Universe token holders vote submissions into canon. Accepted creators earn fees.
contract CanonMarketplace is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable {
    enum SubmissionType {
        CHARACTER,      // person
        PLOT_ARC,       // event / narrative arc
        LOCATION,       // place
        LORE_RULE,      // lore
        ITEM,           // thing
        FACTION,        // faction
        SPECIES,        // species
        VEHICLE,        // vehicle
        TECHNOLOGY,     // technology
        ORGANIZATION    // organization
    }
    enum SubmissionStatus { PENDING, VOTING, ACCEPTED, REJECTED, EXPIRED }

    struct Submission {
        uint256 id;
        uint256 universeId;
        address universeToken;       // governance token for voting
        SubmissionType submissionType;
        SubmissionStatus status;
        address creator;
        bytes32 contentHash;
        string metadataURI;          // IPFS/Walrus URI for full content
        uint256 submissionFee;       // fee paid by submitter
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votingDeadline;
        uint256 createdAt;
        uint256 snapshotBlock;       // block number for vote weight snapshot (flash loan protection)
    }

    struct CanonLicense {
        uint256 submissionId;
        address licensee;
        uint256 fee;
        uint256 grantedAt;
    }

    uint256 public nextSubmissionId;
    uint256 public nextLicenseId;

    mapping(uint256 => Submission) public submissions;
    mapping(uint256 => CanonLicense) public licenses;

    // submissionId => voter => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    // submissionId => voter => vote weight
    mapping(uint256 => mapping(address => uint256)) public voteWeight;

    // submissionId => creator's portion held by contract after platform cut in submit()
    mapping(uint256 => uint256) public creatorHeldAmount;

    /// @notice Claimable refunds for rejected submissions (pull pattern)
    mapping(address => uint256) public claimableRefunds;

    // universeId => accepted submission IDs
    mapping(uint256 => uint256[]) public canonSubmissions;

    address public platform;
    IRightsRegistry public rightsRegistry;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;         // platform cut on submission fees
    uint16 public canonLicenseFeeBps;     // platform cut on license fees
    uint256 public minSubmissionFee;
    uint256 public votingDuration;        // seconds

    /// @notice Minimum vote participation (basis points of total supply) for finalization
    uint16 public quorumBps;

    /// @notice UniverseManager contract — used to validate that caller-supplied
    ///         universeToken is the actual governance token for the universeId (C5 fix).
    IUniverseManagerLookup public universeManager;

    event SubmissionCreated(uint256 indexed id, uint256 universeId, SubmissionType subType, address creator, bytes32 contentHash);
    event VoteCast(uint256 indexed submissionId, address voter, bool support, uint256 weight);
    event SubmissionAccepted(uint256 indexed submissionId, uint256 universeId);
    event SubmissionRejected(uint256 indexed submissionId);
    event CanonLicensed(uint256 indexed licenseId, uint256 submissionId, address licensee, uint256 fee);
    event CanonSubmissionAccepted(uint256 indexed universeId, uint256 indexed submissionId, bytes32 contentHash);
    event RefundClaimed(address indexed creator, uint256 amount);

    error AlreadyVoted();
    error VotingNotActive();
    error VotingNotEnded();
    error InsufficientFee();
    error NotCreator();
    error InvalidStatus();
    error NoBalance();
    error TransferFailed();
    error NoVotingPower();
    error FeeTooHigh();
    error ContentNotMonetizable();
    error NothingToClaim();
    error QuorumNotReached();

    uint16 public constant MAX_FEE_BPS = 5000;

    /// @notice Minimum snapshot age in blocks to prevent flash loan attacks.
    /// On Base L2 (2s blocks), 15 blocks ≈ 30 seconds — enough to prevent
    /// same-block flash loan manipulation while keeping UX responsive.
    uint256 public constant MIN_SNAPSHOT_AGE = 15;

    error ZeroAddress();
    error TokenMismatch();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _platform,
        address _rightsRegistry,
        address _paymentRouter,
        uint16 _platformFeeBps,
        uint16 _canonLicenseFeeBps,
        uint256 _minSubmissionFee,
        uint256 _votingDuration
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        if (_platform == address(0) || _rightsRegistry == address(0) || _paymentRouter == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (_canonLicenseFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platform = _platform;
        rightsRegistry = IRightsRegistry(_rightsRegistry);
        paymentRouter = IPaymentRouter(_paymentRouter);
        platformFeeBps = _platformFeeBps;
        canonLicenseFeeBps = _canonLicenseFeeBps;
        minSubmissionFee = _minSubmissionFee;
        votingDuration = _votingDuration;
        quorumBps = 1000; // default 10% quorum
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    error InvalidToken();

    /// @notice Submit content for canon consideration
    /// @param universeToken Must be the governance token registered in UniverseManager for this universeId
    function submit(
        uint256 universeId,
        address universeToken,
        SubmissionType subType,
        bytes32 contentHash,
        string calldata metadataURI
    ) external payable nonReentrant whenNotPaused returns (uint256 submissionId) {
        if (universeToken == address(0)) revert InvalidToken();
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        if (msg.value < minSubmissionFee) revert InsufficientFee();

        // C5 fix: Validate universeToken is the actual governance token for this universe.
        // Prevents sockpuppet token attacks where an attacker deploys their own IVotes token
        // and uses it to vote their own submissions into another universe's canon.
        if (address(universeManager) != address(0)) {
            (, address registeredToken,,,,) = universeManager.getUniverseData(universeId);
            if (registeredToken != universeToken) revert TokenMismatch();
        }

        // Validate the token implements IVotes (will revert if not)
        try IVotes(universeToken).getPastTotalSupply(block.number - 1) {} catch { revert InvalidToken(); }

        submissionId = nextSubmissionId++;

        submissions[submissionId] = Submission({
            id: submissionId,
            universeId: universeId,
            universeToken: universeToken,
            submissionType: subType,
            status: SubmissionStatus.VOTING,
            creator: msg.sender,
            contentHash: contentHash,
            metadataURI: metadataURI,
            submissionFee: msg.value,
            votesFor: 0,
            votesAgainst: 0,
            votingDeadline: block.timestamp + votingDuration,
            createdAt: block.timestamp,
            snapshotBlock: block.number - MIN_SNAPSHOT_AGE
        });

        // Platform takes cut of submission fee via PaymentRouter
        uint256 platformCut = _platformCut(msg.value);
        uint256 held = msg.value - platformCut;
        creatorHeldAmount[submissionId] = held;
        if (platformCut > 0) {
            paymentRouter.routeToTreasury{value: platformCut}();
        }

        emit SubmissionCreated(submissionId, universeId, subType, msg.sender, contentHash);
    }

    /// @notice Vote on a submission (weighted by governance token snapshot at submission time)
    /// @dev Uses getPastVotes() for flash-loan protection — vote weight is locked at snapshotBlock.
    ///      C6 fix: nonReentrant + CEI ordering — hasVoted is set BEFORE the external call
    ///      to getPastVotes, preventing reentrancy via a malicious IVotes implementation.
    function vote(uint256 submissionId, bool support) external nonReentrant whenNotPaused {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VOTING) revert VotingNotActive();
        if (block.timestamp > sub.votingDeadline) revert VotingNotActive();
        if (hasVoted[submissionId][msg.sender]) revert AlreadyVoted();

        // CEI: Set state BEFORE external call to prevent reentrancy
        hasVoted[submissionId][msg.sender] = true;

        // External call: use snapshot voting power (block before submission) — immune to flash loans
        uint256 weight = IVotes(sub.universeToken).getPastVotes(msg.sender, sub.snapshotBlock);
        if (weight == 0) {
            // Revert undoes the hasVoted state change
            revert NoVotingPower();
        }

        voteWeight[submissionId][msg.sender] = weight;

        if (support) {
            sub.votesFor += weight;
        } else {
            sub.votesAgainst += weight;
        }

        emit VoteCast(submissionId, msg.sender, support, weight);
    }

    /// @notice Finalize a submission after voting ends
    function finalize(uint256 submissionId) external whenNotPaused {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VOTING) revert InvalidStatus();
        if (block.timestamp < sub.votingDeadline) revert VotingNotEnded();

        // Enforce minimum quorum: total votes must meet threshold of total supply
        if (quorumBps > 0) {
            uint256 totalVotes = sub.votesFor + sub.votesAgainst;
            uint256 totalSupply = IVotes(sub.universeToken).getPastTotalSupply(sub.snapshotBlock);
            uint256 quorumRequired = (totalSupply * quorumBps) / 10_000;
            if (totalVotes < quorumRequired) revert QuorumNotReached();
        }

        uint256 held = creatorHeldAmount[submissionId];
        creatorHeldAmount[submissionId] = 0;

        if (sub.votesFor > sub.votesAgainst) {
            sub.status = SubmissionStatus.ACCEPTED;
            canonSubmissions[sub.universeId].push(submissionId);

            // Creator earns the remaining submission fee (platform cut already taken in submit)
            if (held > 0) {
                paymentRouter.route{value: held}(sub.creator, 0);
            }

            emit SubmissionAccepted(submissionId, sub.universeId);
            emit CanonSubmissionAccepted(sub.universeId, submissionId, sub.contentHash);
        } else {
            sub.status = SubmissionStatus.REJECTED;

            // Credit rejected amount to creator as claimable refund (pull pattern)
            if (held > 0) {
                claimableRefunds[sub.creator] += held;
            }

            emit SubmissionRejected(submissionId);
        }
    }

    /// @notice Claim accumulated refunds from rejected submissions
    function claimRefund() external nonReentrant {
        uint256 amount = claimableRefunds[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimableRefunds[msg.sender] = 0;
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "Refund transfer failed");
        emit RefundClaimed(msg.sender, amount);
    }

    /// @dev Compute platform cut from a gross amount
    function _platformCut(uint256 amount) private view returns (uint256) {
        return (amount * platformFeeBps) / 10000;
    }

    /// @notice License accepted canon content for use within the universe
    function licenseCanon(uint256 submissionId) external payable nonReentrant whenNotPaused returns (uint256 licenseId) {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.ACCEPTED) revert InvalidStatus();

        licenseId = nextLicenseId++;
        licenses[licenseId] = CanonLicense({
            submissionId: submissionId,
            licensee: msg.sender,
            fee: msg.value,
            grantedAt: block.timestamp
        });

        // Route license fee through PaymentRouter
        if (msg.value > 0) {
            paymentRouter.route{value: msg.value}(sub.creator, canonLicenseFeeBps);
        }

        emit CanonLicensed(licenseId, submissionId, msg.sender, msg.value);
    }

    /// @notice Get canon submissions for a universe
    function getCanonSubmissions(uint256 universeId) external view returns (uint256[] memory) {
        return canonSubmissions[universeId];
    }

    /// @notice Paginated canon submission query
    function getCanonSubmissionsPaginated(uint256 universeId, uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256[] storage all = canonSubmissions[universeId];
        total = all.length;
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = all[i];
        }
    }

    /// @notice Get submission count for a universe
    function getSubmissionCount(uint256 universeId) external view returns (uint256) {
        return canonSubmissions[universeId].length;
    }

    /// @notice Update quorum requirement (owner only)
    function setQuorumBps(uint16 _quorumBps) external onlyOwner {
        require(_quorumBps <= 5000, "Max 50% quorum");
        quorumBps = _quorumBps;
    }

    /// @notice Set the UniverseManager for token validation (C5 fix).
    ///         Must be called after upgrade to enable sockpuppet-token protection.
    function setUniverseManager(address _universeManager) external onlyOwner {
        if (_universeManager == address(0)) revert ZeroAddress();
        universeManager = IUniverseManagerLookup(_universeManager);
    }
}
