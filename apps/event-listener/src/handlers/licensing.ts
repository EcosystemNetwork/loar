/**
 * LicensingRegistry handlers.
 * Events: LicenseCreated, LicenseActivated, LicenseRevoked.
 * LicenseCreated omits licensor + royaltyBps → read from `licenses()` struct.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type License } from '../schema.js';
import type { Handler } from './types.js';

const licenseCreatedEvent = parseAbiItem(
  'event LicenseCreated(uint256 indexed licenseId, uint256 indexed universeId, uint8 licenseType, address indexed licensee, uint256 upfrontFee)'
);
const licenseActivatedEvent = parseAbiItem('event LicenseActivated(uint256 indexed licenseId)');
const licenseRevokedEvent = parseAbiItem('event LicenseRevoked(uint256 indexed licenseId)');

const licensesAbi = [
  parseAbiItem(
    'function licenses(uint256 id) view returns (uint256, uint256, uint8, uint8, address, address, uint256, uint16, uint256, uint256, uint256, string)'
  ),
] as const;

const licenseCreated: Handler<typeof licenseCreatedEvent> = {
  kind: 'LicensingRegistry',
  event: 'LicenseCreated',
  abi: licenseCreatedEvent,
  async run(ctx) {
    const id = ctx.args.licenseId.toString();
    const lic = (await ctx.client.readContract({
      abi: licensesAbi,
      address: ctx.address,
      functionName: 'licenses',
      args: [ctx.args.licenseId],
    })) as readonly [
      bigint,
      bigint,
      number,
      number,
      Hex,
      Hex,
      bigint,
      number,
      bigint,
      bigint,
      bigint,
      string,
    ];

    const doc: License = {
      id,
      universeId: Number(ctx.args.universeId),
      licenseType: Number(ctx.args.licenseType),
      status: 0, // PROPOSED
      licensor: getAddress(lic[4]).toLowerCase() as Hex,
      licensee: getAddress(ctx.args.licensee).toLowerCase() as Hex,
      upfrontFee: ctx.args.upfrontFee.toString(),
      royaltyBps: Number(lic[7]),
      totalRoyalties: '0',
      startTime: null,
      endTime: null,
      createdAt: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.licenses).doc(id), doc);
  },
};

const licenseActivated: Handler<typeof licenseActivatedEvent> = {
  kind: 'LicensingRegistry',
  event: 'LicenseActivated',
  abi: licenseActivatedEvent,
  async run(ctx) {
    ctx.batcher.update(db.collection(COLLECTIONS.licenses).doc(ctx.args.licenseId.toString()), {
      status: 1,
      startTime: ctx.block.timestamp,
    });
  },
};

const licenseRevoked: Handler<typeof licenseRevokedEvent> = {
  kind: 'LicensingRegistry',
  event: 'LicenseRevoked',
  abi: licenseRevokedEvent,
  async run(ctx) {
    ctx.batcher.update(db.collection(COLLECTIONS.licenses).doc(ctx.args.licenseId.toString()), {
      status: 3,
      endTime: ctx.block.timestamp,
    });
  },
};

export const licensingHandlers: Handler[] = [
  licenseCreated as unknown as Handler,
  licenseActivated as unknown as Handler,
  licenseRevoked as unknown as Handler,
];
