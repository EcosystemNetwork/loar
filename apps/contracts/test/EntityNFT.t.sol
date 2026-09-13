// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/proxy/ERC1967/ERC1967Proxy.sol";
import {EntityNFT} from "../src/revenue/EntityNFT.sol";
import {MockPaymentRouter} from "./mocks/MockPaymentRouter.sol";
import {MockRightsRegistry} from "./mocks/MockRightsRegistry.sol";

/// @dev Regression coverage for EntityNFT.mint()'s payment routing. Before the
///      fix, a nonzero mintPrice was routed via `route(msg.sender, platformFeeBps)`,
///      which credited (mintPrice - platform's cut) right back to the same address
///      that paid it as a claimable PaymentRouter balance — so setting a mintPrice
///      only ever cost the minter the platform fee slice. The fix routes the full
///      price to treasury instead (matching StructuralDeed.mintDeed()'s identical
///      self-registration pattern).
contract EntityNFTTest is Test {
    EntityNFT public nft;
    MockPaymentRouter public router;
    MockRightsRegistry public rights;

    address platform = makeAddr("platform");
    address treasury = makeAddr("treasury");
    address minter = makeAddr("minter");

    uint256 constant UNIVERSE_ID = 1;
    uint16 constant PLATFORM_FEE_BPS = 1000; // 10%

    function setUp() public {
        router = new MockPaymentRouter(treasury);
        rights = new MockRightsRegistry();

        EntityNFT impl = new EntityNFT();
        nft = EntityNFT(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(
                        EntityNFT.initialize,
                        (
                            UNIVERSE_ID,
                            platform,
                            address(router),
                            address(rights),
                            PLATFORM_FEE_BPS,
                            500, // royaltyBps
                            "",
                            ""
                        )
                    )
                )
            )
        );

        vm.deal(minter, 10 ether);
    }

    function test_mint_paidEntity_routesFullPriceToTreasury_notBackToMinter() public {
        uint256 mintPrice = 1 ether;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(minter);
        uint256 tokenId = nft.mint{value: mintPrice}(
            UNIVERSE_ID,
            EntityNFT.EntityKind.PLACE,
            "Sunken City",
            keccak256("content"),
            mintPrice,
            "ipfs://meta"
        );

        assertEq(nft.ownerOf(tokenId), minter);

        // Full price reached treasury — none of it round-tripped to the minter.
        assertEq(treasury.balance, treasuryBefore + mintPrice, "full price should reach treasury");
        assertEq(router.claimable(minter), 0, "minter must not have a claimable balance");
    }

    function test_mint_paidEntity_refundsOverpaymentOnly() public {
        uint256 mintPrice = 1 ether;
        uint256 overpay = 0.25 ether;
        uint256 minterBefore = minter.balance;

        vm.prank(minter);
        nft.mint{value: mintPrice + overpay}(
            UNIVERSE_ID,
            EntityNFT.EntityKind.EVENT,
            "The Great Fracture",
            keccak256("content-2"),
            mintPrice,
            "ipfs://meta2"
        );

        // Minter is out exactly mintPrice — overpayment refunded, no claimable rebate.
        assertEq(minter.balance, minterBefore - mintPrice);
        assertEq(router.claimable(minter), 0);
    }

    function test_mint_freeEntity_noPaymentRouted() public {
        uint256 treasuryBefore = treasury.balance;

        vm.prank(minter);
        uint256 tokenId = nft.mint(
            UNIVERSE_ID,
            EntityNFT.EntityKind.VEHICLE,
            "Free Entity",
            keccak256("content-3"),
            0,
            "ipfs://meta3"
        );

        assertEq(nft.ownerOf(tokenId), minter);
        assertEq(treasury.balance, treasuryBefore);
    }
}
