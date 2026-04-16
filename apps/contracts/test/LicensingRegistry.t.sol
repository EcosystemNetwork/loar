// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {LicensingRegistry} from "../src/revenue/LicensingRegistry.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";

contract LicensingRegistryTest is Test {
    LicensingRegistry public lr;
    MockPaymentRouter public router;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address licensee = makeAddr("licensee");
    address buyer = makeAddr("buyer");

    uint256 constant UNIVERSE_ID = 1;
    uint16 constant FEE_BPS = 500;
    uint256 constant UPFRONT_FEE = 1 ether;
    uint256 constant DURATION = 365 days;

    function setUp() public {
        vm.deal(treasury, 0);
        vm.deal(licensee, 100 ether);
        vm.deal(buyer, 100 ether);

        router = new MockPaymentRouter(treasury);

        LicensingRegistry impl = new LicensingRegistry();
        lr = LicensingRegistry(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(LicensingRegistry.initialize, (platform, address(router), FEE_BPS))
                )
            )
        );

        vm.prank(platform);
        lr.registerUniverse(UNIVERSE_ID, creator);
    }

    // ---- helper to read License struct cleanly ----

    function _getLicense(uint256 licId)
        internal
        view
        returns (
            uint256 id,
            uint256 universeId,
            LicensingRegistry.LicenseType licenseType,
            LicensingRegistry.LicenseStatus status,
            address licensor,
            address lic_licensee,
            uint256 upfrontFee,
            uint16 royaltyBps,
            uint256 totalRoyalties,
            uint256 startTime,
            uint256 endTime,
            string memory terms
        )
    {
        (id, universeId, licenseType, status, licensor, lic_licensee,
         upfrontFee, royaltyBps, totalRoyalties, startTime, endTime, terms) = lr.licenses(licId);
    }

    // ---- initialize ----

    function test_initialize() public view {
        assertEq(lr.platform(), platform);
        assertEq(address(lr.paymentRouter()), address(router));
        assertEq(lr.platformFeeBps(), FEE_BPS);
    }

    // ---- registerUniverse ----

    function test_registerUniverse() public view {
        assertEq(lr.universeCreators(UNIVERSE_ID), creator);
    }

    // ---- createLicense ----

    function test_createLicense() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000, // 10% royalty
            DURATION,
            "ipfs://terms"
        );

        (
            uint256 id,
            uint256 universeId,
            LicensingRegistry.LicenseType licenseType,
            LicensingRegistry.LicenseStatus status,
            address licensor,
            address lic_licensee,
            uint256 upfrontFee,
            uint16 royaltyBps,
            uint256 totalRoyalties,
            ,,
        ) = _getLicense(licId);

        assertEq(id, licId);
        assertEq(universeId, UNIVERSE_ID);
        assertEq(uint8(licenseType), uint8(LicensingRegistry.LicenseType.STREAMING));
        assertEq(uint8(status), uint8(LicensingRegistry.LicenseStatus.PROPOSED));
        assertEq(licensor, creator);
        assertEq(lic_licensee, licensee);
        assertEq(upfrontFee, UPFRONT_FEE);
        assertEq(royaltyBps, 1000);
        assertEq(totalRoyalties, 0);
    }

    // ---- activateLicense ----

    function test_activateLicense() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000,
            DURATION,
            "ipfs://terms"
        );

        vm.prank(licensee);
        lr.activateLicense{value: UPFRONT_FEE}(licId);

        (,,, LicensingRegistry.LicenseStatus status,,,,,,
         uint256 startTime, uint256 endTime,) = _getLicense(licId);

        assertEq(uint8(status), uint8(LicensingRegistry.LicenseStatus.ACTIVE));
        assertEq(startTime, block.timestamp);
        assertEq(endTime, block.timestamp + DURATION);

        // Payment routed
        uint256 fee = (UPFRONT_FEE * uint256(FEE_BPS)) / 10000;
        uint256 expectedCreatorCut = UPFRONT_FEE - fee;
        assertEq(router._claimable(creator), expectedCreatorCut);
    }

    function test_activateLicense_revert_insufficientPayment() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000,
            DURATION,
            "ipfs://terms"
        );

        vm.prank(licensee);
        vm.expectRevert(LicensingRegistry.InsufficientPayment.selector);
        lr.activateLicense{value: 0.5 ether}(licId);
    }

    // ---- payRoyalty ----

    function test_payRoyalty() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000,
            DURATION,
            "ipfs://terms"
        );

        vm.prank(licensee);
        lr.activateLicense{value: UPFRONT_FEE}(licId);

        uint256 royaltyAmount = 0.5 ether;
        vm.prank(licensee);
        lr.payRoyalty{value: royaltyAmount}(licId);

        (,,,,,,,, uint256 totalRoyalties,,,) = _getLicense(licId);
        assertEq(totalRoyalties, royaltyAmount);
    }

    function test_payRoyalty_revert_expired() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000,
            DURATION,
            "ipfs://terms"
        );

        vm.prank(licensee);
        lr.activateLicense{value: UPFRONT_FEE}(licId);

        // Warp past expiry
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(licensee);
        vm.expectRevert(LicensingRegistry.LicenseExpired.selector);
        lr.payRoyalty{value: 0.1 ether}(licId);
    }

    // ---- revokeLicense ----

    function test_revokeLicense() public {
        vm.prank(creator);
        uint256 licId = lr.createLicense(
            UNIVERSE_ID,
            LicensingRegistry.LicenseType.STREAMING,
            licensee,
            UPFRONT_FEE,
            1000,
            DURATION,
            "ipfs://terms"
        );

        vm.prank(licensee);
        lr.activateLicense{value: UPFRONT_FEE}(licId);

        vm.prank(creator);
        lr.revokeLicense(licId);

        (,,, LicensingRegistry.LicenseStatus status,,,,,,,,) = _getLicense(licId);
        assertEq(uint8(status), uint8(LicensingRegistry.LicenseStatus.REVOKED));
    }

    // ---- createMerch ----

    function test_createMerch() public {
        vm.prank(creator);
        uint256 merchId = lr.createMerch(UNIVERSE_ID, "T-Shirt", "ipfs://shirt", 0.05 ether);

        (
            uint256 id,
            uint256 universeId,
            string memory name,
            string memory metadataURI,
            uint256 price,
            uint256 sold,
            address merchCreator,
            bool active
        ) = lr.merchItems(merchId);

        assertEq(id, merchId);
        assertEq(universeId, UNIVERSE_ID);
        assertEq(name, "T-Shirt");
        assertEq(metadataURI, "ipfs://shirt");
        assertEq(price, 0.05 ether);
        assertEq(sold, 0);
        assertEq(merchCreator, creator);
        assertTrue(active);
    }

    // ---- purchaseMerch ----

    function test_purchaseMerch() public {
        vm.prank(creator);
        uint256 merchId = lr.createMerch(UNIVERSE_ID, "T-Shirt", "ipfs://shirt", 0.05 ether);

        vm.prank(buyer);
        lr.purchaseMerch{value: 0.05 ether}(merchId);

        (,,,, , uint256 sold,,) = lr.merchItems(merchId);
        assertEq(sold, 1);

        // Payment routed to creator
        uint256 merchFee = (0.05 ether * uint256(FEE_BPS)) / 10000;
        uint256 expectedCreatorCut = 0.05 ether - merchFee;
        assertEq(router._claimable(creator), expectedCreatorCut);
    }
}
