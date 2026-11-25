/**
 * Node Filter Bar
 *
 * A compact horizontal bar rendered as a ReactFlow Panel.
 * Provides free-text search, canon status filter, arc filter, and video filter.
 */

import { useRef, useEffect, memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, X, Filter, Sparkles, Film, Tag } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import type { NodeFilter } from './types';
import type { ArcDefinition } from './types';

interface NodeFilterBarProps {
  filter: NodeFilter;
  isActive: boolean;
  arcs: ArcDefinition[];
  matchCount: number;
  totalCount: number;
  onSearchTextChange: (text: string) => void;
  onCanonStatusChange: (status: NodeFilter['canonStatus']) => void;
  onArcIdChange: (arcId: string | null) => void;
  onHasVideoChange: (has: NodeFilter['hasVideo']) => void;
  onClear: () => void;
  onClose: () => void;
}

function NodeFilterBarImpl({
  filter,
  isActive,
  arcs,
  matchCount,
  totalCount,
  onSearchTextChange,
  onCanonStatusChange,
  onArcIdChange,
  onHasVideoChange,
  onClear,
  onClose,
}: NodeFilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const activeFilterCount = [
    filter.canonStatus !== 'all',
    filter.arcId !== null,
    filter.hasVideo !== 'all',
  ].filter(Boolean).length;

  return (
    <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-top-2 duration-150">
      <div className="flex items-center gap-2 px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={filter.searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Search nodes..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-[160px]"
        />

        {/* Canon filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs gap-1 ${
                filter.canonStatus !== 'all' ? 'text-yellow-400' : 'text-muted-foreground'
              }`}
            >
              <Sparkles className="h-3 w-3" />
              {filter.canonStatus === 'all'
                ? 'Canon'
                : filter.canonStatus === 'canon'
                  ? 'Canon Only'
                  : 'Non-Canon'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-card border-border">
            <DropdownMenuItem onClick={() => onCanonStatusChange('all')}>
              All Nodes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCanonStatusChange('canon')}>
              Canon Only
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCanonStatusChange('non-canon')}>
              Non-Canon Only
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Video filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 text-xs gap-1 ${
                filter.hasVideo !== 'all' ? 'text-blue-400' : 'text-muted-foreground'
              }`}
            >
              <Film className="h-3 w-3" />
              {filter.hasVideo === 'all'
                ? 'Video'
                : filter.hasVideo === 'yes'
                  ? 'Has Video'
                  : 'No Video'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-card border-border">
            <DropdownMenuItem onClick={() => onHasVideoChange('all')}>All</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onHasVideoChange('yes')}>Has Video</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onHasVideoChange('no')}>No Video</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Arc filter */}
        {arcs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 px-2 text-xs gap-1 ${
                  filter.arcId ? 'text-violet-400' : 'text-muted-foreground'
                }`}
              >
                <Tag className="h-3 w-3" />
                {filter.arcId ? arcs.find((a) => a.id === filter.arcId)?.name || 'Arc' : 'Arc'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-card border-border">
              <DropdownMenuItem onClick={() => onArcIdChange(null)}>All Arcs</DropdownMenuItem>
              <DropdownMenuSeparator />
              {arcs.map((arc) => (
                <DropdownMenuItem key={arc.id} onClick={() => onArcIdChange(arc.id)}>
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
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Status / clear */}
        {isActive && (
          <>
            <div className="text-[10px] text-muted-foreground shrink-0">
              {matchCount}/{totalCount}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-zinc-500 hover:text-foreground"
              onClick={onClear}
              title="Clear filters"
            >
              <X className="h-3 w-3" />
            </Button>
          </>
        )}

        <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
          ESC
        </kbd>
      </div>
    </div>
  );
}

export const NodeFilterBar = memo(NodeFilterBarImpl);
