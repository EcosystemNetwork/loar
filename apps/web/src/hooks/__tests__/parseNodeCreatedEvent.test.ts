import { describe, it, expect } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, type Log } from 'viem';
import { universeAbi } from '@loar/abis/generated';
import { parseNodeCreatedEvent } from '../useContractSave';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678' as const;

/** Build a receipt log for the Universe ABI's NodeCreated event. */
function nodeCreatedLog(args: Record<string, unknown>): Log {
  const ev = universeAbi.find((e) => e.type === 'event' && e.name === 'NodeCreated') as any;
  const topics = encodeEventTopics({ abi: universeAbi, eventName: 'NodeCreated', args } as any);
  const nonIndexed = ev.inputs.filter((i: any) => !i.indexed);
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((i: any) => args[i.name] as never)
  );
  return { address: ADDR, topics, data } as unknown as Log;
}

function sampleArgs(id: bigint, previous: bigint) {
  const ev = universeAbi.find((e) => e.type === 'event' && e.name === 'NodeCreated') as any;
  const args: Record<string, unknown> = {};
  for (const i of ev.inputs) {
    if (i.name === 'id') args.id = id;
    else if (i.name === 'previous') args.previous = previous;
    else if (i.type === 'address') args[i.name] = ADDR;
    else if (i.type === 'bytes32') args[i.name] = `0x${'ab'.repeat(32)}`;
    else if (i.type === 'bool') args[i.name] = true;
    else if (i.type.startsWith('uint')) args[i.name] = 1n;
    else args[i.name] = '';
  }
  return args;
}

describe('parseNodeCreatedEvent', () => {
  it('extracts the real node id and previous id', () => {
    expect(parseNodeCreatedEvent([nodeCreatedLog(sampleArgs(7n, 3n))])).toEqual({
      nodeId: 7n,
      previous: 3n,
    });
  });

  it('reports previous = 0 for a root node', () => {
    expect(parseNodeCreatedEvent([nodeCreatedLog(sampleArgs(1n, 0n))])).toEqual({
      nodeId: 1n,
      previous: 0n,
    });
  });

  it('skips unrelated logs and still finds NodeCreated', () => {
    const junk = { address: ADDR, topics: [`0x${'11'.repeat(32)}`], data: '0x' } as unknown as Log;
    expect(parseNodeCreatedEvent([junk, nodeCreatedLog(sampleArgs(9n, 8n))])?.nodeId).toBe(9n);
  });

  it('returns null when there is no NodeCreated log', () => {
    expect(parseNodeCreatedEvent([])).toBeNull();
    const junk = { address: ADDR, topics: [`0x${'11'.repeat(32)}`], data: '0x' } as unknown as Log;
    expect(parseNodeCreatedEvent([junk])).toBeNull();
  });

  it('does not throw on malformed log data', () => {
    const bad = { address: ADDR, topics: [], data: '0xdead' } as unknown as Log;
    expect(parseNodeCreatedEvent([bad])).toBeNull();
  });
});
