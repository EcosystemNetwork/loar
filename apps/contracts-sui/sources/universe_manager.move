/// Universe Manager — Create narrative universes, deploy governance tokens,
/// manage narrative DAG nodes. SUI equivalent of UniverseManager.sol.
module loar::universe_manager {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use std::string::{Self, String};

    // ── Objects ───────────────────────────────────────────────

    /// Global state (shared).
    public struct GlobalState has key {
        id: UID,
        admin: address,
        treasury: address,
        universe_count: u64,
        creation_fee: u64,
    }

    /// A narrative universe (shared).
    public struct Universe has key {
        id: UID,
        index: u64,
        creator: address,
        name: String,
        description: String,
        image_url: String,
        content_hash: vector<u8>,
        node_count: u64,
        creation_mode: u8,    // 0=Public, 1=Whitelisted
        visibility_mode: u8,  // 0=Public, 1=HoldersOnly, 2=Whitelisted
        token_id: Option<ID>,
        created_at: u64,
    }

    /// A narrative node in a universe's DAG (owned by creator).
    public struct NarrativeNode has key, store {
        id: UID,
        universe_id: ID,
        index: u64,
        creator: address,
        content_hash: vector<u8>,
        plot_hash: vector<u8>,
        previous: Option<ID>,
        link: Option<ID>,
        is_canon: bool,
        created_at: u64,
    }

    // ── Events ────────────────────────────────────────────────

    public struct UniverseCreated has copy, drop {
        id: ID,
        index: u64,
        creator: address,
        name: String,
    }

    public struct NodeCreated has copy, drop {
        universe_id: ID,
        node_id: ID,
        index: u64,
        creator: address,
    }

    public struct CanonUpdated has copy, drop {
        universe_id: ID,
        node_id: ID,
        is_canon: bool,
    }

    // ── Constants ────────────────────────────────────────────
    const MODE_PUBLIC: u8 = 0;
    const MODE_WHITELISTED: u8 = 1;
    const VIS_PUBLIC: u8 = 0;
    const VIS_HOLDERS_ONLY: u8 = 1;
    const VIS_WHITELISTED: u8 = 2;

    // ── Errors ────────────────────────────────────────────────
    const ENotAdmin: u64 = 0;
    const ENotCreator: u64 = 1;
    const ETokenAlreadyDeployed: u64 = 2;
    const EInsufficientFee: u64 = 3;
    const EInvalidTreasury: u64 = 4;

    // ── Init ──────────────────────────────────────────────────

    fun init(ctx: &mut TxContext) {
        let state = GlobalState {
            id: object::new(ctx),
            admin: tx_context::sender(ctx),
            treasury: tx_context::sender(ctx),
            universe_count: 0,
            creation_fee: 0,
        };
        transfer::share_object(state);
    }

    // ── Create Universe ───────────────────────────────────────

    /// Create a new universe. Collects creation_fee if set.
    public entry fun create_universe(
        state: &mut GlobalState,
        name: vector<u8>,
        description: vector<u8>,
        image_url: vector<u8>,
        content_hash: vector<u8>,
        payment: &mut Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Collect creation fee
        if (state.creation_fee > 0) {
            assert!(coin::value(payment) >= state.creation_fee, EInsufficientFee);
            let fee_coin = coin::split(payment, state.creation_fee, ctx);
            transfer::public_transfer(fee_coin, state.treasury);
        };

        let index = state.universe_count;
        state.universe_count = index + 1;

        let universe_name = string::utf8(name);

        let universe = Universe {
            id: object::new(ctx),
            index,
            creator: tx_context::sender(ctx),
            name: universe_name,
            description: string::utf8(description),
            image_url: string::utf8(image_url),
            content_hash,
            node_count: 0,
            creation_mode: MODE_PUBLIC,
            visibility_mode: VIS_PUBLIC,
            token_id: option::none(),
            created_at: clock::timestamp_ms(clock),
        };

        let uid = object::id(&universe);

        event::emit(UniverseCreated {
            id: uid,
            index,
            creator: tx_context::sender(ctx),
            name: universe_name,
        });

        transfer::share_object(universe);
    }

    // ── Create Node ───────────────────────────────────────────

    public entry fun create_node(
        universe: &mut Universe,
        content_hash: vector<u8>,
        plot_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let index = universe.node_count;
        universe.node_count = index + 1;

        let node = NarrativeNode {
            id: object::new(ctx),
            universe_id: object::id(universe),
            index,
            creator: tx_context::sender(ctx),
            content_hash,
            plot_hash,
            previous: option::none(),
            link: option::none(),
            is_canon: false,
            created_at: clock::timestamp_ms(clock),
        };

        let node_id = object::id(&node);

        event::emit(NodeCreated {
            universe_id: object::id(universe),
            node_id,
            index,
            creator: tx_context::sender(ctx),
        });

        transfer::public_transfer(node, tx_context::sender(ctx));
    }

    // ── Set Canon ─────────────────────────────────────────────

    public entry fun set_canon(
        universe: &Universe,
        node: &mut NarrativeNode,
        is_canon: bool,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == universe.creator, ENotCreator);
        node.is_canon = is_canon;

        event::emit(CanonUpdated {
            universe_id: object::id(universe),
            node_id: object::id(node),
            is_canon,
        });
    }

    // ── Admin ─────────────────────────────────────────────────

    public entry fun set_creation_fee(
        state: &mut GlobalState,
        fee: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == state.admin, ENotAdmin);
        state.creation_fee = fee;
    }

    public entry fun set_treasury(
        state: &mut GlobalState,
        new_treasury: address,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == state.admin, ENotAdmin);
        state.treasury = new_treasury;
    }

    // ── Universe Management ──────────────────────────────────

    public entry fun set_creation_mode(
        universe: &mut Universe,
        mode: u8,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == universe.creator, ENotCreator);
        universe.creation_mode = mode;
    }

    public entry fun set_visibility_mode(
        universe: &mut Universe,
        mode: u8,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == universe.creator, ENotCreator);
        universe.visibility_mode = mode;
    }

    // ── View functions ───────────────────────────────────────
    public fun get_universe_count(state: &GlobalState): u64 { state.universe_count }
    public fun get_creation_fee(state: &GlobalState): u64 { state.creation_fee }
    public fun get_node_count(universe: &Universe): u64 { universe.node_count }
    public fun get_creator(universe: &Universe): address { universe.creator }

    // ── Test helpers ─────────────────────────────────────────
    #[test_only]
    public fun init_for_testing(ctx: &mut TxContext) {
        init(ctx);
    }
}

#[test_only]
module loar::universe_manager_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use loar::universe_manager::{Self, GlobalState, Universe, NarrativeNode};

    const ADMIN: address = @0x1;
    const CREATOR: address = @0x2;
    const OTHER: address = @0x3;
    const TREASURY: address = @0x5;

    fun setup(scenario: &mut Scenario) {
        ts::next_tx(scenario, ADMIN);
        universe_manager::init_for_testing(ts::ctx(scenario));
    }

    fun create_test_clock(scenario: &mut Scenario): Clock {
        clock::create_for_testing(ts::ctx(scenario))
    }

    #[test]
    fun test_init() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        ts::next_tx(&mut scenario, ADMIN);
        {
            let state = ts::take_shared<GlobalState>(&scenario);
            assert!(universe_manager::get_universe_count(&state) == 0, 0);
            assert!(universe_manager::get_creation_fee(&state) == 0, 1);
            ts::return_shared(state);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_create_universe() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_universe(
                &mut state,
                b"Test Universe",
                b"A test universe",
                b"https://example.com/img.png",
                b"contenthash123",
                &mut payment,
                &clock,
                ts::ctx(&mut scenario),
            );

            assert!(universe_manager::get_universe_count(&state) == 1, 0);

            ts::return_shared(state);
            coin::burn_for_testing(payment);
            clock::destroy_for_testing(clock);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_create_universe_with_fee() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Admin sets a creation fee
        ts::next_tx(&mut scenario, ADMIN);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            universe_manager::set_creation_fee(&mut state, 1_000_000, ts::ctx(&scenario));
            assert!(universe_manager::get_creation_fee(&state) == 1_000_000, 0);
            ts::return_shared(state);
        };

        // Creator creates universe with fee payment
        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(2_000_000, ts::ctx(&mut scenario));
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_universe(
                &mut state,
                b"Fee Universe",
                b"Universe with fee",
                b"https://example.com/img.png",
                b"contenthash456",
                &mut payment,
                &clock,
                ts::ctx(&mut scenario),
            );

            assert!(universe_manager::get_universe_count(&state) == 1, 1);
            // Payment should have 1_000_000 remaining (2M - 1M fee)
            assert!(coin::value(&payment) == 1_000_000, 2);

            ts::return_shared(state);
            coin::burn_for_testing(payment);
            clock::destroy_for_testing(clock);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_create_node() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Create a universe first
        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_universe(
                &mut state,
                b"Node Universe",
                b"Universe for nodes",
                b"https://example.com/img.png",
                b"contenthash789",
                &mut payment,
                &clock,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(state);
            coin::burn_for_testing(payment);
            clock::destroy_for_testing(clock);
        };

        // Create a node in the universe
        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut universe = ts::take_shared<Universe>(&scenario);
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_node(
                &mut universe,
                b"node_content_hash",
                b"node_plot_hash",
                &clock,
                ts::ctx(&mut scenario),
            );

            assert!(universe_manager::get_node_count(&universe) == 1, 0);

            ts::return_shared(universe);
            clock::destroy_for_testing(clock);
        };

        // Verify node was transferred to creator
        ts::next_tx(&mut scenario, CREATOR);
        {
            let node = ts::take_from_sender<NarrativeNode>(&scenario);
            ts::return_to_sender(&scenario, node);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_set_canon_creator_only() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Create universe and node
        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_universe(
                &mut state,
                b"Canon Universe",
                b"desc",
                b"img",
                b"hash",
                &mut payment,
                &clock,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(state);
            coin::burn_for_testing(payment);
            clock::destroy_for_testing(clock);
        };

        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut universe = ts::take_shared<Universe>(&scenario);
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_node(
                &mut universe,
                b"content",
                b"plot",
                &clock,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(universe);
            clock::destroy_for_testing(clock);
        };

        // Creator sets canon
        ts::next_tx(&mut scenario, CREATOR);
        {
            let universe = ts::take_shared<Universe>(&scenario);
            let mut node = ts::take_from_sender<NarrativeNode>(&scenario);

            universe_manager::set_canon(&universe, &mut node, true, ts::ctx(&scenario));

            ts::return_shared(universe);
            ts::return_to_sender(&scenario, node);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::universe_manager::ENotCreator)]
    fun test_set_canon_non_creator_aborts() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Create universe as CREATOR
        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_universe(
                &mut state,
                b"Canon Universe",
                b"desc",
                b"img",
                b"hash",
                &mut payment,
                &clock,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(state);
            coin::burn_for_testing(payment);
            clock::destroy_for_testing(clock);
        };

        ts::next_tx(&mut scenario, CREATOR);
        {
            let mut universe = ts::take_shared<Universe>(&scenario);
            let clock = create_test_clock(&mut scenario);

            universe_manager::create_node(
                &mut universe,
                b"content",
                b"plot",
                &clock,
                ts::ctx(&mut scenario),
            );

            ts::return_shared(universe);
            clock::destroy_for_testing(clock);
        };

        // Transfer node to OTHER for testing
        ts::next_tx(&mut scenario, CREATOR);
        {
            let node = ts::take_from_sender<NarrativeNode>(&scenario);
            sui::transfer::public_transfer(node, OTHER);
        };

        // OTHER tries to set canon -> aborts
        ts::next_tx(&mut scenario, OTHER);
        {
            let universe = ts::take_shared<Universe>(&scenario);
            let mut node = ts::take_from_sender<NarrativeNode>(&scenario);

            universe_manager::set_canon(&universe, &mut node, true, ts::ctx(&scenario));

            ts::return_shared(universe);
            ts::return_to_sender(&scenario, node);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::universe_manager::ENotAdmin)]
    fun test_set_creation_fee_non_admin_aborts() {
        let mut scenario = ts::begin(ADMIN);
        setup(&mut scenario);

        // Non-admin tries to set fee -> aborts
        ts::next_tx(&mut scenario, OTHER);
        {
            let mut state = ts::take_shared<GlobalState>(&scenario);
            universe_manager::set_creation_fee(&mut state, 100, ts::ctx(&scenario));
            ts::return_shared(state);
        };

        ts::end(scenario);
    }
}
