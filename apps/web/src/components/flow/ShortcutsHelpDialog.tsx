/**
 * Shortcuts Help Dialog
 *
 * Displays all available keyboard shortcuts for the timeline editor.
 * Rendered as a ReactFlow Panel overlay.
 */

import { X, Keyboard } from 'lucide-react';

interface ShortcutsHelpDialogProps {
  onClose: () => void;
}

const SHORTCUTS = [
  // Navigation & View
  ['Ctrl+K', 'Search & filter nodes'],
  ['F', 'Fit to view'],
  ['1', 'Zoom to 100%'],
  ['+/-', 'Zoom in/out'],
  ['M', 'Toggle minimap'],
  ['O', 'Toggle outline panel'],
  ['?', 'Toggle shortcuts'],
  // Selection
  ['Shift+Click', 'Multi-select'],
  ['Ctrl+A', 'Select all nodes'],
  ['Esc', 'Clear selection / close'],
  // Actions
  ['D', 'Duplicate selected'],
  ['C', 'Toggle canon status'],
  ['E', 'Edit selected node'],
  ['G', 'Assign to arc/group'],
  ['Del', 'Delete selected'],
  // Undo/Redo
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Shift+Z', 'Redo'],
] as const;

export function ShortcutsHelpDialog({ onClose }: ShortcutsHelpDialogProps) {
  return (
    <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl shadow-2xl p-4 animate-in fade-in duration-150 max-w-md">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-white flex items-center gap-2">
          <Keyboard className="h-4 w-4" /> Keyboard Shortcuts
        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
        {SHORTCUTS.map(([key, desc]) => (
          <div key={key} className="flex items-center gap-2">
            <kbd className="text-[10px] text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded font-mono min-w-[60px] text-center">
              {key}
            </kbd>
            <span className="text-zinc-400">{desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
