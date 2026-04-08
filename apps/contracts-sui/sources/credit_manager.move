/// Credit Manager — AI generation credits with dual pricing (SUI + $LOAR).
/// SUI equivalent of CreditManager.sol.
///
/// Uses a separate backend_signer for deductions (principle of least privilege).
module loar::credit_manager {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use loar::loar_token::LOAR_TOKEN;

    // ── Objects ───────────────────────────────────────────────

    public struct CreditConfig has key {
        id: UID,
        admin: address,
        backend_signer: address,
        treasury: address,
        sol_margin_bps: u64,
        loar_margin_bps: u64,
        loar_bonus_bps: u64,
        total_credits_sold: u64,
        total_sui_revenue: u64,
        total_loar_revenue: u64,
    }

    public struct CreditBalance has key {
        id: UID,
        owner: address,
        credits: u64,
        total_purchased: u64,
        total_used: u64,
    }

    // ── Events ────────────────────────────────────────────────

    public struct CreditsPurchased has copy, drop {
        buyer: address,
        credits: u64,
        payment_method: u8, // 0 = SUI, 1 = LOAR
        amount_paid: u64,
    }

    public struct CreditsDeducted has copy, drop {
        user: address,
        amount: u64,
        remaining: u64,
    }

    // ── Constants ────────────────────────────────────────────
    const MAX_MARGIN_BPS: u64 = 5_000;  // 50% max
    const MAX_BONUS_BPS: u64 = 2_000;   // 20% max

    // ── Errors ────────────────────────────────────────────────
    const ENotAdmin: u64 = 0;
    const EInsufficientCredits: u64 = 1;
    const EInsufficientBalance: u64 = 2;
    const EInvalidTier: u64 = 3;
    const ENotAuthorized: u64 = 4;
    const EMarginTooHigh: u64 = 5;
    const EBonusTooHigh: u64 = 6;

    // ── Credit tiers ─────────────────────────────────────────

    fun get_tier_credits(tier: u8): u64 {
        if (tier == 0) { 100 }
        else if (tier == 1) { 500 }
        else if (tier == 2) { 1_500 }
        else if (tier == 3) { 5_000 }
        else if (tier == 4) { 20_000 }
        else { abort EInvalidTier }
    }

    fun get_tier_sui_price(tier: u8): u64 {
        if (tier == 0) { 540_000 }
        else if (tier == 1) { 2_500_000 }
        else if (tier == 2) { 6_750_000 }
        else if (tier == 3) { 20_000_000 }
        else if (tier == 4) { 72_000_000 }
        else { abort EInvalidTier }
    }

    fun get_tier_loar_price(tier: u8): u64 {
        if (tier == 0) { 125_000_000_000 }
        else if (tier == 1) { 575_000_000_000 }
        else if (tier == 2) { 1_550_000_000_000 }
        else if (tier == 3) { 4_600_000_000_000 }
        else if (tier == 4) { 16_500_000_000_000 }
        else { abort EInvalidTier }
    }

    // ── Init ──────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let config = CreditConfig {
            id: object::new(ctx),
            admin: sender,
            backend_signer: sender, // defaults to admin, should be changed
            treasury: sender,
            sol_margin_bps: 3_500,   // 35%
            loar_margin_bps: 2_500,  // 25%
            loar_bonus_bps: 1_000,   // 10%
            total_credits_sold: 0,
            total_sui_revenue: 0,
            total_loar_revenue: 0,
        };
        transfer::share_object(config);
    }

    // ── Purchase with SUI ─────────────────────────────────────

    public entry fun purchase_credits_sui(
        config: &mut CreditConfig,
        balance: &mut CreditBalance,
        payment: &mut Coin<SUI>,
        tier: u8,
        ctx: &mut TxContext,
    ) {
        let credits = get_tier_credits(tier);
        let price = get_tier_sui_price(tier);
        assert!(coin::value(payment) >= price, EInsufficientBalance);

        let pay_coin = coin::split(payment, price, ctx);
        transfer::public_transfer(pay_coin, config.treasury);

        balance.credits = balance.credits + credits;
        balance.total_purchased = balance.total_purchased + credits;
        config.total_credits_sold = config.total_credits_sold + credits;
        config.total_sui_revenue = config.total_sui_revenue + price;

        event::emit(CreditsPurchased {
            buyer: tx_context::sender(ctx),
            credits,
            payment_method: 0,
            amount_paid: price,
        });
    }

    // ── Purchase with LOAR (25% margin + 10% bonus) ──────────

    public entry fun purchase_credits_loar(
        config: &mut CreditConfig,
        balance: &mut CreditBalance,
        payment: &mut Coin<LOAR_TOKEN>,
        tier: u8,
        ctx: &mut TxContext,
    ) {
        let base_credits = get_tier_credits(tier);
        let price = get_tier_loar_price(tier);
        assert!(coin::value(payment) >= price, EInsufficientBalance);

        let pay_coin = coin::split(payment, price, ctx);
        transfer::public_transfer(pay_coin, config.treasury);

        // 10% bonus for paying with LOAR
        let bonus = base_credits * config.loar_bonus_bps / 10_000;
        let total_credits = base_credits + bonus;

        balance.credits = balance.credits + total_credits;
        balance.total_purchased = balance.total_purchased + total_credits;
        config.total_credits_sold = config.total_credits_sold + total_credits;
        config.total_loar_revenue = config.total_loar_revenue + price;

        event::emit(CreditsPurchased {
            buyer: tx_context::sender(ctx),
            credits: total_credits,
            payment_method: 1,
            amount_paid: price,
        });
    }

    // ── Deduct (admin or backend_signer) ─────────────────────

    public entry fun deduct_credits(
        config: &CreditConfig,
        balance: &mut CreditBalance,
        amount: u64,
        ctx: &TxContext,
    ) {
        let sender = tx_context::sender(ctx);
        assert!(
            sender == config.admin || sender == config.backend_signer,
            ENotAuthorized,
        );
        assert!(balance.credits >= amount, EInsufficientCredits);

        balance.credits = balance.credits - amount;
        balance.total_used = balance.total_used + amount;

        event::emit(CreditsDeducted {
            user: balance.owner,
            amount,
            remaining: balance.credits,
        });
    }

    // ── Create balance (new user) ─────────────────────────────

    public entry fun create_balance(ctx: &mut TxContext) {
        let balance = CreditBalance {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            credits: 0,
            total_purchased: 0,
            total_used: 0,
        };
        transfer::transfer(balance, tx_context::sender(ctx));
    }

    // ── Admin config ──────────────────────────────────────────

    public entry fun set_backend_signer(
        config: &mut CreditConfig,
        new_signer: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        config.backend_signer = new_signer;
    }

    public entry fun set_margins(
        config: &mut CreditConfig,
        sol_margin_bps: u64,
        loar_margin_bps: u64,
        loar_bonus_bps: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        assert!(sol_margin_bps <= MAX_MARGIN_BPS, EMarginTooHigh);
        assert!(loar_margin_bps <= MAX_MARGIN_BPS, EMarginTooHigh);
        assert!(loar_bonus_bps <= MAX_BONUS_BPS, EBonusTooHigh);

        config.sol_margin_bps = sol_margin_bps;
        config.loar_margin_bps = loar_margin_bps;
        config.loar_bonus_bps = loar_bonus_bps;
    }

    // ── View functions ───────────────────────────────────────
    public fun get_credits(balance: &CreditBalance): u64 { balance.credits }
    public fun get_total_purchased(balance: &CreditBalance): u64 { balance.total_purchased }
    public fun get_total_used(balance: &CreditBalance): u64 { balance.total_used }
    public fun get_total_credits_sold(config: &CreditConfig): u64 { config.total_credits_sold }
    public fun get_sol_margin_bps(config: &CreditConfig): u64 { config.sol_margin_bps }
    public fun get_loar_margin_bps(config: &CreditConfig): u64 { config.loar_margin_bps }
    public fun get_loar_bonus_bps(config: &CreditConfig): u64 { config.loar_bonus_bps }

    // ── Test helpers ─────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}

#[test_only]
module loar::credit_manager_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use loar::credit_manager::{Self, CreditConfig, CreditBalance};

    const ADMIN: address = @0x1;
    const USER: address = @0x2;
    const BACKEND: address = @0x3;
    const OTHER: address = @0x4;

    fun setup(scenario: &mut Scenario) {
        ts::next_tx(scenario, ADMIN);
        credit_manager::init_for_testing(ts::ctx(scenario));
    }

    #[test]
    fun test_init() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<CreditConfig>(&scenario);
            assert!(credit_manager::get_sol_margin_bps(&config) == 3_500, 0);
            assert!(credit_manager::get_loar_margin_bps(&config) == 2_500, 1);
            assert!(credit_manager::get_loar_bonus_bps(&config) == 1_000, 2);
            assert!(credit_manager::get_total_credits_sold(&config) == 0, 3);
            ts::return_shared(config);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_create_balance() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // User creates a credit balance
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        // Verify balance was created with 0 credits
        ts::next_tx(&mut scenario, USER);
        {
            let balance = ts::take_from_sender<CreditBalance>(&scenario);
            assert!(credit_manager::get_credits(&balance) == 0, 0);
            assert!(credit_manager::get_total_purchased(&balance) == 0, 1);
            assert!(credit_manager::get_total_used(&balance) == 0, 2);
            ts::return_to_sender(&scenario, balance);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_purchase_sui() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // User creates balance
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        // Purchase Starter tier (tier 0): 100 credits for 540_000 MIST
        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));

            credit_manager::purchase_credits_sui(
                &mut config,
                &mut balance,
                &mut payment,
                0, // Starter tier
                ts::ctx(&mut scenario),
            );

            assert!(credit_manager::get_credits(&balance) == 100, 0);
            assert!(credit_manager::get_total_purchased(&balance) == 100, 1);
            assert!(credit_manager::get_total_credits_sold(&config) == 100, 2);
            // Payment should have remainder: 1_000_000 - 540_000 = 460_000
            assert!(coin::value(&payment) == 460_000, 3);

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
            coin::burn_for_testing(payment);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_deduct_admin() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // User creates balance and purchases credits
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));

            credit_manager::purchase_credits_sui(
                &mut config,
                &mut balance,
                &mut payment,
                0, // 100 credits
                ts::ctx(&mut scenario),
            );

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
            coin::burn_for_testing(payment);
        };

        // Transfer balance to admin context for deduction
        ts::next_tx(&mut scenario, USER);
        {
            let balance = ts::take_from_sender<CreditBalance>(&scenario);
            sui::transfer::public_transfer(balance, ADMIN);
        };

        // Admin deducts 30 credits
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);

            credit_manager::deduct_credits(&config, &mut balance, 30, ts::ctx(&scenario));

            assert!(credit_manager::get_credits(&balance) == 70, 0);
            assert!(credit_manager::get_total_used(&balance) == 30, 1);

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_deduct_backend_signer() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Set backend signer
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);
            credit_manager::set_backend_signer(&mut config, BACKEND, ts::ctx(&scenario));
            ts::return_shared(config);
        };

        // User creates balance and purchases credits
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));

            credit_manager::purchase_credits_sui(
                &mut config,
                &mut balance,
                &mut payment,
                0,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
            coin::burn_for_testing(payment);
        };

        // Transfer balance to backend signer
        ts::next_tx(&mut scenario, USER);
        {
            let balance = ts::take_from_sender<CreditBalance>(&scenario);
            sui::transfer::public_transfer(balance, BACKEND);
        };

        // Backend signer deducts credits
        ts::next_tx(&mut scenario, BACKEND);
        {
            let config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);

            credit_manager::deduct_credits(&config, &mut balance, 25, ts::ctx(&scenario));

            assert!(credit_manager::get_credits(&balance) == 75, 0);

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::credit_manager::ENotAuthorized)]
    fun test_deduct_unauthorized() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // User creates balance and purchases credits
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, USER);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));

            credit_manager::purchase_credits_sui(
                &mut config,
                &mut balance,
                &mut payment,
                0,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
            coin::burn_for_testing(payment);
        };

        // Transfer balance to random OTHER
        ts::next_tx(&mut scenario, USER);
        {
            let balance = ts::take_from_sender<CreditBalance>(&scenario);
            sui::transfer::public_transfer(balance, OTHER);
        };

        // Random user tries to deduct -> aborts with ENotAuthorized
        ts::next_tx(&mut scenario, OTHER);
        {
            let config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);

            credit_manager::deduct_credits(&config, &mut balance, 10, ts::ctx(&scenario));

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::credit_manager::EInsufficientCredits)]
    fun test_deduct_insufficient() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // User creates balance (0 credits, no purchase)
        ts::next_tx(&mut scenario, USER);
        {
            credit_manager::create_balance(ts::ctx(&mut scenario));
        };

        // Transfer balance to admin for deduction
        ts::next_tx(&mut scenario, USER);
        {
            let balance = ts::take_from_sender<CreditBalance>(&scenario);
            sui::transfer::public_transfer(balance, ADMIN);
        };

        // Admin tries to deduct from empty balance -> aborts
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<CreditConfig>(&scenario);
            let mut balance = ts::take_from_sender<CreditBalance>(&scenario);

            credit_manager::deduct_credits(&config, &mut balance, 50, ts::ctx(&scenario));

            ts::return_shared(config);
            ts::return_to_sender(&scenario, balance);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_set_margins() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<CreditConfig>(&scenario);

            credit_manager::set_margins(
                &mut config,
                4_000,  // 40% sol margin
                3_000,  // 30% loar margin
                1_500,  // 15% loar bonus
                ts::ctx(&scenario),
            );

            assert!(credit_manager::get_sol_margin_bps(&config) == 4_000, 0);
            assert!(credit_manager::get_loar_margin_bps(&config) == 3_000, 1);
            assert!(credit_manager::get_loar_bonus_bps(&config) == 1_500, 2);

            ts::return_shared(config);
        };

        ts::end(scenario);
    }
}
