// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.4.0
pragma solidity ^0.8.27;

import {Governor} from "@openzeppelin/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/governance/extensions/GovernorSettings.sol";
import {GovernorVotes} from "@openzeppelin/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";

/// @title UniverseGovernor
/// @notice Per-universe governance using OpenZeppelin Governor.
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
///
/// IMPORTANT — no timelock is currently deployed between proposal execution
/// and state change. Before mainnet, add a TimelockController with a minimum
/// 24-hour delay to give the community time to exit if a hostile proposal passes.
///
/// Anti-takeover considerations:
///   - At T=0 the universe creator holds most tokens (minus LP). With 10% quorum
///     and no timelock, the creator can pass any proposal immediately.
///   - Mitigations: (1) add TimelockController, (2) implement vesting for creator
///     allocation, (3) consider increasing quorum to 20% for the first 30 days.
contract UniverseGovernor is Governor, GovernorSettings, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction {
    constructor(IVotes _token)
        Governor("UniverseGovernor")
        GovernorSettings(7200 /* ~1 day on Base L2 @ 2s blocks */, 50400 /* ~7 days */, 1_000_000e18 /* 1M tokens */)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10)
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
}
