// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {UniverseGovernor} from "../UniverseGovernor.sol";

contract GovernorFactory {
    /// @notice Default early-life period: ~30 days on Base L2 at 2s blocks (GOV-04)
    uint256 public constant DEFAULT_EARLY_LIFE_BLOCKS = 1_296_000;

    event GovernorCreated(address indexed governor, address indexed token);

    /// @notice Deploy a governor with the default early-life period.
    function deployGovernor(address token, address timelock) external returns (address) {
        return _deploy(token, timelock, DEFAULT_EARLY_LIFE_BLOCKS);
    }

    /// @notice Deploy a governor with a custom early-life period (GOV-04).
    function deployGovernor(address token, address timelock, uint256 earlyLifeBlocks) external returns (address) {
        return _deploy(token, timelock, earlyLifeBlocks);
    }

    function _deploy(address token, address timelock, uint256 earlyLifeBlocks) internal returns (address) {
        UniverseGovernor governor = new UniverseGovernor(
            IVotes(token),
            TimelockController(payable(timelock)),
            earlyLifeBlocks
        );
        emit GovernorCreated(address(governor), token);
        return address(governor);
    }
}
