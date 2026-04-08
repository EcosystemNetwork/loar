/// Entity NFTs — World-building entities on SUI.
/// SUI equivalent of EntityNFT.sol + EntityEditionNFT.sol.
///
/// Supports both unique (1/1) entities and edition entities.
/// Creation fee charged for both types (parity with EVM).
module loar::nft_entities {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use std::string::{Self, String};

    // Entity kinds: 0-5 = unique (1/1), 6-9 = edition
    const KIND_PERSON: u8 = 0;
    const KIND_PLACE: u8 = 1;
    const KIND_FACTION: u8 = 2;
    const KIND_EVENT: u8 = 3;
    const KIND_VEHICLE: u8 = 4;
    const KIND_ORGANIZATION: u8 = 5;
    const KIND_THING: u8 = 6;
    const KIND_LORE: u8 = 7;
    const KIND_SPECIES: u8 = 8;
    const KIND_TECHNOLOGY: u8 = 9;

    public struct EntityCollection has key {
        id: UID,
        universe_id: u64,
        authority: address,
        treasury: address,
        entity_count: u64,
        total_revenue: u64,
        creation_fee: u64,
    }

    public struct Entity has key, store {
        id: UID,
        collection_id: ID,
        index: u64,
        kind: u8,
        owner: address,
        creator: address,
        name: String,
        metadata_uri: String,
        content_hash: vector<u8>,
        max_editions: u64,
        minted_editions: u64,
        price: u64,
        parent_entity: Option<ID>,
        created_at: u64,
    }

    public struct EntityMintedEvent has copy, drop {
        collection_id: ID,
        index: u64,
        kind: u8,
        owner: address,
        name: String,
    }

    public struct EditionMintedEvent has copy, drop {
        entity_id: ID,
        edition_number: u64,
        minter: address,
    }

    const ENotOwner: u64 = 0;
    const ESoldOut: u64 = 1;
    const EInsufficientPayment: u64 = 2;
    const EInvalidKind: u64 = 3;
    const ENotAuthority: u64 = 4;
    const EParentNotInCollection: u64 = 5;
    const ESelfParent: u64 = 6;

    fun is_unique_kind(kind: u8): bool {
        kind <= KIND_ORGANIZATION
    }

    public entry fun create_collection(
        universe_id: u64,
        treasury: address,
        creation_fee: u64,
        ctx: &mut TxContext,
    ) {
        let collection = EntityCollection {
            id: object::new(ctx),
            universe_id,
            authority: tx_context::sender(ctx),
            treasury,
            entity_count: 0,
            total_revenue: 0,
            creation_fee,
        };
        transfer::share_object(collection);
    }

    /// Mint an entity. Charges creation_fee + price (for unique types).
    /// Edition types charge creation_fee on creation, price on each edition mint.
    public entry fun mint_entity(
        collection: &mut EntityCollection,
        kind: u8,
        name: vector<u8>,
        metadata_uri: vector<u8>,
        content_hash: vector<u8>,
        max_editions: u64,
        price: u64,
        payment: &mut Coin<SUI>,
        timestamp: u64,
        ctx: &mut TxContext,
    ) {
        assert!(kind <= KIND_TECHNOLOGY, EInvalidKind);

        // For unique kinds, force max_editions = 1
        let actual_max = if (is_unique_kind(kind)) { 1 } else { max_editions };
        let initial_minted = if (is_unique_kind(kind)) { 1 } else { 0 };

        // Charge creation fee for all types + mint price for unique
        let total_charge = if (is_unique_kind(kind)) {
            collection.creation_fee + price
        } else {
            collection.creation_fee
        };

        if (total_charge > 0) {
            assert!(coin::value(payment) >= total_charge, EInsufficientPayment);
            let pay_coin = coin::split(payment, total_charge, ctx);
            transfer::public_transfer(pay_coin, collection.treasury);
            collection.total_revenue = collection.total_revenue + total_charge;
        };

        let index = collection.entity_count;
        collection.entity_count = index + 1;

        let entity_name = string::utf8(name);

        let entity = Entity {
            id: object::new(ctx),
            collection_id: object::id(collection),
            index,
            kind,
            owner: tx_context::sender(ctx),
            creator: tx_context::sender(ctx),
            name: entity_name,
            metadata_uri: string::utf8(metadata_uri),
            content_hash,
            max_editions: actual_max,
            minted_editions: initial_minted,
            price,
            parent_entity: option::none(),
            created_at: timestamp,
        };

        event::emit(EntityMintedEvent {
            collection_id: object::id(collection),
            index,
            kind,
            owner: tx_context::sender(ctx),
            name: entity_name,
        });

        transfer::public_transfer(entity, tx_context::sender(ctx));
    }

    public entry fun mint_edition(
        collection: &mut EntityCollection,
        entity: &mut Entity,
        payment: &mut Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(entity.minted_editions < entity.max_editions, ESoldOut);

        let price = entity.price;
        if (price > 0) {
            assert!(coin::value(payment) >= price, EInsufficientPayment);
            let pay_coin = coin::split(payment, price, ctx);
            transfer::public_transfer(pay_coin, collection.treasury);
            collection.total_revenue = collection.total_revenue + price;
        };

        entity.minted_editions = entity.minted_editions + 1;

        event::emit(EditionMintedEvent {
            entity_id: object::id(entity),
            edition_number: entity.minted_editions,
            minter: tx_context::sender(ctx),
        });
    }

    /// Set parent entity. Validates parent is in same collection and not self.
    public entry fun set_parent(
        entity: &mut Entity,
        parent: &Entity,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == entity.owner, ENotOwner);
        assert!(parent.collection_id == entity.collection_id, EParentNotInCollection);
        assert!(object::id(parent) != object::id(entity), ESelfParent);
        entity.parent_entity = option::some(object::id(parent));
    }

    /// Update creation fee (authority only).
    public entry fun set_creation_fee(
        collection: &mut EntityCollection,
        fee: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == collection.authority, ENotAuthority);
        collection.creation_fee = fee;
    }
}

#[test_only]
module loar::nft_entities_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin;
    use sui::sui::SUI;
    use sui::object;
    use loar::nft_entities;

    const AUTHORITY: address = @0x1;
    const TREASURY: address = @0x2;
    const USER: address = @0x3;

    // Entity kinds
    const KIND_PERSON: u8 = 0;  // unique
    const KIND_THING: u8 = 6;   // edition

    #[test]
    fun test_create_collection() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(
                1,          // universe_id
                TREASURY,
                100_000,    // creation_fee
                ts::ctx(&mut scenario),
            );
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_mint_unique_entity() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 100_000, ts::ctx(&mut scenario));
        };
        // Mint unique entity (KIND_PERSON) — charges creation_fee + price
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection,
                KIND_PERSON,
                b"Alice",
                b"ipfs://meta",
                b"hash",
                1,          // max_editions (ignored for unique, forced to 1)
                200_000,    // price
                &mut payment,
                1000,
                ts::ctx(&mut scenario),
            );
            // Should have deducted creation_fee(100k) + price(200k) = 300k
            assert!(coin::value(&payment) == 700_000);
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_create_edition_entity() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 100_000, ts::ctx(&mut scenario));
        };
        // Mint edition entity (KIND_THING) — charges creation_fee only
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection,
                KIND_THING,
                b"Sword",
                b"ipfs://meta",
                b"hash",
                50,         // max_editions
                10_000,     // price per edition (not charged on creation)
                &mut payment,
                1000,
                ts::ctx(&mut scenario),
            );
            // Should have deducted only creation_fee(100k)
            assert!(coin::value(&payment) == 900_000);
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_mint_edition_copy() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 100_000, ts::ctx(&mut scenario));
        };
        // Create edition entity
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(200_000, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_THING, b"Sword", b"uri", b"hash",
                10, 50_000, &mut payment, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Mint an edition copy — charges price
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut entity = ts::take_from_address<nft_entities::Entity>(&scenario, USER);
            let mut payment = coin::mint_for_testing<SUI>(100_000, ts::ctx(&mut scenario));
            nft_entities::mint_edition(
                &mut collection,
                &mut entity,
                &mut payment,
                ts::ctx(&mut scenario),
            );
            // 50_000 price deducted
            assert!(coin::value(&payment) == 50_000);
            coin::burn_for_testing(payment);
            ts::return_to_address(USER, entity);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_entities::ESoldOut)]
    fun test_sold_out() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 0, ts::ctx(&mut scenario));
        };
        // Create edition entity with max 1
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_THING, b"Sword", b"uri", b"hash",
                1, 0, &mut payment, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // First edition mint — OK
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut entity = ts::take_from_address<nft_entities::Entity>(&scenario, USER);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_edition(&mut collection, &mut entity, &mut payment, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_to_address(USER, entity);
            ts::return_shared(collection);
        };
        // Second edition — should abort ESoldOut
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut entity = ts::take_from_address<nft_entities::Entity>(&scenario, USER);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_edition(&mut collection, &mut entity, &mut payment, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_to_address(USER, entity);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_set_parent_same_collection() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 0, ts::ctx(&mut scenario));
        };
        // Create two entities in same collection
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_PERSON, b"Parent", b"uri", b"hash",
                1, 0, &mut payment, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_PERSON, b"Child", b"uri", b"hash2",
                1, 0, &mut payment, 2000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Set parent — both in same collection, should succeed
        ts::next_tx(&mut scenario, USER);
        {
            // We need both entities; they are owned by USER
            let entities = ts::ids_for_address<nft_entities::Entity>(USER);
            let parent = ts::take_from_address_by_id<nft_entities::Entity>(&scenario, USER, *vector::borrow(&entities, 0));
            let mut child = ts::take_from_address_by_id<nft_entities::Entity>(&scenario, USER, *vector::borrow(&entities, 1));
            nft_entities::set_parent(&mut child, &parent, ts::ctx(&mut scenario));
            ts::return_to_address(USER, parent);
            ts::return_to_address(USER, child);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_entities::EParentNotInCollection)]
    fun test_set_parent_wrong_collection() {
        let mut scenario = ts::begin(AUTHORITY);
        // Create collection 1
        {
            nft_entities::create_collection(1, TREASURY, 0, ts::ctx(&mut scenario));
        };
        // Mint entity in collection 1
        ts::next_tx(&mut scenario, USER);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_PERSON, b"Entity1", b"uri", b"hash",
                1, 0, &mut payment, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Create collection 2
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            nft_entities::create_collection(2, TREASURY, 0, ts::ctx(&mut scenario));
        };
        // Mint entity in collection 2 — we need to take the second shared collection
        // Since two EntityCollections are shared, we take both and return the wrong one
        ts::next_tx(&mut scenario, USER);
        {
            // Take the most recently created shared collection (collection 2)
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_entities::mint_entity(
                &mut collection, KIND_PERSON, b"Entity2", b"uri", b"hash2",
                1, 0, &mut payment, 2000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Try to set parent from different collection — should abort
        ts::next_tx(&mut scenario, USER);
        {
            let entities = ts::ids_for_address<nft_entities::Entity>(USER);
            let parent = ts::take_from_address_by_id<nft_entities::Entity>(&scenario, USER, *vector::borrow(&entities, 0));
            let mut child = ts::take_from_address_by_id<nft_entities::Entity>(&scenario, USER, *vector::borrow(&entities, 1));
            nft_entities::set_parent(&mut child, &parent, ts::ctx(&mut scenario));
            ts::return_to_address(USER, parent);
            ts::return_to_address(USER, child);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_set_creation_fee() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_entities::create_collection(1, TREASURY, 100_000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_entities::EntityCollection>(&scenario);
            nft_entities::set_creation_fee(&mut collection, 200_000, ts::ctx(&mut scenario));
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }
}
