// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {ERC20} from "@openzeppelin/token/ERC20/ERC20.sol";

contract MockLoarToken is ERC20 {
    constructor() ERC20("LOAR", "LOAR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
