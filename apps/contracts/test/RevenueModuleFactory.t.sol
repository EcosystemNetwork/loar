// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RevenueModuleFactory} from "../src/RevenueModuleFactory.sol";
import {RightsRegistry} from "../src/RightsRegistry.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";
import {EpisodeEditionCollection} from "../src/revenue/EpisodeEditionCollection.sol";
import {CharacterNFT} from "../src/revenue/CharacterNFT.sol";
import {EntityNFT} from "../src/revenue/EntityNFT.sol";
import {EntityEditionNFT} from "../src/revenue/EntityEditionNFT.sol";

contract RevenueModuleFactoryTest is Test {
    RevenueModuleFactory factory;
    RightsRegistry registry;
    PaymentRouter router;

    address platform = address(0x1);
    address treasury = address(0x2);

    function setUp() public {
        registry = new RightsRegistry(platform);
        router = new PaymentRouter(treasury, 1000);

        factory = new RevenueModuleFactory(
            platform,
            address(registry),
            address(router),
            1000,  // episode platform fee 10%
            500,   // episode royalty 5%
            200,   // character appearance fee 2%
            1000,  // entity platform fee 10%
            500    // entity royalty 5%
        );
    }

    function test_deployModules() public {
        (address episodes, address characters, address entities, address entityEditions) =
            factory.deployModules(1);

        assertTrue(episodes != address(0));
        assertTrue(characters != address(0));
        assertTrue(entities != address(0));
        assertTrue(entityEditions != address(0));

        assertEq(factory.episodeCollection(1), episodes);
        assertEq(factory.characterCollection(1), characters);
        assertEq(factory.entityCollection(1), entities);
        assertEq(factory.entityEditionCollection(1), entityEditions);
    }

    function test_deployModules_revertsDouble() public {
        factory.deployModules(1);

        vm.expectRevert(RevenueModuleFactory.AlreadyDeployed.selector);
        factory.deployModules(1);
    }

    function test_deployModules_characterHasRightsRegistry() public {
        (,address characters,,) = factory.deployModules(1);
        CharacterNFT charNFT = CharacterNFT(characters);
        assertEq(address(charNFT.rightsRegistry()), address(registry));
    }

    function test_deployModules_characterHasPaymentRouter() public {
        (,address characters,,) = factory.deployModules(1);
        CharacterNFT charNFT = CharacterNFT(characters);
        assertEq(address(charNFT.paymentRouter()), address(router));
    }

    function test_deployModules_entityHasRightsRegistry() public {
        (,,address entities,) = factory.deployModules(1);
        EntityNFT entityNFT = EntityNFT(entities);
        assertEq(address(entityNFT.rightsRegistry()), address(registry));
    }

    function test_deployModules_entityEditionHasRightsRegistry() public {
        (,,,address entityEditions) = factory.deployModules(1);
        EntityEditionNFT eeNFT = EntityEditionNFT(entityEditions);
        assertEq(address(eeNFT.rightsRegistry()), address(registry));
    }

    // ── Fee Cap Tests ──

    function test_setEpisodeFees_revertsAboveMax() public {
        vm.expectRevert(RevenueModuleFactory.FeeTooHigh.selector);
        factory.setEpisodeFees(5001, 500);
    }

    function test_setCharacterAppearanceFee_revertsAboveMax() public {
        vm.expectRevert(RevenueModuleFactory.FeeTooHigh.selector);
        factory.setCharacterAppearanceFee(5001);
    }

    function test_setEntityFees_revertsAboveMax() public {
        vm.expectRevert(RevenueModuleFactory.FeeTooHigh.selector);
        factory.setEntityFees(5001, 500);
    }

    function test_setEpisodeFees_allowsMax() public {
        factory.setEpisodeFees(5000, 500);
        assertEq(factory.episodePlatformFeeBps(), 5000);
    }
}
