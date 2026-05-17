// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Initializable} from "@openzeppelin-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/token/ERC20/utils/SafeERC20.sol";

/// @title TalentAgentRegistry (G4)
/// @notice Single-instance commission router for talent-agent agreements.
///         Each off-chain `agentContract` (Firestore) registers here with the
///         agreed commissionBps + creator + agent addresses. When a monetary
///         action happens on behalf of the creator (a bounty award, a
///         subscription, a content-license deal), the server forwards the
///         gross to `routeCommission`, which splits 3 ways:
///
///           agentAmount    = grossAmount × commissionBps / 10_000
///           platformAmount = grossAmount × platformFeeBps / 10_000
///           creatorAmount  = grossAmount − agentAmount − platformAmount
///
///         All three transfers happen atomically. The contract emits one event
///         per route so the indexer can mirror commission accrual on-chain.
///
/// Design choices:
///   - Single contract (not factory-per-agreement) keeps deploys cheap.
///     Per-agreement state lives in the `agreements` mapping.
///   - Identified by `bytes32 agreementId` — the server hashes
///     `keccak256(agentUid || creatorUid)` for collision-free lookup that
///     matches the Firestore `agentContracts/{agentUid}-{creatorUid}` doc.
///   - Supports both native ETH and ERC20 ($LOAR) settlement.
///   - Off-chain Firestore remains the source of truth for contract terms
///     (scope, status, exclusivity). This contract only holds the wallets
///     and the BPS — everything else is mirrored from off-chain.
contract TalentAgentRegistry is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    // ── Constants ───────────────────────────────────────────────────────

    /// @notice Max combined fee (agent + platform) to guard against
    ///         misconfigured agreements that would zero out the creator.
    uint16 public constant MAX_COMBINED_BPS = 5000; // 50%

    // ── Storage ─────────────────────────────────────────────────────────

    struct Agreement {
        address agent;
        address creator;
        uint16 commissionBps;
        bool active;
        uint256 totalGrossRouted;
        uint256 totalAgentEarned;
    }

    /// @notice The trusted caller that may invoke routeCommission. In
    ///         practice this is the platform's server-side Circle DCW wallet
    ///         (after Circle DCW funds the platform's executor address).
    address public platform;

    /// @notice The treasury that receives the platformFeeBps slice.
    address public treasury;

    /// @notice Default platform fee taken from each routed commission.
    uint16 public platformFeeBps;

    /// @notice agreementId → terms.
    mapping(bytes32 => Agreement) public agreements;

    // ── Events ──────────────────────────────────────────────────────────

    event AgreementRegistered(
        bytes32 indexed agreementId,
        address indexed agent,
        address indexed creator,
        uint16 commissionBps
    );
    event AgreementDeactivated(bytes32 indexed agreementId);
    event CommissionRouted(
        bytes32 indexed agreementId,
        address indexed token,
        uint256 grossAmount,
        uint256 agentAmount,
        uint256 platformAmount,
        uint256 creatorAmount,
        string sourceType,
        bytes32 sourceId
    );
    event PlatformChanged(address indexed oldPlatform, address indexed newPlatform);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event PlatformFeeBpsChanged(uint16 oldBps, uint16 newBps);

    // ── Errors ──────────────────────────────────────────────────────────

    error NotPlatform();
    error UnknownAgreement();
    error InactiveAgreement();
    error AlreadyRegistered();
    error ZeroAddress();
    error CommissionTooHigh();
    error AmountMismatch();
    error TransferFailed();

    // ── Modifiers ───────────────────────────────────────────────────────

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    // ── Initializer ─────────────────────────────────────────────────────

    function initialize(address _platform, address _treasury, uint16 _platformFeeBps)
        external
        initializer
    {
        if (_platform == address(0) || _treasury == address(0)) revert ZeroAddress();
        if (_platformFeeBps > MAX_COMBINED_BPS) revert CommissionTooHigh();

        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();
        __Pausable_init();

        platform = _platform;
        treasury = _treasury;
        platformFeeBps = _platformFeeBps;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Admin ───────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setPlatform(address newPlatform) external onlyOwner {
        if (newPlatform == address(0)) revert ZeroAddress();
        emit PlatformChanged(platform, newPlatform);
        platform = newPlatform;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setPlatformFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_COMBINED_BPS) revert CommissionTooHigh();
        emit PlatformFeeBpsChanged(platformFeeBps, newBps);
        platformFeeBps = newBps;
    }

    // ── Agreement management ────────────────────────────────────────────

    /// @notice Register a new agent-creator agreement. Called by the platform
    ///         when a Firestore agentContract transitions PROPOSED → ACTIVE.
    function registerAgreement(
        bytes32 agreementId,
        address agent,
        address creator,
        uint16 commissionBps
    ) external onlyPlatform whenNotPaused {
        if (agent == address(0) || creator == address(0)) revert ZeroAddress();
        if (commissionBps + platformFeeBps > MAX_COMBINED_BPS) revert CommissionTooHigh();
        if (agreements[agreementId].active) revert AlreadyRegistered();

        agreements[agreementId] = Agreement({
            agent: agent,
            creator: creator,
            commissionBps: commissionBps,
            active: true,
            totalGrossRouted: 0,
            totalAgentEarned: 0
        });

        emit AgreementRegistered(agreementId, agent, creator, commissionBps);
    }

    /// @notice Deactivate an agreement (TERMINATED / EXPIRED in Firestore).
    ///         Subsequent routeCommission calls will revert.
    function deactivateAgreement(bytes32 agreementId) external onlyPlatform {
        Agreement storage a = agreements[agreementId];
        if (a.agent == address(0)) revert UnknownAgreement();
        a.active = false;
        emit AgreementDeactivated(agreementId);
    }

    // ── Commission routing ──────────────────────────────────────────────

    /// @notice Route a payment through an active agreement. Native ETH path.
    ///         msg.value MUST equal grossAmount.
    function routeCommissionETH(
        bytes32 agreementId,
        uint256 grossAmount,
        string calldata sourceType,
        bytes32 sourceId
    ) external payable onlyPlatform nonReentrant whenNotPaused {
        if (msg.value != grossAmount) revert AmountMismatch();
        Agreement storage a = agreements[agreementId];
        if (a.agent == address(0)) revert UnknownAgreement();
        if (!a.active) revert InactiveAgreement();

        uint256 agentAmount = (grossAmount * a.commissionBps) / 10_000;
        uint256 platformAmount = (grossAmount * platformFeeBps) / 10_000;
        uint256 creatorAmount = grossAmount - agentAmount - platformAmount;

        a.totalGrossRouted += grossAmount;
        a.totalAgentEarned += agentAmount;

        _sendETH(a.agent, agentAmount);
        _sendETH(treasury, platformAmount);
        _sendETH(a.creator, creatorAmount);

        emit CommissionRouted(
            agreementId,
            address(0),
            grossAmount,
            agentAmount,
            platformAmount,
            creatorAmount,
            sourceType,
            sourceId
        );
    }

    /// @notice Route a payment through an active agreement. ERC20 path —
    ///         caller must have approved `grossAmount` of `token` to this
    ///         contract beforehand.
    function routeCommissionERC20(
        bytes32 agreementId,
        address token,
        uint256 grossAmount,
        string calldata sourceType,
        bytes32 sourceId
    ) external onlyPlatform nonReentrant whenNotPaused {
        if (token == address(0)) revert ZeroAddress();
        Agreement storage a = agreements[agreementId];
        if (a.agent == address(0)) revert UnknownAgreement();
        if (!a.active) revert InactiveAgreement();

        uint256 agentAmount = (grossAmount * a.commissionBps) / 10_000;
        uint256 platformAmount = (grossAmount * platformFeeBps) / 10_000;
        uint256 creatorAmount = grossAmount - agentAmount - platformAmount;

        a.totalGrossRouted += grossAmount;
        a.totalAgentEarned += agentAmount;

        IERC20(token).safeTransferFrom(msg.sender, a.agent, agentAmount);
        IERC20(token).safeTransferFrom(msg.sender, treasury, platformAmount);
        IERC20(token).safeTransferFrom(msg.sender, a.creator, creatorAmount);

        emit CommissionRouted(
            agreementId,
            token,
            grossAmount,
            agentAmount,
            platformAmount,
            creatorAmount,
            sourceType,
            sourceId
        );
    }

    // ── Views ───────────────────────────────────────────────────────────

    function getAgreement(bytes32 agreementId) external view returns (Agreement memory) {
        return agreements[agreementId];
    }

    function isActive(bytes32 agreementId) external view returns (bool) {
        return agreements[agreementId].active;
    }

    function computeSplit(bytes32 agreementId, uint256 grossAmount)
        external
        view
        returns (uint256 agentAmount, uint256 platformAmount, uint256 creatorAmount)
    {
        Agreement memory a = agreements[agreementId];
        if (a.agent == address(0)) revert UnknownAgreement();
        agentAmount = (grossAmount * a.commissionBps) / 10_000;
        platformAmount = (grossAmount * platformFeeBps) / 10_000;
        creatorAmount = grossAmount - agentAmount - platformAmount;
    }

    // ── Internal ────────────────────────────────────────────────────────

    function _sendETH(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
