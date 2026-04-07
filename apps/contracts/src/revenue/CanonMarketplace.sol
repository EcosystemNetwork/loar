// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/utils/ReentrancyGuard.sol";

/// @title CanonMarketplace
/// @notice Governance-gated marketplace for submitting world-building entities into canon.
///         Covers all creator entity kinds: characters, plot arcs, locations, lore rules,
///         items, factions, species, vehicles, technology, and organizations.
///         Universe token holders vote submissions into canon. Accepted creators earn fees.
contract CanonMarketplace is ReentrancyGuard {
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
    uint16 public platformFeeBps;         // platform cut on submission fees
    uint16 public canonLicenseFeeBps;     // platform cut on license fees
    uint256 public minSubmissionFee;
    uint256 public votingDuration;        // seconds

    // Creator earnings
    mapping(address => uint256) public creatorEarnings;

    event SubmissionCreated(uint256 indexed id, uint256 universeId, SubmissionType subType, address creator, bytes32 contentHash);
    event VoteCast(uint256 indexed submissionId, address voter, bool support, uint256 weight);
    event SubmissionAccepted(uint256 indexed submissionId, uint256 universeId);
    event SubmissionRejected(uint256 indexed submissionId);
    event CanonLicensed(uint256 indexed licenseId, uint256 submissionId, address licensee, uint256 fee);
    event EarningsClaimed(address indexed creator, uint256 amount);

    error AlreadyVoted();
    error VotingNotActive();
    error VotingNotEnded();
    error InsufficientFee();
    error NotCreator();
    error InvalidStatus();
    error NoBalance();
    error TransferFailed();
    error NoVotingPower();

    constructor(
        address _platform,
        uint16 _platformFeeBps,
        uint16 _canonLicenseFeeBps,
        uint256 _minSubmissionFee,
        uint256 _votingDuration
    ) {
        platform = _platform;
        platformFeeBps = _platformFeeBps;
        canonLicenseFeeBps = _canonLicenseFeeBps;
        minSubmissionFee = _minSubmissionFee;
        votingDuration = _votingDuration;
    }

    /// @notice Submit content for canon consideration
    function submit(
        uint256 universeId,
        address universeToken,
        SubmissionType subType,
        bytes32 contentHash,
        string calldata metadataURI
    ) external payable nonReentrant returns (uint256 submissionId) {
        if (msg.value < minSubmissionFee) revert InsufficientFee();

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
            createdAt: block.timestamp
        });

        // Platform takes cut of submission fee
        uint256 platformCut = (msg.value * platformFeeBps) / 10000;
        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit SubmissionCreated(submissionId, universeId, subType, msg.sender, contentHash);
    }

    /// @notice Vote on a submission (weighted by governance token balance)
    function vote(uint256 submissionId, bool support) external {
        Submission storage sub = submissions[submissionId];
        if (sub.status != SubmissionStatus.VOTING) revert VotingNotActive();
        if (block.timestamp > sub.votingDeadline) revert VotingNotActive();
        if (hasVoted[submissionId][msg.sender]) revert AlreadyVoted();

        uint256 weight = IERC20(sub.universeToken).balanceOf(msg.sender);
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

            // Creator earns the remaining submission fee
            uint256 platformCut = (sub.submissionFee * platformFeeBps) / 10000;
            uint256 creatorReward = sub.submissionFee - platformCut;
            creatorEarnings[sub.creator] += creatorReward;

            emit SubmissionAccepted(submissionId, sub.universeId);
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

        // Split license fee
        uint256 platformCut = (msg.value * canonLicenseFeeBps) / 10000;
        uint256 creatorCut = msg.value - platformCut;

        creatorEarnings[sub.creator] += creatorCut;
        if (platformCut > 0) {
            (bool s,) = platform.call{value: platformCut}("");
            if (!s) revert TransferFailed();
        }

        emit CanonLicensed(licenseId, submissionId, msg.sender, msg.value);
    }

    /// @notice Creator claims accumulated earnings
    function claimEarnings() external nonReentrant {
        uint256 amount = creatorEarnings[msg.sender];
        if (amount == 0) revert NoBalance();

        creatorEarnings[msg.sender] = 0;
        (bool success,) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit EarningsClaimed(msg.sender, amount);
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
