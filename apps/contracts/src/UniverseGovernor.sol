// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.4.0
pragma solidity ^0.8.27;

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
///   - At T=0 the universe creator holds most tokens (minus LP). With 10% quorum
///     the creator can pass any proposal immediately, but the 24h timelock delay
///     gives the community time to exit positions.
///   - Additional mitigations: (1) vesting for creator allocation via
///     UniverseTokenDeployerV2, (2) consider increasing quorum to 20% for first 30 days.
contract UniverseGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction, GovernorTimelockControl {
    constructor(IVotes _token, TimelockController _timelock)
        Governor("UniverseGovernor")
        GovernorSettings(7200 /* ~1 day on Base L2 @ 2s blocks */, 50400 /* ~7 days */, 1_000_000e18 /* 1M tokens */)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10)
        GovernorTimelockControl(_timelock)
    {}

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
