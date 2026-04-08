// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {IRightsRegistry} from "../interfaces/IRightsRegistry.sol";
import {IPaymentRouter} from "../interfaces/IPaymentRouter.sol";

/// @title CanonMarketplace
/// @notice Governance-gated marketplace for submitting world-building entities into canon.
///         Covers all creator entity kinds: characters, plot arcs, locations, lore rules,
///         items, factions, species, vehicles, technology, and organizations.
///         Universe token holders vote submissions into canon. Accepted creators earn fees.
contract CanonMarketplace is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
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

    // universeId => accepted submission IDs
    mapping(uint256 => uint256[]) public canonSubmissions;

    address public platform;
    IRightsRegistry public rightsRegistry;
    IPaymentRouter public paymentRouter;
    uint16 public platformFeeBps;         // platform cut on submission fees
    uint16 public canonLicenseFeeBps;     // platform cut on license fees
    uint256 public minSubmissionFee;
    uint256 public votingDuration;        // seconds

    event SubmissionCreated(uint256 indexed id, uint256 universeId, SubmissionType subType, address creator, bytes32 contentHash);
    event VoteCast(uint256 indexed submissionId, address voter, bool support, uint256 weight);
    event SubmissionAccepted(uint256 indexed submissionId, uint256 universeId);
    event SubmissionRejected(uint256 indexed submissionId);
    event CanonLicensed(uint256 indexed licenseId, uint256 submissionId, address licensee, uint256 fee);
    event CanonSubmissionAccepted(uint256 indexed universeId, uint256 indexed submissionId, bytes32 contentHash);

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

    uint16 public constant MAX_FEE_BPS = 5000;

    error ZeroAddress();

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
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    error InvalidToken();

    /// @notice Submit content for canon consideration
    /// @param universeToken Must be a valid IVotes token (governance token for the universe)
    function submit(
        uint256 universeId,
        address universeToken,
        SubmissionType subType,
        bytes32 contentHash,
        string calldata metadataURI
    ) external payable nonReentrant returns (uint256 submissionId) {
        if (universeToken == address(0)) revert InvalidToken();
        if (!rightsRegistry.isMonetizable(contentHash)) revert ContentNotMonetizable();
        if (msg.value < minSubmissionFee) revert InsufficientFee();
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
            snapshotBlock: block.number - 1
        });

        // Platform takes cut of submission fee via PaymentRouter
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        if (platformCut > 0) {
            paymentRouter.routeToTreasury{value: platformCut}();
        }

        emit SubmissionCreated(submissionId, universeId, subType, msg.sender, contentHash);
    }

    /// @notice Vote on a submission (weighted by governance token snapshot at submission time)
    /// @dev Uses getPastVotes() for flash-loan protection — vote weight is locked at snapshotBlock
    function vote(uint256 submissionId, bool support) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VOTING) revert VotingNotActive();
        if (block.timestamp > sub.votingDeadline) revert VotingNotActive();
        if (hasVoted[submissionId][msg.sender]) revert AlreadyVoted();

        // Use snapshot voting power (block before submission) — immune to flash loans
        uint256 weight = IVotes(sub.universeToken).getPastVotes(msg.sender, sub.snapshotBlock);
        if (weight == 0) revert NoVotingPower();

        hasVoted[submissionId][msg.sender] = true;
        voteWeight[submissionId][msg.sender] = weight;

        if (support) {
            sub.votesFor += weight;
        } else {
            sub.votesAgainst += weight;
        }

        emit VoteCast(submissionId, msg.sender, support, weight);
    }

    /// @notice Finalize a submission after voting ends
    function finalize(uint256 submissionId) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VOTING) revert InvalidStatus();
        if (block.timestamp < sub.votingDeadline) revert VotingNotEnded();

        if (sub.votesFor > sub.votesAgainst) {
            sub.status = SubmissionStatus.ACCEPTED;
            canonSubmissions[sub.universeId].push(submissionId);

            // Creator earns the remaining submission fee via PaymentRouter
            uint256 platformCut = (sub.submissionFee * platformFeeBps) / 10000;
            uint256 creatorReward = sub.submissionFee - platformCut;
            if (creatorReward > 0) {
                paymentRouter.route{value: creatorReward}(sub.creator, 0);
            }

            emit SubmissionAccepted(submissionId, sub.universeId);
            emit CanonSubmissionAccepted(sub.universeId, submissionId, sub.contentHash);
        } else {
            sub.status = SubmissionStatus.REJECTED;
            emit SubmissionRejected(submissionId);
        }
    }

    /// @notice License accepted canon content for use within the universe
    function licenseCanon(uint256 submissionId) external payable nonReentrant returns (uint256 licenseId) {
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

    /// @notice Get submission count for a universe
    function getSubmissionCount(uint256 universeId) external view returns (uint256) {
        return canonSubmissions[universeId].length;
    }
}
