import { cn } from '@/lib/utils';
import { WIKI_GROUPS, groupForTab, type WikiTabDef } from './nav';
import type { WikiTab } from './types';

interface WikiNavProps {
  activeTab: WikiTab;
  onSelect: (tab: WikiTab) => void;
  onPrefetch?: (tab: WikiTab) => void;
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Two-level navigation: a row of groups, then the views inside the active
 * group. Selecting a group jumps to its first view; the active view is always
 * reachable in at most two clicks and the second row never has more than 12
 * items.
 */
export function WikiNav({ activeTab, onSelect, onPrefetch }: WikiNavProps) {
  const activeGroup = groupForTab(activeTab);

  return (
    <nav aria-label="Wiki sections" className="mb-6 space-y-3">
      <div
        role="tablist"
        aria-label="Wiki groups"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {WIKI_GROUPS.map((group) => {
          const Icon = group.icon;
          const isActive = group.id === activeGroup.id;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={group.hint}
              onClick={() => {
                if (!isActive) onSelect(group.tabs[0].id);
              }}
              onMouseEnter={() => onPrefetch?.(group.tabs[0].id)}
              onFocus={() => onPrefetch?.(group.tabs[0].id)}
              className={cn(
                'flex min-h-10 flex-shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors',
                focusRing,
                isActive
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {group.label}
            </button>
          );
        })}
      </div>

      {activeGroup.tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={`${activeGroup.label} views`}
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          {activeGroup.tabs.map((tab) => (
            <ViewPill
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTab}
              onClick={() => onSelect(tab.id)}
              onHover={() => onPrefetch?.(tab.id)}
            />
          ))}
        </div>
      )}
    </nav>
  );
}

function ViewPill({
  tab,
  isActive,
  onClick,
  onHover,
}: {
  tab: WikiTabDef;
  isActive: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cn(
        'flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
        focusRing,
        isActive
          ? 'border-primary/40 bg-primary/10 font-medium text-primary'
          : 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground'
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {tab.label}
    </button>
  );
}
