/// Payment Router — Route SUI payments with platform fee splits.
/// SUI equivalent of PaymentRouter.sol + SplitRouter.sol.
///
/// Supports single and multi-recipient payments with dust-safe splits.
module loar::payment_router {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::object::{Self, UID};
    use sui::event;

    // ── Objects ───────────────────────────────────────────────

    public struct RouterConfig has key {
        id: UID,
        admin: address,
        treasury: address,
        platform_fee_bps: u64,
        total_routed: u64,
        total_fees: u64,
    }

    // ── Events ────────────────────────────────────────────────

    public struct PaymentRouted has copy, drop {
        payer: address,
        recipient: address,
        total: u64,
        fee: u64,
    }

    public struct SplitPaymentRouted has copy, drop {
        payer: address,
        total: u64,
        fee: u64,
        recipient_count: u64,
    }

    // ── Constants & Errors ────────────────────────────────────
    const BPS_DENOMINATOR: u64 = 10_000;
    const MAX_FEE_BPS: u64 = 5_000;   // 50% max
    const MAX_RECIPIENTS: u64 = 10;

    const ENotAdmin: u64 = 0;
    const EFeeTooHigh: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const ETooManyRecipients: u64 = 3;
    const ESharesMustSum10000: u64 = 4;
    const EMismatchedArrays: u64 = 5;

    // ── Init ──────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let config = RouterConfig {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            treasury: tx_context::sender(ctx),
            platform_fee_bps: 500, // 5% default
            total_routed: 0,
            total_fees: 0,
        };
        transfer::share_object(config);
    }

    // ── Route Payment (single recipient) ─────────────────────

    public entry fun route_payment(
        config: &mut RouterConfig,
        payment: &mut Coin<SUI>,
        amount: u64,
        recipient: address,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(payment) >= amount, EInsufficientBalance);

        let fee = (amount * config.platform_fee_bps) / BPS_DENOMINATOR;
        let creator_amount = amount - fee;

        // Fee to treasury
        if (fee > 0) {
            let fee_coin = coin::split(payment, fee, ctx);
            transfer::public_transfer(fee_coin, config.treasury);
        };

        // Remainder to creator
        if (creator_amount > 0) {
            let creator_coin = coin::split(payment, creator_amount, ctx);
            transfer::public_transfer(creator_coin, recipient);
        };

        config.total_routed = config.total_routed + amount;
        config.total_fees = config.total_fees + fee;

        event::emit(PaymentRouted {
            payer: tx_context::sender(ctx),
            recipient,
            total: amount,
            fee,
        });
    }

    // ── Route Split Payment (2 recipients) ───────────────────
    // SUI Move doesn't support dynamic vectors in entry functions the same way,
    // so we provide explicit 2/3/4 recipient variants for common cases.

    /// Split payment to 2 recipients. Last gets remainder (dust-safe).
    public entry fun route_split_2(
        config: &mut RouterConfig,
        payment: &mut Coin<SUI>,
        amount: u64,
        recipient_1: address,
        share_bps_1: u64,
        recipient_2: address,
        share_bps_2: u64,
        ctx: &mut TxContext,
    ) {
        assert!(share_bps_1 + share_bps_2 == 10_000, ESharesMustSum10000);
        assert!(coin::value(payment) >= amount, EInsufficientBalance);

        let fee = (amount * config.platform_fee_bps) / BPS_DENOMINATOR;
        let distributable = amount - fee;

        if (fee > 0) {
            let fee_coin = coin::split(payment, fee, ctx);
            transfer::public_transfer(fee_coin, config.treasury);
        };

        let share_1 = (distributable * share_bps_1) / BPS_DENOMINATOR;
        let share_2 = distributable - share_1; // remainder to last

        if (share_1 > 0) {
            let coin_1 = coin::split(payment, share_1, ctx);
            transfer::public_transfer(coin_1, recipient_1);
        };
        if (share_2 > 0) {
            let coin_2 = coin::split(payment, share_2, ctx);
            transfer::public_transfer(coin_2, recipient_2);
        };

        config.total_routed = config.total_routed + amount;
        config.total_fees = config.total_fees + fee;

        event::emit(SplitPaymentRouted {
            payer: tx_context::sender(ctx),
            total: amount,
            fee,
            recipient_count: 2,
        });
    }

    /// Split payment to 3 recipients. Last gets remainder (dust-safe).
    public entry fun route_split_3(
        config: &mut RouterConfig,
        payment: &mut Coin<SUI>,
        amount: u64,
        r1: address, s1: u64,
        r2: address, s2: u64,
        r3: address, s3: u64,
        ctx: &mut TxContext,
    ) {
        assert!(s1 + s2 + s3 == 10_000, ESharesMustSum10000);
        assert!(coin::value(payment) >= amount, EInsufficientBalance);

        let fee = (amount * config.platform_fee_bps) / BPS_DENOMINATOR;
        let distributable = amount - fee;

        if (fee > 0) {
            let fee_coin = coin::split(payment, fee, ctx);
            transfer::public_transfer(fee_coin, config.treasury);
        };

        let a1 = (distributable * s1) / BPS_DENOMINATOR;
        let a2 = (distributable * s2) / BPS_DENOMINATOR;
        let a3 = distributable - a1 - a2; // remainder

        if (a1 > 0) { transfer::public_transfer(coin::split(payment, a1, ctx), r1); };
        if (a2 > 0) { transfer::public_transfer(coin::split(payment, a2, ctx), r2); };
        if (a3 > 0) { transfer::public_transfer(coin::split(payment, a3, ctx), r3); };

        config.total_routed = config.total_routed + amount;
        config.total_fees = config.total_fees + fee;

        event::emit(SplitPaymentRouted {
            payer: tx_context::sender(ctx),
            total: amount,
            fee,
            recipient_count: 3,
        });
    }

    // ── Admin ─────────────────────────────────────────────────

    public entry fun set_platform_fee(
        config: &mut RouterConfig,
        new_fee_bps: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        assert!(new_fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
        config.platform_fee_bps = new_fee_bps;
    }

    public entry fun set_treasury(
        config: &mut RouterConfig,
        new_treasury: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        config.treasury = new_treasury;
    }

    // ── View functions ───────────────────────────────────────
    public fun get_platform_fee_bps(config: &RouterConfig): u64 { config.platform_fee_bps }
    public fun get_total_routed(config: &RouterConfig): u64 { config.total_routed }
    public fun get_total_fees(config: &RouterConfig): u64 { config.total_fees }

    // ── Test helpers ─────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}

#[test_only]
module loar::payment_router_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use loar::payment_router::{Self, RouterConfig};

    const ADMIN: address = @0x1;
    const PAYER: address = @0x2;
    const CREATOR_ADDR: address = @0x3;
    const RECIPIENT_A: address = @0x4;
    const RECIPIENT_B: address = @0x5;
    const OTHER: address = @0x6;

    fun setup(scenario: &mut Scenario) {
        ts::next_tx(scenario, ADMIN);
        payment_router::init_for_testing(ts::ctx(scenario));
    }

    #[test]
    fun test_init() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<RouterConfig>(&scenario);
            assert!(payment_router::get_platform_fee_bps(&config) == 500, 0);
            assert!(payment_router::get_total_routed(&config) == 0, 1);
            assert!(payment_router::get_total_fees(&config) == 0, 2);
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_route_payment() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Route 10000 SUI: fee = 10000 * 500 / 10000 = 500, creator = 9500
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut config = ts::take_shared<RouterConfig>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(10_000, ts::ctx(&mut scenario));

            payment_router::route_payment(
                &mut config,
                &mut payment,
                10_000,
                CREATOR_ADDR,
                ts::ctx(&mut scenario),
            );

            assert!(payment_router::get_total_routed(&config) == 10_000, 0);
            assert!(payment_router::get_total_fees(&config) == 500, 1);
            assert!(coin::value(&payment) == 0, 2);

            ts::return_shared(config);
            coin::burn_for_testing(payment);
        };

        // Verify creator received 9500
        ts::next_tx(&mut scenario, CREATOR_ADDR);
        {
            let received = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&received) == 9_500, 3);
            ts::return_to_sender(&scenario, received);
        };

        // Verify treasury (ADMIN) received 500 fee
        ts::next_tx(&mut scenario, ADMIN);
        {
            let fee_coin = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&fee_coin) == 500, 4);
            ts::return_to_sender(&scenario, fee_coin);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_route_split_2() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Split 10000 SUI: fee=500, distributable=9500
        // Recipient A: 60% of 9500 = 5700, Recipient B: remainder = 3800
        ts::next_tx(&mut scenario, PAYER);
        {
            let mut config = ts::take_shared<RouterConfig>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(10_000, ts::ctx(&mut scenario));

            payment_router::route_split_2(
                &mut config,
                &mut payment,
                10_000,
                RECIPIENT_A,
                6_000, // 60%
                RECIPIENT_B,
                4_000, // 40%
                ts::ctx(&mut scenario),
            );

            assert!(payment_router::get_total_routed(&config) == 10_000, 0);
            assert!(payment_router::get_total_fees(&config) == 500, 1);

            ts::return_shared(config);
            coin::burn_for_testing(payment);
        };

        // Verify recipient A: (9500 * 6000) / 10000 = 5700
        ts::next_tx(&mut scenario, RECIPIENT_A);
        {
            let received = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&received) == 5_700, 2);
            ts::return_to_sender(&scenario, received);
        };

        // Verify recipient B: 9500 - 5700 = 3800 (remainder, dust-safe)
        ts::next_tx(&mut scenario, RECIPIENT_B);
        {
            let received = ts::take_from_sender<Coin<SUI>>(&scenario);
            assert!(coin::value(&received) == 3_800, 3);
            ts::return_to_sender(&scenario, received);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::payment_router::EFeeTooHigh)]
    fun test_fee_too_high() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Setting fee > 5000 aborts
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<RouterConfig>(&scenario);
            payment_router::set_platform_fee(&mut config, 5_001, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::payment_router::ENotAdmin)]
    fun test_set_platform_fee_non_admin_aborts() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Non-admin tries to set fee -> aborts
        ts::next_tx(&mut scenario, OTHER);
        {
            let mut config = ts::take_shared<RouterConfig>(&scenario);
            payment_router::set_platform_fee(&mut config, 100, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        ts::end(scenario);
    }
}
