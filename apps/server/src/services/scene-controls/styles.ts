/**
 * Style Transfer — Branch Inheritance
 *
 * Resolves the effective style for a node by walking ancestors.
 * Used in the generation pipeline to prepend/append style prompts.
 */

import { STYLE_PRESETS, type StylePresetId } from './types';

interface NodeStyleInfo {
  nodeId: string;
  parentId: string | null;
  stylePreset: StylePresetId | null;
  styleInherits: boolean;
}

/**
 * Walk the ancestor chain to find the nearest style preset.
 * Returns null if no ancestor has a style set or inheritance is broken.
 */
export function resolveInheritedStyle(
  nodeId: string,
  nodesMap: Map<string, NodeStyleInfo>
): StylePresetId | null {
  const visited = new Set<string>();
  let current = nodesMap.get(nodeId);

  while (current) {
    if (visited.has(current.nodeId)) break; // cycle protection
    visited.add(current.nodeId);

    // If this node has a style set directly, use it
    if (current.stylePreset) {
      return current.stylePreset;
    }

    // If inheritance is disabled on this node, stop walking
    if (!current.styleInherits) {
      return null;
    }

    // Walk to parent
    if (!current.parentId) break;
    current = nodesMap.get(current.parentId);
  }

  return null;
}

/**
 * Apply style preset to a generation prompt.
 * Prepends the style prefix and appends the style suffix.
 */
export function applyStyleToPrompt(prompt: string, styleId: StylePresetId): string {
  const style = STYLE_PRESETS[styleId];
  if (!style) return prompt;

  const parts: string[] = [];
  if (style.promptPrefix) parts.push(style.promptPrefix);
  parts.push(prompt);
  if (style.promptSuffix) parts.push(style.promptSuffix);

  return parts.join(' ');
}

/**
 * Get style display info for the frontend.
 */
export function getStyleInfo(styleId: StylePresetId) {
  const style = STYLE_PRESETS[styleId];
  if (!style) return null;
  return {
    id: styleId,
    label: style.label,
    color: style.color,
  };
}

/**
 * List all available style presets with their display info.
 */
export function listStylePresets() {
  return Object.entries(STYLE_PRESETS).map(([id, config]) => ({
    id: id as StylePresetId,
    label: config.label,
    color: config.color,
    promptPrefix: config.promptPrefix,
  }));
}
