// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {GovernanceERC20} from "../src/GovernanceERC20.sol";

contract GovernanceERC20Test is Test {
    GovernanceERC20 public token;

    address deployer = makeAddr("deployer");
    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant MAX_SUPPLY = 1_000_000e18;

    function setUp() public {
        vm.prank(deployer);
        token = new GovernanceERC20(
            "TestGov",
            "TGOV",
            MAX_SUPPLY,
            admin,
            "https://example.com/image.png",
            '{"description":"test"}',
            "universe-context"
        );
    }

    // ── Constructor ──

    function test_constructor() public view {
        assertEq(token.name(), "TestGov");
        assertEq(token.symbol(), "TGOV");
        assertEq(token.totalSupply(), MAX_SUPPLY);
        assertEq(token.balanceOf(deployer), MAX_SUPPLY);
        assertEq(token.admin(), admin);
        assertEq(token.imageUrl(), "https://example.com/image.png");
        assertEq(token.metadata(), '{"description":"test"}');
        assertEq(token.context(), "universe-context");
    }

    // ── Delegation / Votes ──

    function test_delegation() public {
        // Deployer delegates to alice
        vm.prank(deployer);
        token.delegate(alice);

        // Need to mine a block so getPastVotes works
        vm.roll(block.number + 1);

        assertEq(token.getVotes(alice), MAX_SUPPLY);
        assertEq(token.getPastVotes(alice, block.number - 1), MAX_SUPPLY);
    }

    // ── Permit (EIP-2612) ──

    function test_permit() public {
        uint256 privateKey = 0xBEEF;
        address signer = vm.addr(privateKey);

        // Give signer some tokens
        vm.prank(deployer);
        token.transfer(signer, 1000e18);

        uint256 nonce = token.nonces(signer);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 amount = 500e18;

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer,
                alice,
                amount,
                nonce,
                deadline
            )
        );

        bytes32 domainSeparator = token.DOMAIN_SEPARATOR();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        token.permit(signer, alice, amount, deadline, v, r, s);

        assertEq(token.allowance(signer, alice), amount);
        assertEq(token.nonces(signer), nonce + 1);
    }
}
