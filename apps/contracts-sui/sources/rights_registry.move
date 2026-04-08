/// Rights Registry — Content rights classification on SUI.
/// SUI equivalent of RightsRegistry.sol.
///
/// Rights types: 0=Fun, 1=Original, 2=Licensed, 3=PublicDomain
/// Monetizable: Original (1) and Licensed (2) only.
/// Once frozen, rights can never be changed.
/// Only admin or authorized operators can register/update/freeze.
module loar::rights_registry {
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::table::{Self, Table};

    // Rights types (no Frozen variant — use is_frozen bool instead)
    const RIGHTS_FUN: u8 = 0;
    const RIGHTS_ORIGINAL: u8 = 1;
    const RIGHTS_LICENSED: u8 = 2;
    const RIGHTS_PUBLIC_DOMAIN: u8 = 3;

    // ── Objects ───────────────────────────────────────────────

    public struct RegistryConfig has key {
        id: UID,
        admin: address,
        operators: Table<address, bool>,
        total_registered: u64,
    }

    public struct RightsRecord has key, store {
        id: UID,
        content_hash: vector<u8>,
        rights_type: u8,
        creator: address,
        is_frozen: bool,
        registered_at: u64,
        updated_at: u64,
    }

    // ── Events ────────────────────────────────────────────────

    public struct RightsRegistered has copy, drop {
        content_hash: vector<u8>,
        rights_type: u8,
        creator: address,
    }

    public struct RightsUpdated has copy, drop {
        content_hash: vector<u8>,
        old_rights: u8,
        new_rights: u8,
    }

    public struct RightsFrozenEvent has copy, drop {
        content_hash: vector<u8>,
        rights_type: u8,
    }

    // ── Errors ────────────────────────────────────────────────
    const ENotAdmin: u64 = 0;
    const ENotOperator: u64 = 1;
    const EContentFrozen: u64 = 2;
    const EInvalidRightsType: u64 = 3;
    const ENotAuthorized: u64 = 4;

    // ── Init ──────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let config = RegistryConfig {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            operators: table::new(ctx),
            total_registered: 0,
        };
        transfer::share_object(config);
    }

    // ── Helpers ───────────────────────────────────────────────

    /// Check if the sender is the admin or an authorized operator.
    fun is_authorized(config: &RegistryConfig, ctx: &TxContext): bool {
        let sender = tx_context::sender(ctx);
        if (sender == config.admin) {
            return true
        };
        if (table::contains(&config.operators, sender)) {
            return *table::borrow(&config.operators, sender)
        };
        false
    }

    /// Check if a rights type is monetizable (Original or Licensed).
    public fun is_monetizable(rights_type: u8): bool {
        rights_type == RIGHTS_ORIGINAL || rights_type == RIGHTS_LICENSED
    }

    // ── Register ──────────────────────────────────────────────

    /// Register content rights. Only admin or authorized operator.
    public entry fun register_rights(
        config: &mut RegistryConfig,
        content_hash: vector<u8>,
        rights_type: u8,
        creator: address,
        timestamp: u64,
        ctx: &mut TxContext,
    ) {
        // Authorization check
        assert!(is_authorized(config, ctx), ENotAuthorized);
        assert!(rights_type <= RIGHTS_PUBLIC_DOMAIN, EInvalidRightsType);

        let record = RightsRecord {
            id: object::new(ctx),
            content_hash,
            rights_type,
            creator,
            is_frozen: false,
            registered_at: timestamp,
            updated_at: timestamp,
        };

        config.total_registered = config.total_registered + 1;

        event::emit(RightsRegistered {
            content_hash,
            rights_type,
            creator,
        });

        transfer::public_transfer(record, creator);
    }

    // ── Update ────────────────────────────────────────────────

    /// Update content rights. Only admin or authorized operator.
    public entry fun update_rights(
        config: &RegistryConfig,
        record: &mut RightsRecord,
        new_rights_type: u8,
        timestamp: u64,
        ctx: &TxContext,
    ) {
        assert!(is_authorized(config, ctx), ENotAuthorized);
        assert!(!record.is_frozen, EContentFrozen);
        assert!(new_rights_type <= RIGHTS_PUBLIC_DOMAIN, EInvalidRightsType);

        let old = record.rights_type;
        record.rights_type = new_rights_type;
        record.updated_at = timestamp;

        event::emit(RightsUpdated {
            content_hash: record.content_hash,
            old_rights: old,
            new_rights: new_rights_type,
        });
    }

    // ── Freeze ────────────────────────────────────────────────

    /// Freeze content rights permanently. Only admin or authorized operator.
    public entry fun freeze_rights(
        config: &RegistryConfig,
        record: &mut RightsRecord,
        timestamp: u64,
        ctx: &TxContext,
    ) {
        assert!(is_authorized(config, ctx), ENotAuthorized);
        assert!(!record.is_frozen, EContentFrozen);
        record.is_frozen = true;
        record.updated_at = timestamp;

        event::emit(RightsFrozenEvent {
            content_hash: record.content_hash,
            rights_type: record.rights_type,
        });
    }

    // ── Operators ─────────────────────────────────────────────

    public entry fun add_operator(
        config: &mut RegistryConfig,
        operator: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        if (table::contains(&config.operators, operator)) {
            let val = table::borrow_mut(&mut config.operators, operator);
            *val = true;
        } else {
            table::add(&mut config.operators, operator, true);
        };
    }

    public entry fun remove_operator(
        config: &mut RegistryConfig,
        operator: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == config.admin, ENotAdmin);
        if (table::contains(&config.operators, operator)) {
            table::remove(&mut config.operators, operator);
        };
    }

    // ── View ──────────────────────────────────────────────────

    public fun get_rights_type(record: &RightsRecord): u8 {
        record.rights_type
    }

    public fun get_is_frozen(record: &RightsRecord): bool {
        record.is_frozen
    }

    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}

#[test_only]
module loar::rights_registry_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use loar::rights_registry;

    const ADMIN: address = @0x1;
    const OPERATOR: address = @0x2;
    const CREATOR: address = @0x3;
    const OUTSIDER: address = @0x99;

    #[test]
    fun test_init() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            // Config exists and is shared — init succeeded
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_register_as_admin() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::register_rights(
                &mut config,
                b"hash123",
                1, // Original
                CREATOR,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::rights_registry::ENotAuthorized)]
    fun test_register_unauthorized() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, OUTSIDER);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::register_rights(
                &mut config,
                b"hash123",
                1,
                CREATOR,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_update_rights() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::register_rights(
                &mut config,
                b"hash123",
                0, // Fun
                CREATOR,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(config);
        };
        // Record was transferred to CREATOR, update as admin
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            let mut record = ts::take_from_address<rights_registry::RightsRecord>(&scenario, CREATOR);
            rights_registry::update_rights(
                &config,
                &mut record,
                1, // Original
                2000,
                ts::ctx(&mut scenario),
            );
            assert!(rights_registry::get_rights_type(&record) == 1);
            ts::return_to_address(CREATOR, record);
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::rights_registry::EContentFrozen)]
    fun test_freeze_immutable() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::register_rights(
                &mut config,
                b"hash123",
                1, // Original
                CREATOR,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(config);
        };
        // Freeze
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            let mut record = ts::take_from_address<rights_registry::RightsRecord>(&scenario, CREATOR);
            rights_registry::freeze_rights(
                &config,
                &mut record,
                2000,
                ts::ctx(&mut scenario),
            );
            assert!(rights_registry::get_is_frozen(&record) == true);
            ts::return_to_address(CREATOR, record);
            ts::return_shared(config);
        };
        // Attempt update after freeze — should abort EContentFrozen
        ts::next_tx(&mut scenario, ADMIN);
        {
            let config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            let mut record = ts::take_from_address<rights_registry::RightsRecord>(&scenario, CREATOR);
            rights_registry::update_rights(
                &config,
                &mut record,
                0, // Fun
                3000,
                ts::ctx(&mut scenario),
            );
            ts::return_to_address(CREATOR, record);
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_add_remove_operator() {
        let mut scenario = ts::begin(ADMIN);
        {
            rights_registry::init_for_testing(ts::ctx(&mut scenario));
        };
        // Admin adds operator
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::add_operator(&mut config, OPERATOR, ts::ctx(&mut scenario));
            ts::return_shared(config);
        };
        // Operator can register
        ts::next_tx(&mut scenario, OPERATOR);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::register_rights(
                &mut config,
                b"hash456",
                1,
                CREATOR,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(config);
        };
        // Admin removes operator
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut config = ts::take_shared<rights_registry::RegistryConfig>(&scenario);
            rights_registry::remove_operator(&mut config, OPERATOR, ts::ctx(&mut scenario));
            ts::return_shared(config);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_is_monetizable() {
        assert!(rights_registry::is_monetizable(1) == true);  // Original
        assert!(rights_registry::is_monetizable(2) == true);  // Licensed
        assert!(rights_registry::is_monetizable(0) == false); // Fun
        assert!(rights_registry::is_monetizable(3) == false); // PublicDomain
    }
}
