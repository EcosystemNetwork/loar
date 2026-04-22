/**
 * Node Context Menu
 *
 * Right-click menu for individual timeline nodes.
 * Provides quick actions: edit, duplicate, branch, canon toggle,
 * arc assignment, delete, view on-chain, copy hash.
 */

import { useEffect, useRef } from 'react';
import {
  Pencil,
  Copy,
  GitBranch,
  Sparkles,
  Tag,
  Trash2,
  ExternalLink,
  Hash,
  Plus,
  Play,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';
import type { ArcDefinition, ContextMenuState } from './types';

interface NodeContextMenuProps {
  state: ContextMenuState;
  node: Node<TimelineNodeData> | null;
  arcs: ArcDefinition[];
  universeId: string;
  swapMarkNodeId: string | null;
  swapMarkLabel: string | null;
  isSwapping: boolean;
  onClose: () => void;
  onEdit: (eventId: string) => void;
  onDuplicate: (nodeId: string) => void;
  onBranch: (nodeId: string) => void;
  onToggleCanon: (nodeId: string) => void;
  onDelete: (eventId: string) => void;
  onAssignToArc: (arcId: string, nodeIds: string[]) => void;
  onCreateArc: (name: string) => void;
  onPlay: (nodeId: string) => void;
  onMarkForSwap: (nodeId: string) => void;
  onSwapWithMarked: (nodeId: string) => void;
  onClearSwapMark: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
  variant = 'default',
  disabled,
}: MenuItemProps) {
  return (
    <button
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        disabled
          ? 'text-zinc-600 cursor-not-allowed'
          : variant === 'danger'
            ? 'text-red-400 hover:bg-red-500/10'
            : 'text-zinc-300 hover:bg-zinc-800'
      }`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <kbd className="text-[9px] text-zinc-500 bg-zinc-800 px-1 py-0.5 rounded font-mono">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

export function NodeContextMenu({
  state,
  node,
  arcs,
  universeId,
  swapMarkNodeId,
  swapMarkLabel,
  isSwapping,
  onClose,
  onEdit,
  onDuplicate,
  onBranch,
  onToggleCanon,
  onDelete,
  onAssignToArc,
  onCreateArc,
  onPlay,
  onMarkForSwap,
  onSwapWithMarked,
  onClearSwapMark,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape
  useEffect(() => {
    if (!state.visible) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [state.visible, onClose]);

  if (!state.visible || !node) return null;

  const eventId = node.data.eventId || '';
  const isBlockchain = node.id.startsWith('blockchain-node-');
  const hasVideo = !!node.data.videoUrl;
  const canSwap = node.data.blockchainNodeId !== undefined;
  const isMarked = swapMarkNodeId === node.id;
  const hasOtherMark = !!swapMarkNodeId && !isMarked;

  // Clamp position to viewport
  const menuWidth = 220;
  const menuHeight = 380;
  const x = Math.min(state.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(state.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-lg shadow-2xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y, width: menuWidth }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-zinc-800">
        <div className="text-xs font-medium text-zinc-200 truncate">
          {node.data.displayName || node.data.label || `Event ${eventId}`}
        </div>
        {node.data.isInCanonChain && <span className="text-[9px] text-yellow-400">Canon</span>}
      </div>

      {/* Actions */}
      <div className="py-1">
        {hasVideo && (
          <MenuItem
            icon={<Play className="h-3.5 w-3.5" />}
            label="Play Video"
            onClick={() => {
              onPlay(node.id);
              onClose();
            }}
          />
        )}
        <MenuItem
          icon={<Pencil className="h-3.5 w-3.5" />}
          label="Edit Scene"
          shortcut="E"
          onClick={() => {
            onEdit(eventId);
            onClose();
          }}
        />
        <MenuItem
          icon={<Copy className="h-3.5 w-3.5" />}
          label="Duplicate"
          shortcut="D"
          onClick={() => {
            onDuplicate(node.id);
            onClose();
          }}
        />
        <MenuItem
          icon={<GitBranch className="h-3.5 w-3.5" />}
          label="Create Branch"
          onClick={() => {
            onBranch(eventId);
            onClose();
          }}
        />
        <MenuItem
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Add After"
          onClick={() => {
            onBranch(eventId);
            onClose();
          }}
        />
      </div>

      {/* Swap positions — only for on-chain nodes */}
      {canSwap && (
        <div className="border-t border-zinc-800 py-1">
          {hasOtherMark ? (
            <MenuItem
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
              label={isSwapping ? 'Swapping…' : `Swap with ${swapMarkLabel ?? 'marked node'}`}
              disabled={isSwapping}
              onClick={() => {
                onSwapWithMarked(node.id);
                onClose();
              }}
            />
          ) : isMarked ? (
            <MenuItem
              icon={<X className="h-3.5 w-3.5" />}
              label="Clear Swap Mark"
              onClick={() => {
                onClearSwapMark();
                onClose();
              }}
            />
          ) : (
            <MenuItem
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
              label="Mark for Swap"
              onClick={() => {
                onMarkForSwap(node.id);
                onClose();
              }}
            />
          )}
        </div>
      )}

      <div className="border-t border-zinc-800 py-1">
        <MenuItem
          icon={<Sparkles className="h-3.5 w-3.5" />}
          label={node.data.isInCanonChain ? 'Remove from Canon' : 'Set as Canon'}
          shortcut="C"
          onClick={() => {
            onToggleCanon(node.id);
            onClose();
          }}
        />

        {/* Arc submenu */}
        {arcs.length > 0 && (
          <>
            <div className="px-3 py-1 text-[9px] text-zinc-500 uppercase tracking-wider">
              Assign to Arc
            </div>
            {arcs.map((arc) => (
              <button
                key={arc.id}
                className="w-full flex items-center gap-2 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onClick={() => {
                  onAssignToArc(arc.id, [node.id]);
                  onClose();
                }}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: arc.color }}
                />
                <span className="flex-1 text-left">{arc.name}</span>
                {arc.nodeIds.includes(node.id) && (
                  <span className="text-[9px] text-green-400">assigned</span>
                )}
              </button>
            ))}
          </>
        )}
      </div>

      <div className="border-t border-zinc-800 py-1">
        {isBlockchain && (
          <MenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            label="View On-Chain"
            onClick={() => {
              window.open(`https://basescan.org/address/${universeId}`, '_blank');
              onClose();
            }}
          />
        )}
        {node.data.blockchainNodeId !== undefined && (
          <MenuItem
            icon={<Hash className="h-3.5 w-3.5" />}
            label="Copy Node ID"
            onClick={() => {
              navigator.clipboard.writeText(String(node.data.blockchainNodeId));
              onClose();
            }}
          />
        )}
      </div>

      <div className="border-t border-zinc-800 py-1">
        <MenuItem
          icon={<Trash2 className="h-3.5 w-3.5" />}
          label="Delete Node"
          shortcut="Del"
          variant="danger"
          onClick={() => {
            onDelete(eventId);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
