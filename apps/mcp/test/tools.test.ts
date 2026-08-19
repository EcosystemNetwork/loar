import { describe, expect, it, vi } from 'vitest';
import { ALL_TOOLS, type ToolDefinition } from '../src/tools';

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
};

function createClient(): FakeClient {
  return {
    query: vi.fn().mockResolvedValue({}),
    mutate: vi.fn().mockResolvedValue({}),
  };
}

function findTool(name: string): ToolDefinition {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('MCP tools', () => {
  it('registers expected tools', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(ALL_TOOLS.length).toBeGreaterThan(0);
    expect(names).toEqual(
      expect.arrayContaining([
        'loar_create_entity',
        'loar_generate_video',
        'loar_list_universes',
        'loar_submit_to_canon',
      ])
    );
  });

  it('createEntity mutates entities.create', async () => {
    const tool = findTool('loar_create_entity');
    const client = createClient();
    await tool.handler(client as any, { name: 'Hero', description: 'A hero', kind: 'person' });
    expect(client.mutate).toHaveBeenCalledWith('entities.create', {
      name: 'Hero',
      description: 'A hero',
      kind: 'person',
    });
  });

  it('listEntities queries entities.list', async () => {
    const tool = findTool('loar_list_entities');
    const client = createClient();
    await tool.handler(client as any, { universeAddress: '0x123' });
    expect(client.query).toHaveBeenCalledWith('entities.list', { universeAddress: '0x123' });
  });
});
