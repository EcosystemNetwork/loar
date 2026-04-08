// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.4.0
pragma solidity ^0.8.27;

import {Governor} from "@openzeppelin/governance/Governor.sol";
import {GovernorCountingSimple} from "@openzeppelin/governance/extensions/GovernorCountingSimple.sol";
import {GovernorSettings} from "@openzeppelin/governance/extensions/GovernorSettings.sol";
import {GovernorVotes} from "@openzeppelin/governance/extensions/GovernorVotes.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/governance/extensions/GovernorVotesQuorumFraction.sol";
import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";

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
