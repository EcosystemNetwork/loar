/// $LOAR Token — SUI native coin with managed treasury and transfer fee tracking.
///
/// SUI doesn't support native transfer fees at the coin level (unlike SPL Token 2022),
/// so we implement a custom transfer function that skims 0.05% to the LP.
/// Direct `coin::transfer` bypasses the fee — the frontend/SDK must use our
/// `transfer_with_fee` entry function for all user-facing transfers.
///
/// For NTT (Wormhole): the TreasuryCap is held by the NTT Manager object.
/// NTT mints on arrival, burns on departure.
module loar::loar_token {
    use sui::coin::{Self, Coin, TreasuryCap, CoinMetadata};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID, ID};
    use sui::balance::{Self, Balance};
    use sui::event;

    // ── OTW (One-Time Witness) ────────────────────────────────
    public struct LOAR_TOKEN has drop {}

    // ── Config object (shared) ────────────────────────────────
    public struct LoarConfig has key {
        id: UID,
        admin: address,
        treasury_address: address,
        liquidity_pool: address,
        transfer_fee_bps: u64,
        total_fees_collected: u64,
    }

    // ── Events ────────────────────────────────────────────────
    public struct FeeCollected has copy, drop {
        from: address,
        to: address,
        amount: u64,
        fee: u64,
    }

    public struct ConfigUpdated has copy, drop {
        field: vector<u8>,
        old_value: address,
        new_value: address,
    }

    // ── Constants ─────────────────────────────────────────────
    const BPS_DENOMINATOR: u64 = 10_000;
    const MAX_FEE_BPS: u64 = 500; // 5% hard cap
    const DECIMALS: u8 = 9;

    // ── Errors ────────────────────────────────────────────────
    const ENotAdmin: u64 = 0;
    const EFeeTooHigh: u64 = 1;
    const EZeroAddress: u64 = 2;
    const EInsufficientBalance: u64 = 3;

    // ── Init (called once at publish) ─────────────────────────
    fun init(witness: LOAR_TOKEN, ctx: &mut TxContext) {
        let (treasury_cap, metadata) = coin::create_currency(
            witness,
            DECIMALS,
            b"LOAR",
            b"LOAR",
            b"Decentralized Narrative Control — AI video generation + blockchain governance",
            option::none(),
            ctx,
        );

        // Share metadata publicly
        transfer::public_freeze_object(metadata);

        // Transfer treasury cap to deployer (will be transferred to NTT Manager later)
        transfer::public_transfer(treasury_cap, tx_context::sender(ctx));

        // Create and share config
        let config = LoarConfig {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            treasury_address: tx_context::sender(ctx),
            liquidity_pool: @0x0, // set after LP creation
            transfer_fee_bps: 5,  // 0.05%
            total_fees_collected: 0,
        };
        transfer::share_object(config);
    }

    // ── Transfer with fee ─────────────────────────────────────

    /// Transfer LOAR with 0.05% auto-liquidity fee.
    /// The fee portion is sent to the liquidity pool address.
    /// If no LP is set, the full amount goes to the recipient (no fee).
    public entry fun transfer_with_fee(
        config: &mut LoarConfig,
        coin: &mut Coin<LOAR_TOKEN>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(coin) >= amount, EInsufficientBalance);
        assert!(recipient != @0x0, EZeroAddress);

        if (config.liquidity_pool != @0x0 && config.transfer_fee_bps > 0) {
            let fee = (amount * config.transfer_fee_bps) / BPS_DENOMINATOR;
            let send_amount = amount - fee;

            // Split fee and send to LP
            if (fee > 0) {
                let fee_coin = coin::split(coin, fee, ctx);
                transfer::public_transfer(fee_coin, config.liquidity_pool);
                config.total_fees_collected = config.total_fees_collected + fee;

                event::emit(FeeCollected {
                    from: tx_context::sender(ctx),
                    to: recipient,
                    amount,
                    fee,
                });
            };

            // Send remainder to recipient
            let send_coin = coin::split(coin, send_amount, ctx);
            transfer::public_transfer(send_coin, recipient);
        } else {
            // No fee — direct transfer
            let send_coin = coin::split(coin, amount, ctx);
            transfer::public_transfer(send_coin, recipient);
        }
    }

    // ── Admin functions ───────────────────────────────────────

    public entry fun set_liquidity_pool(
        config: &mut LoarConfig,
        new_pool: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        let old = config.liquidity_pool;
        config.liquidity_pool = new_pool;
        event::emit(ConfigUpdated {
            field: b"liquidity_pool",
            old_value: old,
            new_value: new_pool,
        });
    }

    public entry fun set_transfer_fee_bps(
        config: &mut LoarConfig,
        new_fee_bps: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        assert!(new_fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
        config.transfer_fee_bps = new_fee_bps;
        event::emit(ConfigUpdated {
            field: b"transfer_fee_bps",
            old_value: @0x0,
            new_value: @0x0,
        });
    }

    public entry fun set_admin(
        config: &mut LoarConfig,
        new_admin: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        assert!(new_admin != @0x0, EZeroAddress);
        let old = config.admin;
        config.admin = new_admin;
        event::emit(ConfigUpdated {
            field: b"admin",
            old_value: old,
            new_value: new_admin,
        });
    }

    public entry fun set_treasury(
        config: &mut LoarConfig,
        new_treasury: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        let old = config.treasury_address;
        config.treasury_address = new_treasury;
        event::emit(ConfigUpdated {
            field: b"treasury",
            old_value: old,
            new_value: new_treasury,
        });
    }

    // ── View functions ────────────────────────────────────────

    public fun get_fee_bps(config: &LoarConfig): u64 {
        config.transfer_fee_bps
    }

    public fun get_total_fees(config: &LoarConfig): u64 {
        config.total_fees_collected
    }

    public fun get_liquidity_pool(config: &LoarConfig): address {
        config.liquidity_pool
    }

    // ── Test helpers ─────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(LOAR_TOKEN {}, ctx);
    }
}

#[test_only]
module loar::loar_token_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin::{Self, Coin, TreasuryCap};
    use sui::sui::SUI;
    use loar::loar_token::{Self, LOAR_TOKEN, LoarConfig};

    const ADMIN: address = @0x1;
    const USER: address = @0x2;
    const RECIPIENT: address = @0x3;
    const LP_ADDR: address = @0x4;

    fun setup(scenario: &mut Scenario) {
        ts::next_tx(scenario, ADMIN);
        loar_token::init_for_testing(ts::ctx(scenario));
    }

    #[test]
    fun test_init() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Config should be shared with correct defaults
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<LoarConfig>(&scenario);
            assert!(loar_token::get_fee_bps(&config) == 5, 0);
            assert!(loar_token::get_total_fees(&config) == 0, 1);
            assert!(loar_token::get_liquidity_pool(&config) == @0x0, 2);
            ts::return_shared(config);
        };

        // TreasuryCap should be transferred to admin
        ts::next_tx(&mut scenario, ADMIN);
        {
            let cap = ts::take_from_sender<TreasuryCap<LOAR_TOKEN>>(&scenario);
            ts::return_to_sender(&scenario, cap);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_transfer_with_fee() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Set LP address
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            loar_token::set_liquidity_pool(&mut config, LP_ADDR, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        // Mint LOAR to user
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut cap = ts::take_from_sender<TreasuryCap<LOAR_TOKEN>>(&scenario);
            let minted = coin::mint(&mut cap, 10_000, ts::ctx(&mut scenario));
            sui::transfer::public_transfer(minted, USER);
            ts::return_to_sender(&scenario, cap);
        };

        // Transfer 10000 LOAR with fee (5 bps = 0.05%)
        // fee = 10000 * 5 / 10000 = 5
        // recipient gets 10000 - 5 = 9995
        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            let mut user_coin = ts::take_from_sender<Coin<LOAR_TOKEN>>(&scenario);

            loar_token::transfer_with_fee(
                &mut config,
                &mut user_coin,
                10_000,
                RECIPIENT,
                ts::ctx(&mut scenario),
            );

            assert!(loar_token::get_total_fees(&config) == 5, 0);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, user_coin);
        };

        // Verify recipient received 9995
        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let received = ts::take_from_sender<Coin<LOAR_TOKEN>>(&scenario);
            assert!(coin::value(&received) == 9_995, 1);
            ts::return_to_sender(&scenario, received);
        };

        // Verify LP received fee of 5
        ts::next_tx(&mut scenario, LP_ADDR);
        {
            let lp_coin = ts::take_from_sender<Coin<LOAR_TOKEN>>(&scenario);
            assert!(coin::value(&lp_coin) == 5, 2);
            ts::return_to_sender(&scenario, lp_coin);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_set_fee_admin_only() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Admin can set fee
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            loar_token::set_transfer_fee_bps(&mut config, 100, ts::ctx(&scenario));
            assert!(loar_token::get_fee_bps(&config) == 100, 0);
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::loar_token::ENotAdmin)]
    fun test_set_fee_non_admin_aborts() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Non-admin tries to set fee -> aborts
        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            loar_token::set_transfer_fee_bps(&mut config, 100, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::loar_token::EFeeTooHigh)]
    fun test_fee_too_high() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Setting fee > 500 aborts
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            loar_token::set_transfer_fee_bps(&mut config, 501, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_no_fee_without_lp() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Mint LOAR to user (LP is @0x0 by default)
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut cap = ts::take_from_sender<TreasuryCap<LOAR_TOKEN>>(&scenario);
            let minted = coin::mint(&mut cap, 10_000, ts::ctx(&mut scenario));
            sui::transfer::public_transfer(minted, USER);
            ts::return_to_sender(&scenario, cap);
        };

        // Transfer without LP set — full amount goes to recipient, no fee
        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<LoarConfig>(&scenario);
            let mut user_coin = ts::take_from_sender<Coin<LOAR_TOKEN>>(&scenario);

            loar_token::transfer_with_fee(
                &mut config,
                &mut user_coin,
                10_000,
                RECIPIENT,
                ts::ctx(&mut scenario),
            );

            assert!(loar_token::get_total_fees(&config) == 0, 0);
            ts::return_shared(config);
            ts::return_to_sender(&scenario, user_coin);
        };

        // Recipient gets full 10000
        ts::next_tx(&mut scenario, RECIPIENT);
        {
            let received = ts::take_from_sender<Coin<LOAR_TOKEN>>(&scenario);
            assert!(coin::value(&received) == 10_000, 1);
            ts::return_to_sender(&scenario, received);
        };

        ts::end(scenario);
    }
}
