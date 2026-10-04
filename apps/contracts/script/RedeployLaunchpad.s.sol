// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {LoarHookStaticFee} from "../src/hooks/LoarHookStaticFee.sol";
import {LoarLpLockerMultiple} from "../src/lp-lockers/LoarLpLockerMultiple.sol";
import {LoarFeeLocker} from "../src/LoarFeeLocker.sol";
import {UniverseManager} from "../src/UniverseManager.sol";
import {UniverseTokenDeployerV3} from "../src/UniverseTokenDeployerV3.sol";
import {BondingCurveFactory} from "../src/factories/BondingCurveFactory.sol";
import {GovernanceTokenFactory} from "../src/factories/GovernanceTokenFactory.sol";
import {GovernorFactory} from "../src/factories/GovernorFactory.sol";
import {TimelockFactory} from "../src/factories/TimelockFactory.sol";

/// @notice Sepolia launchpad repair, against the LIVE UniverseManager.
///         The hook (0xF5b2…68CC) and LP locker (0x7d30…5E0A) in use were
///         built for the previous UniverseManager, so graduateFromBondingCurve
///         reverts OnlyFactory. This deploys a hook + locker bound to the
///         live manager, plus a UniverseTokenDeployerV3 with a configurable
///         graduation threshold, and wires everything up.
abstract contract LaunchpadDeployer {
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant UNIVERSE_MANAGER = 0x5441273a432821d20C949768d5940960dEaC6C35;
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant FEE_LOCKER = 0x965f5C192E38b86Fa4a79A561E695C48B1DC3582;
    address internal constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant OLD_HOOK = 0xF5b2676E0fbc7551ae3E38f25D87C941C5a968CC;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    struct Deployed {
        address hook;
        address locker;
        address tokenDeployer;
        address bondingCurveFactory;
        address tokenFactory;
        address governorFactory;
        address timelockFactory;
    }

    /// @dev Must run with msg.sender == owner of UniverseManager + FeeLocker.
    function _deployLaunchpad(address owner, uint256 graduationEth)
        internal
        returns (Deployed memory d)
    {
        // 1. Hook — address must encode the permission flags, so mine a salt
        //    and deploy through the canonical CREATE2 deployer explicitly
        //    (works identically in broadcasts and fork tests).
        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        bytes memory args = abi.encode(POOL_MANAGER, UNIVERSE_MANAGER, WETH);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(LoarHookStaticFee).creationCode, args);
        (bool ok,) = CREATE2_DEPLOYER.call(
            abi.encodePacked(salt, type(LoarHookStaticFee).creationCode, args)
        );
        require(ok && hookAddress.code.length > 0, "hook deploy failed");
        d.hook = hookAddress;

        // 2. LP locker bound to the live manager.
        d.locker = address(
            new LoarLpLockerMultiple(owner, UNIVERSE_MANAGER, FEE_LOCKER, POSITION_MANAGER, PERMIT2)
        );

        // 3. Token deployer V3 + its factories, graduation threshold set.
        d.bondingCurveFactory = address(new BondingCurveFactory());
        d.tokenFactory = address(new GovernanceTokenFactory());
        d.governorFactory = address(new GovernorFactory());
        UniverseTokenDeployerV3 utd = new UniverseTokenDeployerV3(
            UNIVERSE_MANAGER, d.tokenFactory, d.governorFactory, d.bondingCurveFactory
        );
        d.tokenDeployer = address(utd);
        utd.setGraduationEth(graduationEth);

        // Per-universe timelocks (TIMELOCK-01).
        TimelockFactory tf = new TimelockFactory(owner);
        tf.setAuthorizedCaller(address(utd), true);
        utd.setTimelockFactory(address(tf));
        d.timelockFactory = address(tf);

        // 4. Wire into the live manager + fee locker.
        UniverseManager um = UniverseManager(payable(UNIVERSE_MANAGER));
        um.setHook(d.hook, true);
        um.setLocker(d.locker, d.hook, true);
        LoarFeeLocker(FEE_LOCKER).addDepositor(d.locker);
        um.setTokenDeployer(d.tokenDeployer);

        // 5. Stop new launches on the broken hook (its tokens can't graduate).
        um.setHook(OLD_HOOK, false);
    }
}

/// Run (owner key = UniverseManager/FeeLocker owner 0x116C…d90e):
///   cd apps/contracts
///   PRIVATE_KEY=0x… forge script script/RedeployLaunchpad.s.sol \
///     --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
/// Optional: GRADUATION_ETH (wei, default 1 ether).
contract RedeployLaunchpad is Script, LaunchpadDeployer {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 graduationEth = vm.envOr("GRADUATION_ETH", uint256(1 ether));
        require(block.chainid == 11155111, "Sepolia only");

        vm.startBroadcast(pk);
        Deployed memory d = _deployLaunchpad(vm.addr(pk), graduationEth);
        vm.stopBroadcast();

        console.log("LoarHookStaticFee:       ", d.hook);
        console.log("LoarLpLockerMultiple:    ", d.locker);
        console.log("UniverseTokenDeployerV3: ", d.tokenDeployer);
        console.log("BondingCurveFactory:     ", d.bondingCurveFactory);
        console.log("GovernanceTokenFactory:  ", d.tokenFactory);
        console.log("GovernorFactory:         ", d.governorFactory);
        console.log("TimelockFactory:         ", d.timelockFactory);
        console.log("Graduation ETH (wei):    ", graduationEth);
    }
}
