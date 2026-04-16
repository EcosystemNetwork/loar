// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IVotes} from "@openzeppelin/governance/utils/IVotes.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {UniverseTimelockGovernor} from "../UniverseTimelockGovernor.sol";

/// @title TimelockDeployer — deploys TimelockController (kept separate to fit EIP-170).
library TimelockDeployer {
    function deploy(address admin) external returns (TimelockController) {
        address[] memory p = new address[](0);
        address[] memory e = new address[](1);
        e[0] = address(0);
        return new TimelockController(24 hours, p, e, admin);
    }
}

/// @title GovernorDeployer — deploys UniverseTimelockGovernor + wires roles.
library GovernorDeployer {
    function deployGovernance(
        address tokenAddress,
        address deployer
    ) external returns (address) {
        TimelockController tl = TimelockDeployer.deploy(deployer);
        UniverseTimelockGovernor g = new UniverseTimelockGovernor(IVotes(tokenAddress), tl);

        tl.grantRole(tl.PROPOSER_ROLE(), address(g));
        tl.grantRole(tl.CANCELLER_ROLE(), address(g));
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), deployer);

        return address(g);
    }
}
