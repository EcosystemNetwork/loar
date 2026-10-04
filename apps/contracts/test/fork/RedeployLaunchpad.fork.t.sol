// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Test} from "forge-std/Test.sol";
import {LaunchpadDeployer} from "../../script/RedeployLaunchpad.s.sol";
import {UniverseManager} from "../../src/UniverseManager.sol";
import {IUniverseManager} from "../../src/interfaces/IUniverseManager.sol";
import {BondingCurve} from "../../src/BondingCurve.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "../../src/libraries/NodeOptions.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";

interface IWETH9 {
    function deposit() external payable;
}

interface ILoarSwapRouter {
    function swapExactInput(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 amountOutMinimum,
        uint256 deadline,
        bytes calldata hookData
    ) external payable returns (uint128);
}

/// Fork test: run the real redeploy against live Sepolia state as the owner,
/// launch a token, buy the curve out and prove it graduates.
///   SEPOLIA_FORK_RPC=https://ethereum-sepolia-rpc.publicnode.com \
///     forge test --match-path test/fork/RedeployLaunchpad.fork.t.sol -vv
contract RedeployLaunchpadForkTest is Test, LaunchpadDeployer {
    using PoolIdLibrary for PoolKey;

    address internal constant SWAP_ROUTER = 0x7E156f3Ddd56539aB941DeEfEd1342ae5C9C09a5;
    address internal constant OWNER = 0x116C28e6DCABCa363f83217C712d79DCE168d90e;
    address internal constant OLD_LOCKER = 0x7d30fd57e44aB0ca407D312976816E7052905E0A;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
    }

    function _config(address creator, address hook, address locker)
        internal
        pure
        returns (IUniverseManager.DeploymentConfig memory c)
    {
        address[] memory admins = new address[](1);
        admins[0] = creator;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;
        // Full range — the graduation position is two-sided (reserve + ETH).
        int24[] memory lower = new int24[](1);
        lower[0] = -887_200;
        int24[] memory upper = new int24[](1);
        upper[0] = 887_200;
        c.tokenConfig =
            IUniverseManager.TokenConfig(creator, "Fork Test", "FORKT", "ipfs://x", "", "");
        c.poolConfig = IUniverseManager.PoolConfig(
            // Opening price = curve's final price at 1 ETH graduation:
            // 1 ETH / (800M / 3 reserve) = 3.75e-9 WETH per token → tick ≈ -194025.
            hook,
            WETH,
            -194_000,
            200,
            abi.encode(uint24(3000), uint24(3000))
        );
        c.lockerConfig =
            IUniverseManager.LockerConfig(locker, admins, admins, bps, lower, upper, bps, "");
        c.allocationConfig = IUniverseManager.AllocationConfig(8000, 1000, 500, 500);
    }

    function _launch(address hook, address locker) internal returns (BondingCurve curve) {
        address creator = makeAddr("creator");
        UniverseManager um = UniverseManager(payable(UNIVERSE_MANAGER));
        uint256 fee = um.mintFee();
        vm.prank(creator);
        (uint256 id,,) = um.createUniverseWithToken{value: fee}(
            "Fork Test",
            "ipfs://x",
            "d",
            NodeCreationOptions(0),
            NodeVisibilityOptions(0),
            creator,
            _config(creator, hook, locker)
        );
        (,,,,, address bc) = um.getUniverseData(id);
        curve = BondingCurve(payable(bc));
    }

    function test_redeployedLaunchpadGraduatesAtOneEth() public {
        vm.startPrank(OWNER);
        Deployed memory d = _deployLaunchpad(OWNER, 1 ether);
        vm.stopPrank();

        BondingCurve curve = _launch(d.hook, d.locker);
        assertEq(curve.GRADUATION_ETH(), 1 ether, "graduation threshold");

        uint256 maxBuy = curve.MAX_BUY_AMOUNT();
        for (uint256 i; i < 400 && !curve.graduated(); i++) {
            address buyer = address(uint160(0xB0000 + i));
            uint256 amt = 0.05 ether;
            while (curve.getTokensForEth(amt) > maxBuy) amt = (amt * 3) / 4;
            vm.deal(buyer, amt);
            vm.prank(buyer);
            curve.buy{value: amt}(0, block.timestamp + 60);
        }
        assertTrue(curve.graduated(), "curve graduated into a v4 pool");
        assertLt(curve.TOTAL_CURVE_SUPPLY(), 800_000_000e18, "curve sells only part of LP alloc");

        // The graduated pool must actually trade: buy with WETH via the live router.
        UniverseManager um = UniverseManager(payable(UNIVERSE_MANAGER));
        uint256 id = curve.universeId();
        (, IERC20 token,, IHooks hook,,) = um.getUniverseData(id);
        bool token0IsLoar = address(token) < WETH;
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0IsLoar ? address(token) : WETH),
            currency1: Currency.wrap(token0IsLoar ? WETH : address(token)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 200,
            hooks: hook
        });
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(POOL_MANAGER), key.toId());
        assertGt(sqrtPriceX96, 0, "pool initialized");
        assertGt(
            StateLibrary.getLiquidity(IPoolManager(POOL_MANAGER), key.toId()),
            0,
            "pool has liquidity"
        );

        address trader = makeAddr("trader");
        vm.deal(trader, 0.01 ether);
        vm.startPrank(trader);
        IWETH9(WETH).deposit{value: 0.01 ether}();
        IERC20(WETH).approve(SWAP_ROUTER, 0.01 ether);
        uint256 before = token.balanceOf(trader);
        ILoarSwapRouter(SWAP_ROUTER)
            .swapExactInput(key, !token0IsLoar, uint128(0.01 ether), 0, block.timestamp + 60, "");
        vm.stopPrank();
        assertGt(token.balanceOf(trader), before, "post-graduation buy received tokens");
    }

    function test_oldHookCannotLaunchAfterRedeploy() public {
        vm.startPrank(OWNER);
        _deployLaunchpad(OWNER, 1 ether);
        vm.stopPrank();
        vm.expectRevert(IUniverseManager.HookNotEnabled.selector);
        this.launchExternal(OLD_HOOK, OLD_LOCKER);
    }

    function launchExternal(address hook, address locker) external {
        _launch(hook, locker);
    }
}
