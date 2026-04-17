// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.4.0
pragma solidity ^0.8.30;

import {Governor} from "@openzeppelin/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/governance/extensions/GovernorSettings.sol";
import {GovernorVotes} from "@openzeppelin/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/governance/extensions/GovernorTimelockControl.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";

/// @title UniverseGovernor
/// @notice Per-universe governance using OpenZeppelin Governor + TimelockController.
///
/// Default governance parameters (set in constructor, updatable via governance proposals):
///
///   Parameter            | Value           | Rationale
///   ---------------------|-----------------|-------------------------------------------
///   Voting Delay         | 7200 blocks     | ~1 day on Base L2 (2s blocks). Gives token
///                        |                 | holders time to acquire/delegate before vote.
///   Voting Period        | 50400 blocks    | ~7 days. Standard window for community input.
///   Proposal Threshold   | 1,000,000 tokens| Prevents spam proposals. ~1% of a typical
///                        |                 | 100M supply universe.
///   Quorum               | 10%             | Of total supply must vote FOR to pass.
///                        |                 | Prevents early-stage takeover by creator.
///   Timelock Delay       | 24 hours        | Gives community time to exit if hostile
///                        |                 | proposal passes. Prevents instant execution.
///
/// Anti-takeover considerations:
///   - At T=0 the universe creator holds most tokens (minus LP). The 24h timelock
///     delay gives the community time to exit positions if a hostile proposal passes.
///   - Early-life protection: quorum is 20% for the first 30 days (EARLY_LIFE_BLOCKS),
///     then drops to 10%. This prevents the creator from rubber-stamping proposals
///     before token distribution has a chance to diversify.
///   - Additional mitigations: (1) vesting for creator allocation via
///     UniverseTokenDeployerV2, (2) 24h timelock on all proposals.
contract UniverseGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {

    /// @notice Block at which this governor was deployed.
    uint256 public immutable deployedAtBlock;

    /// @notice Early-life period in blocks. Default 1_296_000 (~30 days on Base L2 at 2s blocks).
    ///         Now configurable via constructor to support different chains and testing (GOV-04).
    uint256 public immutable EARLY_LIFE_BLOCKS;

    /// @notice Quorum during early-life period (20% of total supply).
    uint256 public constant EARLY_LIFE_QUORUM_FRACTION = 20;

    constructor(IVotes _token, TimelockController _timelock, uint256 _earlyLifeBlocks)
        Governor("UniverseGovernor")
        GovernorSettings(7200 /* ~1 day on Base L2 @ 2s blocks */, 50400 /* ~7 days */, 1_000_000e18 /* 1M tokens */)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10) // steady-state quorum = 10%
        GovernorTimelockControl(_timelock)
    {
        deployedAtBlock = block.number;
        EARLY_LIFE_BLOCKS = _earlyLifeBlocks;
    }

    /// @notice Returns the quorum for a given timepoint. During the early-life period
    ///         (first ~30 days), quorum is 20% to prevent creator self-dealing.
    ///         After that, it falls back to the configurable GovernorVotesQuorumFraction (10%).
    function quorum(uint256 timepoint)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        if (block.number < deployedAtBlock + EARLY_LIFE_BLOCKS) {
            // Early life: 20% quorum (double the steady-state 10%)
            return (token().getPastTotalSupply(timepoint) * EARLY_LIFE_QUORUM_FRACTION) / 100;
        }
        return super.quorum(timepoint);
    }

    // The following functions are overrides required by Solidity.

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
}
