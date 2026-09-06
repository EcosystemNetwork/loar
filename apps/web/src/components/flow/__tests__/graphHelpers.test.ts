/**
 * Unit tests for the pure graph helpers in flow/types.ts — getSceneNodes,
 * buildParentMap, findRootNodes — used by NodeOutlinePanel, the arc
 * overlay, and the universe editor to reason about the timeline DAG.
 */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { TimelineNodeData } from '../TimelineNodes';
import { buildParentMap, findRootNodes, getSceneNodes } from '../types';

const node = (
  id: string,
  nodeType: TimelineNodeData['nodeType'] = 'scene'
): Node<TimelineNodeData> => ({
  id,
  position: { x: 0, y: 0 },
  data: { nodeType, label: id, description: '' } as TimelineNodeData,
});

const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
});

describe('getSceneNodes', () => {
  it('keeps only nodeType "scene"', () => {
    const nodes = [node('a'), node('add-final', 'add'), node('b'), node('br', 'branch')];
    expect(getSceneNodes(nodes).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('returns [] when there are no scene nodes', () => {
    expect(getSceneNodes([node('x', 'add')])).toEqual([]);
  });
});

describe('buildParentMap', () => {
  it('maps each parent scene node to its child scene node ids', () => {
    const nodes = [node('1'), node('2'), node('3')];
    const edges = [edge('1', '2'), edge('2', '3')];
    const m = buildParentMap(nodes, edges);
    expect(m.get('1')).toEqual(['2']);
    expect(m.get('2')).toEqual(['3']);
    expect(m.has('3')).toBe(false);
  });

  it('collects multiple children under one parent (a branch)', () => {
    const nodes = [node('1'), node('2'), node('3')];
    const edges = [edge('1', '2'), edge('1', '3')];
    expect(buildParentMap(nodes, edges).get('1')).toEqual(['2', '3']);
  });

  it('ignores edges that touch a non-scene node', () => {
    const nodes = [node('1'), node('add', 'add')];
    const edges = [edge('1', 'add')];
    expect(buildParentMap(nodes, edges).size).toBe(0);
  });

  it('ignores edges whose endpoint is not in the node list at all', () => {
    const nodes = [node('1')];
    const edges = [edge('1', 'ghost')];
    expect(buildParentMap(nodes, edges).size).toBe(0);
  });

  it('returns an empty map for no edges', () => {
    expect(buildParentMap([node('1'), node('2')], []).size).toBe(0);
  });
});

describe('findRootNodes', () => {
  it('returns scene nodes with no incoming scene→scene edge', () => {
    const nodes = [node('1'), node('2'), node('3')];
    const edges = [edge('1', '2'), edge('2', '3')];
    expect(findRootNodes(nodes, edges).map((n) => n.id)).toEqual(['1']);
  });

  it('finds every root in a multi-root forest', () => {
    const nodes = [node('1'), node('2'), node('10'), node('11')];
    const edges = [edge('1', '2'), edge('10', '11')];
    expect(
      findRootNodes(nodes, edges)
        .map((n) => n.id)
        .sort()
    ).toEqual(['1', '10']);
  });

  it('treats a node whose only parent edge comes from a non-scene node as a root', () => {
    const nodes = [node('start', 'add'), node('1')];
    const edges = [edge('start', '1')];
    expect(findRootNodes(nodes, edges).map((n) => n.id)).toEqual(['1']);
  });

  it('every scene node is a root when there are no edges', () => {
    const nodes = [node('1'), node('2')];
    expect(findRootNodes(nodes, []).map((n) => n.id)).toEqual(['1', '2']);
  });

  it('a pure cycle has no root', () => {
    const nodes = [node('1'), node('2')];
    const edges = [edge('1', '2'), edge('2', '1')];
    expect(findRootNodes(nodes, edges)).toEqual([]);
  });
});
