/**
 * Shared zod schema for a `universeAddress` tRPC input field.
 *
 * A universe address is either a lowercased EVM `0x…` address or a
 * case-sensitive Solana base58 PDA (see universe-id.ts) — never constrain it
 * to the EVM hex format here. Four routers (physics, entities, curation,
 * notebook) each hand-rolled their own `/^0x[a-fA-F0-9]{40}$/` regex and
 * every one of them 400'd on a Solana universe until physics was fixed
 * first (7313fae7) and the other three followed later in the same
 * incident (82897e88) — a single shared schema is what stops a fifth
 * router from reintroducing the same bug.
 */
import { z } from 'zod';

export const universeAddressSchema = z.string().min(1, 'Universe address is required');
