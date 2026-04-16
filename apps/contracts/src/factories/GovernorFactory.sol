// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {Governor} from "@openzeppelin/contracts/governance/Governor.sol";
import {GovernorVotes} from "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import {GovernorCountingSimple} from "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import {GovernorVotesQuorumFraction} from "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";

contract UniverseGovernor is Governor, GovernorCountingSimple, GovernorVotes, GovernorVotesQuorumFraction {
    constructor(IVotes _token)
        Governor("UniverseGovernor")
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(10) {}

    function votingDelay() public pure override returns (uint256) { return 7200; }
    function votingPeriod() public pure override returns (uint256) { return 50400; }
    function proposalThreshold() public pure override returns (uint256) { return 1_000_000e18; }
}

contract GovernorFactory {
    event GovernorCreated(address indexed governor, address indexed token);

    function deployGovernor(address token) external returns (address) {
        UniverseGovernor governor = new UniverseGovernor(IVotes(token));
        emit GovernorCreated(address(governor), token);
        return address(governor);
    }
}
