/**
 * ActiveEditorsBadges — Shows who is currently editing an entity.
 *
 * Displays colored avatar badges with wallet addresses/names,
 * and what field each editor is currently working on.
 */
import { Badge } from '@/components/ui/badge';
import { Circle } from 'lucide-react';
import type { ActiveEditor } from '@/hooks/useCollaborativeEntity';

const EDITOR_COLORS = [
  'text-blue-500',
  'text-green-500',
  'text-purple-500',
  'text-orange-500',
  'text-pink-500',
  'text-cyan-500',
  'text-yellow-500',
  'text-red-500',
];

interface ActiveEditorsBadgesProps {
  editors: ActiveEditor[];
  currentUserId?: string;
  isConnected: boolean;
}

export function ActiveEditorsBadges({
  editors,
  currentUserId,
  isConnected,
}: ActiveEditorsBadgesProps) {
  if (editors.length === 0 && !isConnected) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Connection indicator */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Circle
          className={`h-2 w-2 fill-current ${isConnected ? 'text-green-500' : 'text-red-500'}`}
        />
        {isConnected ? 'Live' : 'Reconnecting...'}
      </div>

      {/* Editor badges */}
      {editors.map((editor, i) => {
        const isYou = editor.userId === currentUserId;
        const color = EDITOR_COLORS[i % EDITOR_COLORS.length];

        return (
          <Badge
            key={editor.sessionId}
            variant="outline"
            className="text-xs flex items-center gap-1 py-0.5"
          >
            <Circle className={`h-2 w-2 fill-current ${color}`} />
            <span>{isYou ? 'You' : editor.displayName}</span>
            {editor.activeField && (
              <span className="text-muted-foreground">editing {editor.activeField}</span>
            )}
          </Badge>
        );
      })}

      {editors.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {editors.length} editor{editors.length !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
