/// Character NFTs — 1/1 characters with appearance royalties on SUI.
/// SUI equivalent of CharacterNFT.sol.
///
/// Royalty flow: record_appearance deposits SUI into vault Balance.
/// claim_royalties withdraws from vault to character owner.
module loar::nft_characters {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use std::string::{Self, String};

    public struct CharacterCollection has key {
        id: UID,
        universe_id: u64,
        authority: address,
        treasury: address,
        character_count: u64,
        appearance_royalty: u64,
        total_appearances: u64,
        total_royalties_paid: u64,
        /// Vault holding escrowed royalties for character owners to claim.
        vault: Balance<SUI>,
    }

    public struct Character has key, store {
        id: UID,
        collection_id: ID,
        index: u64,
        owner: address,
        creator: address,
        name: String,
        metadata_uri: String,
        content_hash: vector<u8>,
        appearances: u64,
        accrued_royalties: u64,
        claimed_royalties: u64,
        created_at: u64,
    }

    public struct CharacterMintedEvent has copy, drop {
        collection_id: ID,
        index: u64,
        owner: address,
        name: String,
    }

    public struct AppearanceRecordedEvent has copy, drop {
        character_id: ID,
        total_appearances: u64,
        royalty_earned: u64,
    }

    public struct RoyaltiesClaimedEvent has copy, drop {
        character_id: ID,
        owner: address,
        amount: u64,
    }

    const ENotAuthority: u64 = 0;
    const ENotOwner: u64 = 1;
    const ENothingToClaim: u64 = 2;
    const EInsufficientPayment: u64 = 3;
    const EInsufficientVault: u64 = 4;

    public entry fun create_collection(
        universe_id: u64,
        treasury: address,
        appearance_royalty: u64,
        ctx: &mut TxContext,
    ) {
        let collection = CharacterCollection {
            id: object::new(ctx),
            universe_id,
            authority: tx_context::sender(ctx),
            treasury,
            character_count: 0,
            appearance_royalty,
            total_appearances: 0,
            total_royalties_paid: 0,
            vault: balance::zero(),
        };
        transfer::share_object(collection);
    }

    public entry fun mint_character(
        collection: &mut CharacterCollection,
        name: vector<u8>,
        metadata_uri: vector<u8>,
        content_hash: vector<u8>,
        payment: &mut Coin<SUI>,
        price: u64,
        timestamp: u64,
        ctx: &mut TxContext,
    ) {
        if (price > 0) {
            assert!(coin::value(payment) >= price, EInsufficientPayment);
            let pay_coin = coin::split(payment, price, ctx);
            transfer::public_transfer(pay_coin, collection.treasury);
        };

        let index = collection.character_count;
        collection.character_count = index + 1;

        let char_name = string::utf8(name);

        let character = Character {
            id: object::new(ctx),
            collection_id: object::id(collection),
            index,
            owner: tx_context::sender(ctx),
            creator: tx_context::sender(ctx),
            name: char_name,
            metadata_uri: string::utf8(metadata_uri),
            content_hash,
            appearances: 0,
            accrued_royalties: 0,
            claimed_royalties: 0,
            created_at: timestamp,
        };

        event::emit(CharacterMintedEvent {
            collection_id: object::id(collection),
            index,
            owner: tx_context::sender(ctx),
            name: char_name,
        });

        transfer::public_transfer(character, tx_context::sender(ctx));
    }

    /// Record an appearance. Authority deposits royalty SUI into the vault.
    public entry fun record_appearance(
        collection: &mut CharacterCollection,
        character: &mut Character,
        payment: &mut Coin<SUI>,
        ctx: &TxContext,
    ) {
        assert!(tx_context::sender(ctx) == collection.authority, ENotAuthority);

        let royalty = collection.appearance_royalty;

        // Deposit royalty into vault
        if (royalty > 0) {
            assert!(coin::value(payment) >= royalty, EInsufficientPayment);
            let royalty_balance = coin::into_balance(coin::split(payment, royalty, ctx));
            balance::join(&mut collection.vault, royalty_balance);
        };

        character.appearances = character.appearances + 1;
        character.accrued_royalties = character.accrued_royalties + royalty;
        collection.total_appearances = collection.total_appearances + 1;

        event::emit(AppearanceRecordedEvent {
            character_id: object::id(character),
            total_appearances: character.appearances,
            royalty_earned: royalty,
        });
    }

    /// Claim accrued royalties from vault. Character owner only.
    public entry fun claim_royalties(
        collection: &mut CharacterCollection,
        character: &mut Character,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == character.owner, ENotOwner);

        let claimable = character.accrued_royalties - character.claimed_royalties;
        assert!(claimable > 0, ENothingToClaim);
        assert!(balance::value(&collection.vault) >= claimable, EInsufficientVault);

        // Withdraw from vault and send to owner
        let withdraw = coin::from_balance(balance::split(&mut collection.vault, claimable), ctx);
        transfer::public_transfer(withdraw, character.owner);

        character.claimed_royalties = character.accrued_royalties;
        collection.total_royalties_paid = collection.total_royalties_paid + claimable;

        event::emit(RoyaltiesClaimedEvent {
            character_id: object::id(character),
            owner: character.owner,
            amount: claimable,
        });
    }

    public entry fun transfer_character(
        character: Character,
        recipient: address,
        _ctx: &TxContext,
    ) {
        transfer::public_transfer(character, recipient);
    }
}

#[test_only]
module loar::nft_characters_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::test_utils;
    use sui::coin;
    use sui::sui::SUI;
    use sui::balance;
    use loar::nft_characters;

    const AUTHORITY: address = @0x1;
    const TREASURY: address = @0x2;
    const OWNER: address = @0x3;
    const OUTSIDER: address = @0x99;

    #[test]
    fun test_create_collection() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(
                1,          // universe_id
                TREASURY,
                500_000,    // appearance_royalty
                ts::ctx(&mut scenario),
            );
        };
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            // Collection exists and is shared
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_mint_character() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(2_000_000, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection,
                b"Hero",
                b"ipfs://meta",
                b"content_hash",
                &mut payment,
                1_000_000, // price
                1000,      // timestamp
                ts::ctx(&mut scenario),
            );
            // Price deducted
            assert!(coin::value(&payment) == 1_000_000);
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_record_appearance_deposits_to_vault() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        // Owner mints character
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection,
                b"Hero",
                b"ipfs://meta",
                b"hash",
                &mut payment,
                500_000,
                1000,
                ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Authority records appearance
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            let mut payment = coin::mint_for_testing<SUI>(1_000_000, ts::ctx(&mut scenario));
            nft_characters::record_appearance(
                &mut collection,
                &mut character,
                &mut payment,
                ts::ctx(&mut scenario),
            );
            // 500_000 royalty deducted from payment
            assert!(coin::value(&payment) == 500_000);
            coin::burn_for_testing(payment);
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    fun test_claim_royalties() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        // Mint character as OWNER
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection, b"Hero", b"uri", b"hash",
                &mut payment, 0, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Record appearance (deposits royalty to vault)
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            let mut payment = coin::mint_for_testing<SUI>(500_000, ts::ctx(&mut scenario));
            nft_characters::record_appearance(&mut collection, &mut character, &mut payment, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        // Owner claims royalties
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            nft_characters::claim_royalties(&mut collection, &mut character, ts::ctx(&mut scenario));
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_characters::ENothingToClaim)]
    fun test_claim_nothing() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection, b"Hero", b"uri", b"hash",
                &mut payment, 0, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Claim with 0 accrued — should abort ENothingToClaim
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            nft_characters::claim_royalties(&mut collection, &mut character, ts::ctx(&mut scenario));
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_characters::ENotAuthority)]
    fun test_not_authority_record() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection, b"Hero", b"uri", b"hash",
                &mut payment, 0, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Non-authority attempts record_appearance — should abort
        ts::next_tx(&mut scenario, OUTSIDER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            let mut payment = coin::mint_for_testing<SUI>(500_000, ts::ctx(&mut scenario));
            nft_characters::record_appearance(&mut collection, &mut character, &mut payment, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = loar::nft_characters::ENotOwner)]
    fun test_not_owner_claim() {
        let mut scenario = ts::begin(AUTHORITY);
        {
            nft_characters::create_collection(1, TREASURY, 500_000, ts::ctx(&mut scenario));
        };
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut payment = coin::mint_for_testing<SUI>(0, ts::ctx(&mut scenario));
            nft_characters::mint_character(
                &mut collection, b"Hero", b"uri", b"hash",
                &mut payment, 0, 1000, ts::ctx(&mut scenario),
            );
            coin::burn_for_testing(payment);
            ts::return_shared(collection);
        };
        // Record appearance first so there's something to claim
        ts::next_tx(&mut scenario, AUTHORITY);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            let mut payment = coin::mint_for_testing<SUI>(500_000, ts::ctx(&mut scenario));
            nft_characters::record_appearance(&mut collection, &mut character, &mut payment, ts::ctx(&mut scenario));
            coin::burn_for_testing(payment);
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        // Non-owner attempts claim — should abort ENotOwner
        ts::next_tx(&mut scenario, OUTSIDER);
        {
            let mut collection = ts::take_shared<nft_characters::CharacterCollection>(&scenario);
            let mut character = ts::take_from_address<nft_characters::Character>(&scenario, OWNER);
            nft_characters::claim_royalties(&mut collection, &mut character, ts::ctx(&mut scenario));
            ts::return_to_address(OWNER, character);
            ts::return_shared(collection);
        };
        ts::end(scenario);
    }
}
