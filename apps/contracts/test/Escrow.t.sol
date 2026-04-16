// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {Escrow} from "../src/revenue/Escrow.sol";

/// @dev Reentrancy attacker targeting Escrow.claim()
contract ReentrancyAttacker {
    Escrow public escrow;
    uint256 public attacks;

    constructor(Escrow _escrow) { escrow = _escrow; }

    function attack() external { escrow.claim(); }

    receive() external payable {
        if (attacks < 2) {
            attacks++;
            escrow.claim();
        }
    }
}

contract EscrowTest is Test {
    Escrow public escrow;

    address deployer = makeAddr("deployer");
    address platform = makeAddr("platform");
    address buyer    = makeAddr("buyer");
    address seller   = makeAddr("seller");
    address admin    = makeAddr("admin");

    uint16 constant FEE_BPS = 500; // 5%
    uint256 constant DISPUTE_WINDOW = 7 days;

    function setUp() public {
        vm.startPrank(deployer);
        Escrow impl = new Escrow();
        escrow = Escrow(address(new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Escrow.initialize, (platform, address(1), FEE_BPS, DISPUTE_WINDOW))
        )));
        vm.stopPrank();

        vm.deal(buyer, 100 ether);
        vm.deal(seller, 10 ether);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Initialize
    // ═══════════════════════════════════════════════════════════════════

    function test_initialize() public view {
        assertEq(escrow.platform(), platform);
        assertEq(escrow.defaultFeeBps(), FEE_BPS);
        assertEq(escrow.disputeWindow(), DISPUTE_WINDOW);
        assertEq(escrow.owner(), deployer);
    }

    function test_initialize_revert_zeroPlatform() public {
        Escrow impl = new Escrow();
        vm.expectRevert(Escrow.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Escrow.initialize, (address(0), address(1), FEE_BPS, DISPUTE_WINDOW))
        );
    }

    function test_initialize_revert_feeTooHigh() public {
        Escrow impl = new Escrow();
        vm.expectRevert(Escrow.FeeTooHigh.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(Escrow.initialize, (platform, address(1), 5001, DISPUTE_WINDOW))
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Create Escrow
    // ═══════════════════════════════════════════════════════════════════

    function test_createEscrow() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "ipfs://metadata");

        assertEq(id, 0);
        Escrow.EscrowData memory e = escrow.getEscrow(id);
        assertEq(e.buyer, buyer);
        assertEq(e.seller, seller);
        assertEq(e.amount, 1 ether);
        assertEq(uint8(e.status), uint8(Escrow.EscrowStatus.ACTIVE));
    }

    function test_createEscrow_revert_zeroValue() public {
        vm.prank(buyer);
        vm.expectRevert(Escrow.ZeroAmount.selector);
        escrow.createEscrow{value: 0}(seller, bytes32(uint256(1)), "");
    }

    function test_createEscrow_revert_zeroSeller() public {
        vm.prank(buyer);
        vm.expectRevert(Escrow.ZeroAddress.selector);
        escrow.createEscrow{value: 1 ether}(address(0), bytes32(uint256(1)), "");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Confirm Delivery
    // ═══════════════════════════════════════════════════════════════════

    function test_confirmDelivery() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.confirmDelivery(id);

        Escrow.EscrowData memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(Escrow.EscrowStatus.COMPLETED));

        // Seller gets 95%, platform gets 5%
        assertEq(escrow.claimable(seller), 0.95 ether);
        assertEq(escrow.claimable(platform), 0.05 ether);
    }

    function test_confirmDelivery_revert_notBuyer() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(seller);
        vm.expectRevert(Escrow.NotBuyer.selector);
        escrow.confirmDelivery(id);
    }

    function test_confirmDelivery_revert_alreadyCompleted() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.confirmDelivery(id);

        vm.prank(buyer);
        vm.expectRevert(Escrow.InvalidStatus.selector);
        escrow.confirmDelivery(id);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Dispute
    // ═══════════════════════════════════════════════════════════════════

    function test_disputeEscrow() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.disputeEscrow(id, "Item not delivered");

        Escrow.EscrowData memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(Escrow.EscrowStatus.DISPUTED));
    }

    function test_disputeEscrow_revert_afterDeadline() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(buyer);
        vm.expectRevert(Escrow.DisputeWindowExpired.selector);
        escrow.disputeEscrow(id, "Too late");
    }

    function test_disputeEscrow_revert_notBuyer() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(seller);
        vm.expectRevert(Escrow.NotBuyer.selector);
        escrow.disputeEscrow(id, "wrong caller");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Resolve Dispute
    // ═══════════════════════════════════════════════════════════════════

    function test_resolveDispute_fullRefund() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.disputeEscrow(id, "Never received");

        vm.prank(deployer); // owner
        escrow.resolveDispute(id, 1 ether, 0);

        assertEq(escrow.claimable(buyer), 1 ether);
        assertEq(escrow.claimable(seller), 0);
    }

    function test_resolveDispute_split() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.disputeEscrow(id, "Partial delivery");

        vm.prank(deployer);
        escrow.resolveDispute(id, 0.4 ether, 0.6 ether);

        assertEq(escrow.claimable(buyer), 0.4 ether);
        assertEq(escrow.claimable(seller), 0.6 ether);
    }

    function test_resolveDispute_revert_amountMismatch() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.disputeEscrow(id, "Issue");

        vm.prank(deployer);
        vm.expectRevert(Escrow.AmountMismatch.selector);
        escrow.resolveDispute(id, 0.5 ether, 0.6 ether); // doesn't add up
    }

    function test_resolveDispute_revert_notOwner() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.disputeEscrow(id, "Issue");

        vm.prank(seller);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        escrow.resolveDispute(id, 0.5 ether, 0.5 ether);
    }

    function test_resolveDispute_revert_notDisputed() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(deployer);
        vm.expectRevert(Escrow.InvalidStatus.selector);
        escrow.resolveDispute(id, 0.5 ether, 0.5 ether);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Claim Expired
    // ═══════════════════════════════════════════════════════════════════

    function test_claimExpired() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        // Warp past dispute window
        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(seller);
        escrow.claimExpired(id);

        Escrow.EscrowData memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(Escrow.EscrowStatus.EXPIRED_CLAIMED));
        assertEq(escrow.claimable(seller), 0.95 ether);
        assertEq(escrow.claimable(platform), 0.05 ether);
    }

    function test_claimExpired_revert_windowNotExpired() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(seller);
        vm.expectRevert(Escrow.DisputeWindowActive.selector);
        escrow.claimExpired(id);
    }

    function test_claimExpired_revert_notSeller() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.warp(block.timestamp + DISPUTE_WINDOW + 1);

        vm.prank(buyer);
        vm.expectRevert(Escrow.NotSeller.selector);
        escrow.claimExpired(id);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Claim (Pull Pattern)
    // ═══════════════════════════════════════════════════════════════════

    function test_claim() public {
        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.confirmDelivery(id);

        uint256 balBefore = seller.balance;
        vm.prank(seller);
        escrow.claim();
        assertEq(seller.balance - balBefore, 0.95 ether);
        assertEq(escrow.claimable(seller), 0);
    }

    function test_claim_revert_nothing() public {
        vm.prank(seller);
        vm.expectRevert(Escrow.NothingToClaim.selector);
        escrow.claim();
    }

    function test_claim_reentrancy() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(escrow);
        address attackerAddr = address(attacker);

        vm.prank(buyer);
        uint256 id = escrow.createEscrow{value: 1 ether}(attackerAddr, bytes32(uint256(1)), "");

        vm.prank(buyer);
        escrow.confirmDelivery(id);

        // Attacker's claim should revert on reentrancy
        vm.expectRevert();
        attacker.attack();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Admin Functions
    // ═══════════════════════════════════════════════════════════════════

    function test_setDisputeWindow() public {
        vm.prank(deployer);
        escrow.setDisputeWindow(14 days);
        assertEq(escrow.disputeWindow(), 14 days);
    }

    function test_setDefaultFeeBps() public {
        vm.prank(deployer);
        escrow.setDefaultFeeBps(1000);
        assertEq(escrow.defaultFeeBps(), 1000);
    }

    function test_setDefaultFeeBps_revert_tooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(Escrow.FeeTooHigh.selector);
        escrow.setDefaultFeeBps(5001);
    }

    function test_pause_unpause() public {
        vm.startPrank(deployer);
        escrow.pause();

        vm.expectRevert();
        vm.stopPrank();
        vm.prank(buyer);
        escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");

        vm.prank(deployer);
        escrow.unpause();

        vm.prank(buyer);
        escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Multiple Escrows
    // ═══════════════════════════════════════════════════════════════════

    function test_multipleEscrows() public {
        vm.startPrank(buyer);
        uint256 id0 = escrow.createEscrow{value: 1 ether}(seller, bytes32(uint256(1)), "");
        uint256 id1 = escrow.createEscrow{value: 2 ether}(seller, bytes32(uint256(2)), "");
        vm.stopPrank();

        assertEq(id0, 0);
        assertEq(id1, 1);

        vm.prank(buyer);
        escrow.confirmDelivery(id0);

        vm.prank(buyer);
        escrow.confirmDelivery(id1);

        // Seller: 0.95 + 1.90 = 2.85 ETH
        assertEq(escrow.claimable(seller), 2.85 ether);
        // Platform: 0.05 + 0.10 = 0.15 ETH
        assertEq(escrow.claimable(platform), 0.15 ether);
    }
}
