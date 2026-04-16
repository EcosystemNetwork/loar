// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract GovernanceERC20 is ERC20, ERC20Permit, ERC20Votes {
    string public imageUrl;
    string public metadata;
    string public context;
    address public tokenAdmin;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _imageUrl,
        string memory _metadata,
        string memory _context,
        address _tokenAdmin,
        uint256 _supply,
        address _mintTo
    ) ERC20(_name, _symbol) ERC20Permit(_name) {
        imageUrl = _imageUrl;
        metadata = _metadata;
        context = _context;
        tokenAdmin = _tokenAdmin;
        _mint(_mintTo, _supply);
    }

    function _update(address from, address to, uint256 value)
        internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(address owner) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}

contract GovernanceTokenFactory {
    event TokenCreated(address indexed token);

    function deployToken(
        string memory name,
        string memory symbol,
        string memory imageURL,
        string memory metadata,
        string memory context,
        address tokenAdmin,
        uint256 supply,
        address mintTo
    ) external returns (address) {
        GovernanceERC20 token = new GovernanceERC20(
            name, symbol, imageURL, metadata, context, tokenAdmin, supply, mintTo
        );
        emit TokenCreated(address(token));
        return address(token);
    }
}
