/**
 * ENS HTTP surface.
 *
 * Public resolver helpers (mirrors the Unstoppable Domains route):
 *   GET /api/ens/reverse/:address  → { name, avatar }
 *   GET /api/ens/resolve/:name     → { address, profile }
 *   GET /api/ens/agent/:name       → ENSIP-25/26 agent card
 *
 * CCIP-Read gateway (EIP-3668) for offchain agent subnames:
 *   GET /api/ens/ccip/:sender/:data → { data }  (signed offchain answer)
 *
 * The gateway answers `addr(node)` and `text(node,key)` for names under the
 * agent parent (e.g. *.agents.loar.eth) from Firestore, signing each response
 * with the platform key so LoarAgentResolver.sol can verify it on-chain. This
 * gives an entire agent fleet gasless, verifiable ENS identities.
 */
import { Hono } from 'hono';
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  hexToBytes,
  slice,
  type Hex,
} from 'viem';
import { lookupAddress, resolveName, getProfile, getAgentCard } from '../lib/ens';
import { resolveManagedName } from '../lib/ens-agent-registry';
import { getSigner } from '../lib/signer';

export const ensRoutes = new Hono();

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// ── Public resolver helpers ────────────────────────────────────────────────

ensRoutes.get('/reverse/:address', async (c) => {
  const address = c.req.param('address');
  if (!ADDR_RE.test(address)) return c.json({ error: 'invalid address' }, 400);
  const name = await lookupAddress(address);
  let avatar: string | null = null;
  if (name) {
    const profile = await getProfile(name);
    avatar = profile?.avatar ?? null;
  }
  return c.json({ name, avatar });
});

ensRoutes.get('/resolve/:name', async (c) => {
  const name = c.req.param('name');
  const profile = await getProfile(name);
  return c.json({ address: profile?.address ?? (await resolveName(name)), profile });
});

ensRoutes.get('/agent/:name', async (c) => {
  const name = c.req.param('name');
  const card = await getAgentCard(name);
  if (!card) return c.json({ error: 'invalid name' }, 400);
  return c.json(card);
});

// ── CCIP-Read gateway (EIP-3668) ────────────────────────────────────────────

// Minimal ABIs for decoding the offchain-lookup request.
const RESOLVE_SERVICE_ABI = [
  {
    name: 'resolve',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

const ADDR_SELECTOR = '0x3b3b57de'; // addr(bytes32)
const ADDR_COINTYPE_SELECTOR = '0xf1cb7e06'; // addr(bytes32,uint256)
const TEXT_SELECTOR = '0x59d1d43c'; // text(bytes32,string)

const TEXT_INNER_ABI = [
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

/** Decode a DNS-wire-format name (length-prefixed labels) to a dotted string. */
function dnsDecode(nameHex: Hex): string {
  const bytes = hexToBytes(nameHex);
  const labels: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const len = bytes[i];
    i += 1;
    if (len === 0) break;
    labels.push(new TextDecoder().decode(bytes.slice(i, i + len)));
    i += len;
  }
  return labels.join('.');
}

ensRoutes.get('/ccip/:sender/:data', async (c) => {
  const sender = c.req.param('sender');
  let request = c.req.param('data');
  // The gateway URL template may append .json — tolerate it.
  if (request.endsWith('.json')) request = request.slice(0, -5);
  if (!ADDR_RE.test(sender) || !/^0x[0-9a-fA-F]+$/.test(request)) {
    return c.json({ message: 'bad request' }, 400);
  }

  try {
    // 1. Decode the outer resolve(name, data) call.
    const { args } = decodeFunctionData({
      abi: RESOLVE_SERVICE_ABI,
      data: request as Hex,
    });
    const dnsName = args[0] as Hex;
    const inner = args[1] as Hex;
    const fullName = dnsDecode(dnsName);

    // 2. Look up the managed subname (null → unknown name; answer empty).
    const record = await resolveManagedName(fullName);

    // 3. Compute the inner resolver result.
    const selector = slice(inner, 0, 4).toLowerCase();
    let result: Hex;
    if (selector === ADDR_SELECTOR || selector === ADDR_COINTYPE_SELECTOR) {
      const addr = (record?.address as Hex) ?? '0x0000000000000000000000000000000000000000';
      result =
        selector === ADDR_SELECTOR
          ? encodeAbiParameters([{ type: 'address' }], [addr])
          : encodeAbiParameters([{ type: 'bytes' }], [addr]); // coin-type addr returns bytes
    } else if (selector === TEXT_SELECTOR) {
      const { args: textArgs } = decodeFunctionData({ abi: TEXT_INNER_ABI, data: inner });
      const key = textArgs[1] as string;
      const value = record?.texts?.[key] ?? '';
      result = encodeAbiParameters([{ type: 'string' }], [value]);
    } else {
      // Unsupported record type — return empty bytes (resolver yields zero).
      result = '0x';
    }

    // 4. Sign per the ENS OffchainResolver scheme:
    //    keccak256(0x1900 ‖ resolver ‖ expires ‖ keccak256(request) ‖ keccak256(result))
    const expires = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min
    const digest = keccak256(
      encodePacked(
        ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
        ['0x1900', sender as Hex, expires, keccak256(request as Hex), keccak256(result)]
      )
    );
    const { account } = await getSigner(1);
    if (!account.sign) throw new Error('signer cannot sign raw digests');
    const signature = await account.sign({ hash: digest });

    const data = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
      [result, expires, signature]
    );
    return c.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gateway error';
    return c.json({ message }, 500);
  }
});
