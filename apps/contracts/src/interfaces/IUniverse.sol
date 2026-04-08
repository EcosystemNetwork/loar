// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {NodeCreationOptions, NodeVisibilityOptions} from "../libraries/NodeOptions.sol";

interface IUniverse {
    error NodeDoesNotExist();
    error TokenDoesNotExist();
    error CanonNotSet();
    error CallerNotManager();
    error CallerNotAdmin(address caller);

    event NodeCanonized(uint id, address canonizer);
    event NodeCreated(
        uint indexed id,
        uint indexed previous,
        address indexed creator,
        bytes32 contentHash,
        bytes32 plotHash,
        string link,
        string plot
    );
    event NodeVisibilityOptionUpdated(NodeVisibilityOptions option);
    event NodeCreationOptionUpdated(NodeCreationOptions option);
    event MediaUpdated(uint indexed nodeId, address updater, bytes32 contentHash, string link);

    function setAdmin(address newAdmin) external;
    function setToken(address) external;
    function getAdmin() external returns (address);
    function getToken() external returns (address);
}
