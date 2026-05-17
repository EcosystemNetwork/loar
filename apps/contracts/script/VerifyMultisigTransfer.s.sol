// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/governance/TimelockController.sol";
import {OwnableUpgradeable} from "@openzeppelin-upgradeable/access/OwnableUpgradeable.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {UpgradeableBeacon} from "@openzeppelin/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title VerifyMultisigTransfer
 * @notice Read-only companion to TransferToMultisig. Reads `owner()` on every
 *         contract referenced by env and asserts it equals TIMELOCK_ADDRESS.
 *         Reverts if any contract is still owned by a non-timelock address.
 *
 * Use cases:
 *   - Post-transfer sanity check (required step in governance-transition.md).
 *   - Periodic drift detection — run in CI weekly to catch an accidental
 *     ownership change (e.g. someone executed `transferOwnership` via the
 *     timelock and pointed it somewhere it shouldn't be).
 *
 * Env vars: same target list as TransferToMultisig.s.sol. Only TIMELOCK_ADDRESS
 *          is strictly required; unset contract envs are skipped with a SKIP row.
 *
 * Run (no signer needed — pure reads):
 *   TIMELOCK_ADDRESS=0x... forge script script/VerifyMultisigTransfer.s.sol \
 *     --rpc-url base -vv
 */
contract VerifyMultisigTransferScript is Script {
    address internal expected;
    uint256 internal ok;
    uint256 internal mismatched;
    uint256 internal skipped;
    string[] internal failures;

    function run() public {
        expected = vm.envAddress("TIMELOCK_ADDRESS");
        require(expected != address(0), "TIMELOCK_ADDRESS must not be zero");

        console.log("=== Multisig Transfer Verification ===");
        console.log("Expected owner (Timelock):", expected);
        console.log("");

        // ── Verify TimelockController role shape too — belt + braces. ─
        address safe = vm.envOr("SAFE_ADDRESS", address(0));
        if (safe != address(0)) {
            TimelockController timelock = TimelockController(payable(expected));
            bool safeIsProposer = timelock.hasRole(timelock.PROPOSER_ROLE(), safe);
            bool safeIsExecutor = timelock.hasRole(timelock.EXECUTOR_ROLE(), safe);
            console.log("Safe:", safe);
            console.log("  Safe has PROPOSER_ROLE:", safeIsProposer ? "YES" : "NO");
            console.log("  Safe has EXECUTOR_ROLE:", safeIsExecutor ? "YES" : "NO");
            console.log("  Timelock min delay (s):", timelock.getMinDelay());
            console.log("");
            require(safeIsProposer, "Safe no longer has PROPOSER_ROLE");
            require(safeIsExecutor, "Safe no longer has EXECUTOR_ROLE");
        }

        // ── Core Ownable ────────────────────────────────────────────
        console.log("--- Core Ownable ---");
        _checkOwnable("UNIVERSE_MANAGER");
        _checkOwnable("LOAR_TOKEN_ADDRESS");
        _checkOwnable("IDENTITY_NFT_ADDRESS");
        _checkOwnable("FEE_LOCKER_ADDRESS");
        _checkOwnable("SPLIT_ROUTER_ADDRESS");
        _checkOwnable("REVENUE_MODULE_FACTORY");
        _checkOwnable("LOAR_FAUCET_ADDRESS");
        _checkOwnable("SLOP_MARKET_ADDRESS");

        // ── UUPS proxies ────────────────────────────────────────────
        console.log("");
        console.log("--- UUPS Proxies ---");
        _checkOwnableUpgradeable("PAYMENT_ROUTER_ADDRESS");
        _checkOwnableUpgradeable("RIGHTS_REGISTRY_ADDRESS");
        _checkOwnableUpgradeable("CANON_MARKETPLACE_ADDRESS");
        _checkOwnableUpgradeable("CREDIT_MANAGER_ADDRESS");
        _checkOwnableUpgradeable("AD_PLACEMENT_ADDRESS");
        _checkOwnableUpgradeable("SUBSCRIPTION_MANAGER_ADDRESS");
        _checkOwnableUpgradeable("LICENSING_REGISTRY_ADDRESS");
        _checkOwnableUpgradeable("COLLAB_MANAGER_ADDRESS");
        _checkOwnableUpgradeable("ANALYTICS_REGISTRY_ADDRESS");
        _checkOwnableUpgradeable("LAUNCHPAD_STAKING_ADDRESS");
        _checkOwnableUpgradeable("STORY_BOUNTIES_ADDRESS");
        _checkOwnableUpgradeable("TALENT_AGENT_REGISTRY_ADDRESS");
        _checkOwnableUpgradeable("ESCROW_ADDRESS");
        _checkOwnableUpgradeable("LOAR_BURNER_ADDRESS");
        _checkOwnableUpgradeable("REMIX_FEES_ADDRESS");
        _checkOwnableUpgradeable("CONTENT_LICENSING_ADDRESS");

        // ── NFT beacons ─────────────────────────────────────────────
        console.log("");
        console.log("--- NFT Beacons ---");
        _checkBeacon("EPISODE_EDITION_BEACON");
        _checkBeacon("CHARACTER_NFT_BEACON");
        _checkBeacon("ENTITY_NFT_BEACON");
        _checkBeacon("ENTITY_EDITION_BEACON");
        _checkBeacon("EPISODE_NFT_BEACON");

        // ── Summary ─────────────────────────────────────────────────
        console.log("");
        console.log("========================================");
        console.log("  OK:         ", ok);
        console.log("  MISMATCHED: ", mismatched);
        console.log("  SKIPPED:    ", skipped);
        console.log("========================================");

        if (mismatched > 0) {
            for (uint256 i = 0; i < failures.length; i++) {
                console.log("  !!", failures[i]);
            }
            revert("One or more contracts have drifted off the Timelock");
        }

        console.log("All configured contracts are owned by the Timelock.");
    }

    // ── Internal helpers ────────────────────────────────────────────

    function _checkOwnable(string memory envKey) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }
        address actual = Ownable(addr).owner();
        _recordCheck(envKey, addr, actual);
    }

    function _checkOwnableUpgradeable(string memory envKey) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }
        address actual = OwnableUpgradeable(addr).owner();
        _recordCheck(envKey, addr, actual);
    }

    function _checkBeacon(string memory envKey) internal {
        address addr = vm.envOr(envKey, address(0));
        if (addr == address(0)) {
            console.log(string.concat("  SKIP  ", envKey, " (env not set)"));
            skipped++;
            return;
        }
        address actual = UpgradeableBeacon(addr).owner();
        _recordCheck(envKey, addr, actual);
    }

    function _recordCheck(string memory envKey, address addr, address actual) internal {
        if (actual == expected) {
            console.log(string.concat("  OK    ", envKey));
            ok++;
            return;
        }
        console.log(string.concat("  FAIL  ", envKey));
        console.log("         addr:          ", addr);
        console.log("         actual owner:  ", actual);
        console.log("         expected owner:", expected);
        mismatched++;
        failures.push(envKey);
    }
}
