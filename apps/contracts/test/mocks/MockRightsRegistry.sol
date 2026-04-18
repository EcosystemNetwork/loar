// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.30;

import {IRightsRegistry} from "../../src/interfaces/IRightsRegistry.sol";

contract MockRightsRegistry is IRightsRegistry {
    mapping(bytes32 => RightsType) public _rights;
    bool public defaultMonetizable = true;

    function rights(bytes32 contentHash) external view returns (RightsType) {
        return _rights[contentHash];
    }

    function setRights(bytes32 contentHash, RightsType rightsType) external {
        _rights[contentHash] = rightsType;
    }

    function requestFreeze(bytes32, string calldata) external {}
    function confirmFreeze(bytes32) external {}
    function emergencyFreeze(bytes32, string calldata) external {}
    function unfreeze(bytes32) external {}

    function isMonetizable(bytes32 contentHash) external view returns (bool) {
        RightsType r = _rights[contentHash];
        if (r == RightsType.UNSET) return defaultMonetizable;
        return r == RightsType.ORIGINAL || r == RightsType.LICENSED || r == RightsType.PUBLIC_DOMAIN;
    }

    function setDefaultMonetizable(bool v) external {
        defaultMonetizable = v;
    }
}
