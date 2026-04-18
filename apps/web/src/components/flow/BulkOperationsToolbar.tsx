/**
 * Bulk Operations Toolbar
 *
 * Appears when nodes are multi-selected. Provides batch actions:
 * play, duplicate, assign to arc, toggle canon, audio tools, delete.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  CheckSquare,
  Play,
  Copy,
  Music,
  Waves,
  Megaphone,
  Trash2,
  Tag,
  Sparkles,
  Plus,
  MousePointerSquareDashed,
  CheckCheck,
  Film,
  ScrollText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';
import type { ArcDefinition } from './types';

interface BulkOperationsToolbarProps {
  selectedNodeIds: Set<string>;
  nodes: Node<TimelineNodeData>[];
  arcs: ArcDefinition[];
  hasVideoInSelection: boolean;
  selectedClipsCount: number;
  onPlaySelected: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onToggleCanon: () => void;
  onAssignToArc: (arcId: string) => void;
  onCreateArc: (name: string) => void;
  onShowAudioToolbar: () => void;
  onBuildEpisode: () => void;
  onScriptToEpisode: () => void;
}

export function BulkOperationsToolbar({
  selectedNodeIds,
  nodes,
  arcs,
  hasVideoInSelection,
  selectedClipsCount,
  onPlaySelected,
  onDuplicateSelected,
  onDeleteSelected,
  onClearSelection,
  onSelectAll,
  onInvertSelection,
  onToggleCanon,
  onAssignToArc,
  onCreateArc,
  onShowAudioToolbar,
  onBuildEpisode,
  onScriptToEpisode,
}: BulkOperationsToolbarProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [newArcName, setNewArcName] = useState('');

  if (selectedNodeIds.size === 0) return null;

  if (showDeleteConfirm) {
    return (
      <div className="bg-zinc-900/95 backdrop-blur-md border border-red-900/50 rounded-xl shadow-2xl px-5 py-4 flex flex-col items-center gap-3 animate-in fade-in duration-150">
        <p className="text-sm text-zinc-300">
          Delete <span className="font-bold text-white">{selectedNodeIds.size}</span> node
          {selectedNodeIds.size > 1 ? 's' : ''}?
        </p>
        <p className="text-xs text-zinc-500 max-w-xs text-center">
          Blockchain nodes will be hidden from your timeline. Local-only nodes will be permanently
          removed.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              onDeleteSelected();
              setShowDeleteConfirm(false);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete {selectedNodeIds.size > 1 ? 'All' : ''}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3 animate-in slide-in-from-top-2 duration-200">
      {/* Selection count */}
      <div className="flex items-center gap-2 text-sm text-zinc-300 border-r border-zinc-700 pr-3">
        <CheckSquare className="h-4 w-4 text-blue-400" />
        <span className="font-medium">{selectedNodeIds.size} selected</span>
      </div>

      {/* Selection helpers */}
      <div className="flex items-center gap-1 border-r border-zinc-700 pr-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-zinc-400 hover:text-zinc-200"
          onClick={onSelectAll}
          title="Select all nodes (Ctrl+A)"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs gap-1 text-zinc-400 hover:text-zinc-200"
          onClick={onInvertSelection}
          title="Invert selection"
        >
          <MousePointerSquareDashed className="h-3.5 w-3.5" />
          Invert
        </Button>
      </div>

      {/* Primary actions */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/10"
        onClick={onPlaySelected}
        disabled={!hasVideoInSelection}
        title="Play selected videos in sequence"
      >
        <Play className="h-4 w-4" />
        Play
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
        onClick={onDuplicateSelected}
        title="Duplicate selected (D)"
      >
        <Copy className="h-4 w-4" />
        Duplicate
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10"
        onClick={onToggleCanon}
        title="Toggle canon status (C)"
      >
        <Sparkles className="h-4 w-4" />
        Canon
      </Button>

      {/* Arc assignment */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10"
            title="Assign to arc/group (G)"
          >
            <Tag className="h-4 w-4" />
            Arc
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-zinc-900 border-zinc-700 min-w-[180px]">
          <DropdownMenuLabel className="text-xs text-zinc-500">Assign to Arc</DropdownMenuLabel>
          {arcs.map((arc) => (
            <DropdownMenuItem key={arc.id} onClick={() => onAssignToArc(arc.id)}>
              <div
                className="w-2 h-2 rounded-full mr-2 shrink-0"
                style={{ backgroundColor: arc.color }}
              />
              {arc.name}
              <Badge variant="secondary" className="ml-auto text-[9px] px-1 h-4">
                {arc.nodeIds.length}
              </Badge>
            </DropdownMenuItem>
          ))}
          {arcs.length > 0 && <DropdownMenuSeparator />}
          <div className="px-2 py-1.5">
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (newArcName.trim()) {
                  onCreateArc(newArcName.trim());
                  setNewArcName('');
                }
              }}
            >
              <Input
                value={newArcName}
                onChange={(e) => setNewArcName(e.target.value)}
                placeholder="New arc name..."
                className="h-7 text-xs bg-zinc-800 border-zinc-600"
              />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 shrink-0"
                disabled={!newArcName.trim()}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Audio tools */}
      <div className="border-l border-zinc-700 pl-3 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
          onClick={onShowAudioToolbar}
          disabled={selectedClipsCount === 0}
          title="Add background music"
        >
          <Music className="h-4 w-4" />
          Music
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
          onClick={onShowAudioToolbar}
          disabled={selectedClipsCount === 0}
          title="Add sound effects"
        >
          <Waves className="h-4 w-4" />
          SFX
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
          onClick={onShowAudioToolbar}
          disabled={selectedClipsCount === 0}
          title="Lip sync dialogue"
        >
          <Megaphone className="h-4 w-4" />
          Lip Sync
        </Button>
      </div>

      {/* Script-to-Episode */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10"
        onClick={onScriptToEpisode}
        title="Generate episode from script"
      >
        <ScrollText className="h-4 w-4" />
        Script
      </Button>

      {/* Episode builder */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
        onClick={onBuildEpisode}
        disabled={!hasVideoInSelection}
        title="Build episode from selected clips"
      >
        <Film className="h-4 w-4" />
        Episode
      </Button>

      {/* Delete */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
        onClick={() => setShowDeleteConfirm(true)}
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>

      {/* Clear */}
      <div className="border-l border-zinc-700 pl-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-500 hover:text-zinc-300 text-xs px-2"
          onClick={onClearSelection}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
