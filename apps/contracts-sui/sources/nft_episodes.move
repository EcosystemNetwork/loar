/// Episode NFTs — Mint 1/1 + edition NFTs per universe on SUI.
/// SUI equivalent of EpisodeNFT.sol + EpisodeEditionCollection.sol.
module loar::nft_episodes {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::event;
    use std::string::{Self, String};

    // ── Objects ───────────────────────────────────────────────

    public struct EpisodeCollection has key {
        id: UID,
        universe_id: ID,
        authority: address,
        treasury: address,
        creator_share_bps: u64,
        platform_share_bps: u64,
        episode_count: u64,
        total_minted: u64,
        total_revenue: u64,
    }

    public struct Episode has key, store {
        id: UID,
        collection_id: ID,
        index: u64,
        creator: address,
        title: String,
        content_hash: vector<u8>,
        metadata_uri: String,
        max_editions: u64,
        minted_editions: u64,
        price: u64,
        is_active: bool,
        created_at: u64,
    }

    public struct EpisodeEdition has key, store {
        id: UID,
        episode_id: ID,
        edition_number: u64,
        owner: address,
        minted_at: u64,
    }

    // ── Events ────────────────────────────────────────────────

    public struct EpisodeCreated has copy, drop {
        collection_id: ID,
        index: u64,
        creator: address,
        title: String,
    }

    public struct EditionMinted has copy, drop {
        episode_id: ID,
        edition_number: u64,
        minter: address,
        price: u64,
    }

    // ── Constants & Errors ────────────────────────────────────
    const BPS_DENOMINATOR: u64 = 10_000;
    const MAX_FEE_BPS: u64 = 5_000; // 50% max platform fee

    const ENotAuthority: u64 = 0;
    const ENotCreator: u64 = 1;
    const ESoldOut: u64 = 2;
    const EInactive: u64 = 3;
    const EInsufficientPayment: u64 = 4;
    const EInvalidShares: u64 = 5;
    const EFeeTooHigh: u64 = 6;

    // ── Create Collection ─────────────────────────────────────

    public entry fun create_collection(
        universe_id: ID,
        treasury: address,
        creator_share_bps: u64,
        platform_share_bps: u64,
        ctx: &mut TxContext,
    ) {
        assert!(creator_share_bps + platform_share_bps == 10_000, EInvalidShares);
        assert!(platform_share_bps <= MAX_FEE_BPS, EFeeTooHigh);

        let collection = EpisodeCollection {
            id: object::new(ctx),
            universe_id,
            authority: tx_context::sender(ctx),
            treasury,
            creator_share_bps,
            platform_share_bps,
            episode_count: 0,
            total_minted: 0,
            total_revenue: 0,
        };
        transfer::share_object(collection);
    }

    // ── Create Episode ────────────────────────────────────────

    public entry fun create_episode(
        collection: &mut EpisodeCollection,
        title: vector<u8>,
        content_hash: vector<u8>,
        metadata_uri: vector<u8>,
        max_editions: u64,
        price: u64,
        timestamp: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == collection.authority, ENotAuthority);

        let index = collection.episode_count;
        collection.episode_count = index + 1;

        let ep_title = string::utf8(title);

        let episode = Episode {
            id: object::new(ctx),
            collection_id: object::id(collection),
            index,
            creator: tx_context::sender(ctx),
            title: ep_title,
            content_hash,
            metadata_uri: string::utf8(metadata_uri),
            max_editions,
            minted_editions: 0,
            price,
            is_active: true,
            created_at: timestamp,
        };

        event::emit(EpisodeCreated {
            collection_id: object::id(collection),
            index,
            creator: tx_context::sender(ctx),
            title: ep_title,
        });

        transfer::share_object(episode);
    }

    // ── Mint Edition ──────────────────────────────────────────

    public entry fun mint_edition(
        collection: &mut EpisodeCollection,
        episode: &mut Episode,
        payment: &mut Coin<SUI>,
        timestamp: u64,
        ctx: &mut TxContext,
    ) {
        assert!(episode.is_active, EInactive);
        assert!(episode.minted_editions < episode.max_editions, ESoldOut);

        let price = episode.price;
        if (price > 0) {
            assert!(coin::value(payment) >= price, EInsufficientPayment);

            // Platform share
            let platform_amount = (price * collection.platform_share_bps) / BPS_DENOMINATOR;
            let creator_amount = price - platform_amount;

            if (platform_amount > 0) {
                let platform_coin = coin::split(payment, platform_amount, ctx);
                transfer::public_transfer(platform_coin, collection.treasury);
            };

            if (creator_amount > 0) {
                let creator_coin = coin::split(payment, creator_amount, ctx);
                transfer::public_transfer(creator_coin, episode.creator);
            };

            collection.total_revenue = collection.total_revenue + price;
        };

        let edition_number = episode.minted_editions;
        episode.minted_editions = edition_number + 1;
        collection.total_minted = collection.total_minted + 1;

        let edition = EpisodeEdition {
            id: object::new(ctx),
            episode_id: object::id(episode),
            edition_number,
            owner: tx_context::sender(ctx),
            minted_at: timestamp,
        };

        event::emit(EditionMinted {
            episode_id: object::id(episode),
            edition_number,
            minter: tx_context::sender(ctx),
            price,
        });

        transfer::public_transfer(edition, tx_context::sender(ctx));
    }

    // ── Toggle Active ─────────────────────────────────────────

    public entry fun set_episode_active(
        episode: &mut Episode,
        is_active: bool,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == episode.creator, ENotCreator);
        episode.is_active = is_active;
    }

    // ── Update Shares (authority only) ────────────────────────

    public entry fun update_shares(
        collection: &mut EpisodeCollection,
        creator_share_bps: u64,
        platform_share_bps: u64,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == collection.authority, ENotAuthority);
        assert!(creator_share_bps + platform_share_bps == 10_000, EInvalidShares);
        assert!(platform_share_bps <= MAX_FEE_BPS, EFeeTooHigh);

        collection.creator_share_bps = creator_share_bps;
        collection.platform_share_bps = platform_share_bps;
    }
}

#[test_only]
module loar::nft_episodes_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin;
    use sui::sui::SUI;
    use sui::object;
    use loar::nft_episodes;

    const AUTHORITY: address = @0x1;
    const TREASURY: address = @0x2;
    const MINTER: address = @0x3;

    fun dummy_universe_id(scenario: &mut Scenario): object::ID {
        object::id_from_address(@0xBEEF)
    }

    #[test]
    fun test_create_collection() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(
                uid,
                TREASURY,
                7000, // creator 70%
                3000, // platform 30%
                ts::ctx(&mut scenario),
            );
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_episodes::EFeeTooHigh)]
    fun test_create_collection_fee_too_high() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(
                uid,
                TREASURY,
                4000, // creator 40%
                6000, // platform 60% — exceeds 50% cap
                ts::ctx(&mut scenario),
            );
        };
        ts::end(scenario);
    }

    #[test]
    fun test_create_episode() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(
                uid,
                TREASURY,
                7000,
                3000,
                ts::ctx(&mut scenario),
            );
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            nft_episodes::create_episode(
                &mut collection,
                b"Episode 1",
                b"content_hash_1",
                b"ipfs://meta1",
                100,       // max_editions
                1_000_000, // price in MIST
                1000,      // timestamp
                ts::ctx(&mut scenario),
            );
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_mint_edition() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(uid, TREASURY, 7000, 3000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            nft_episodes::create_episode(
                &mut collection,
                b"Episode 1",
                b"hash",
                b"ipfs://meta",
                10,
                1_000_000,
                1000,
                ts::ctx(&mut scenario),
            );
            ts::return_shared(collection);
        };
        // Minter mints an edition
        ts::next_tx(&mut scenario, MINTER);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            let mut episode = ts::take_shared<nft_episodes::Episode>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(10_000_000, ts::ctx(&mut scenario));
            nft_episodes::mint_edition(
                &mut collection,
                &mut episode,
                &mut payment,
                2000,
                ts::ctx(&mut scenario),
            );
            // Verify payment was split (remaining = 10M - 1M = 9M)
            assert!(coin::value(&payment) == 9_000_000);
            coin::burn_for_testing(payment);
            ts::return_shared(episode);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_episodes::ESoldOut)]
    fun test_sold_out() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(uid, TREASURY, 7000, 3000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            nft_episodes::create_episode(
                &mut collection, b"Ep", b"hash", b"uri", 1, 0, 1000, ts::ctx(&mut scenario),
            );
            ts::return_shared(collection);
        };
        // First mint — OK (free episode)
        ts::next_tx(&mut scenario, MINTER);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            let mut episode = ts::take_shared<nft_episodes::Episode>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_episodes::mint_edition(&mut collection, &mut episode, &mut payment, 2000, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_shared(episode);
            ts::return_shared(collection);
        };
        // Second mint — should abort ESoldOut
        ts::next_tx(&mut scenario, MINTER);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            let mut episode = ts::take_shared<nft_episodes::Episode>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_episodes::mint_edition(&mut collection, &mut episode, &mut payment, 3000, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_shared(episode);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_episodes::EInactive)]
    fun test_inactive_episode() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(uid, TREASURY, 7000, 3000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            nft_episodes::create_episode(
                &mut collection, b"Ep", b"hash", b"uri", 10, 0, 1000, ts::ctx(&mut scenario),
            );
            ts::return_shared(collection);
        };
        // Deactivate episode
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut episode = ts::take_shared<nft_episodes::Episode>(&scenario);
            nft_episodes::set_episode_active(&mut episode, false, ts::ctx(&mut scenario));
            ts::return_shared(episode);
        };
        // Attempt to mint inactive — should abort EInactive
        ts::next_tx(&mut scenario, MINTER);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            let mut episode = ts::take_shared<nft_episodes::Episode>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_episodes::mint_edition(&mut collection, &mut episode, &mut payment, 2000, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_shared(episode);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_update_shares() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            let uid = dummy_universe_id(&mut scenario);
            nft_episodes::create_collection(uid, TREASURY, 7000, 3000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_episodes::EpisodeCollection>(&scenario);
            // Update to 60/40
            nft_episodes::update_shares(&mut collection, 6000, 4000, ts::ctx(&mut scenario));
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }
}
