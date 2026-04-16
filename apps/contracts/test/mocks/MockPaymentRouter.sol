// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {IPaymentRouter} from "../../src/interfaces/IPaymentRouter.sol";

contract MockPaymentRouter is IPaymentRouter {
    address public treasury;
    mapping(address => uint256) public _claimable;

    constructor(address _treasury) {
        treasury = _treasury;
    }

    function route(address creator, uint16 feeBps) external payable {
        uint256 platformCut = (msg.value * feeBps) / 10000;
        uint256 creatorCut = msg.value - platformCut;
        if (platformCut > 0) {
            (bool s,) = treasury.call{value: platformCut}("");
            require(s);
        }
        _claimable[creator] += creatorCut;
    }

    function routeToTreasury() external payable {
        (bool s,) = treasury.call{value: msg.value}("");
        require(s);
    }

    function claimable(address creator) external view returns (uint256) {
        return _claimable[creator];
    }

    function claim() external {
        uint256 amt = _claimable[msg.sender];
        _claimable[msg.sender] = 0;
        (bool s,) = msg.sender.call{value: amt}("");
        require(s);
    }

    function routeLoar(address, uint16, uint256) external {}
    function routeLoarToTreasury(uint256) external {}
    function claimableLoar(address) external pure returns (uint256) { return 0; }
    function claimLoar() external {}

    receive() external payable {}
}
