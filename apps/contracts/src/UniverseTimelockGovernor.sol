// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Governor} from "@openzeppelin/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/governance/extensions/GovernorSettings.sol";
import {GovernorVotes} from "@openzeppelin/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/governance/extensions/GovernorVotesQuorumFraction.sol";
import {GovernorTimelockControl} from "@openzeppelin/governance/extensions/GovernorTimelockControl.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";

/// @title UniverseTimelockGovernor
/// @notice Production-ready per-universe governance with TimelockController.
///         This replaces UniverseGovernor for mainnet deployments.
///
///   Parameter            | Value           | Rationale
///   ---------------------|-----------------|-------------------------------------------
///   Voting Delay         | 7200 blocks     | ~1 day on Base L2. Delegates time to prepare.
///   Voting Period        | 50400 blocks    | ~7 days. Community deliberation window.
///   Proposal Threshold   | 1,000,000 tokens| ~1% of 100M supply. Prevents spam.
///   Quorum               | 10%             | Of total supply must participate.
///   Timelock Delay       | 24 hours        | Minimum delay between proposal pass and
///                        |                 | execution. Gives community exit window.
///
///   Anti-takeover: TimelockController ensures a 24h window between passing and
///   executing a hostile proposal, allowing token holders to exit or delegate.
contract UniverseTimelockGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {
    constructor(IVotes _token, TimelockController _timelock)
        Governor("UniverseTimelockGovernor")
        GovernorSettings(7200 /* ~1 day */, 50400 /* ~7 days */, 1_000_000e18)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10)
        GovernorTimelockControl(_timelock)
    {}

    // ── Required overrides ──────────────────────────────────────

    function proposalThreshold()
        public view override(Governor, GovernorSettings) returns (uint256)
    {
        return super.proposalThreshold();
    }

    function state(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (bool)
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
        internal view override(Governor, GovernorTimelockControl) returns (address)
    {
        return super._executor();
    }
}
