import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Globe, Lock, Pencil, Plus, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SmartImage } from '@/components/SmartImage';
import { UniverseProfileEditor } from '@/components/UniverseProfileEditor';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import { RandomEntityButton } from './RandomEntityButton';
import { UniverseSwitcher, type SwitcherUniverse } from './UniverseSwitcher';

export interface ScopedUniverse extends SwitcherUniverse {
  accessModel?: string;
  description?: string;
  portrait_image_url?: string;
  isPrivate?: boolean;
  universeType?: 'fun' | 'monetized';
}

interface WikiHeroProps {
  universeAddress: string | undefined;
  universe: ScopedUniverse | undefined;
  universes: SwitcherUniverse[];
  search: string;
  onSearchChange: (value: string) => void;
  onUniverseChange: (universeId: string | undefined) => void;
}

/** True when a key press landed inside something the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Top of the wiki hub: title, one prominent search, universe scope and the
 * two global actions. When scoped to a universe the cover art becomes a
 * banner so it's obvious whose canon is on screen.
 */
export function WikiHero({
  universeAddress,
  universe,
  universes,
  search,
  onSearchChange,
  onUniverseChange,
}: WikiHeroProps) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // Owner (creator / Safe signer) gets an inline profile editor; the server
  // re-checks on save, so this gate is purely cosmetic.
  const admin = useIsUniverseAdmin(universeAddress);
  const canEdit = !!universe && admin.isAdmin && !admin.isLoading;

  // "/" jumps to search, like most wikis.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const createSearch = universeAddress ? { universe: universeAddress } : undefined;

  return (
    <div className="mb-8">
      {universe && (
        <div className="relative mb-6 overflow-hidden rounded-2xl border border-violet-500/30">
          {universe.image_url && (
            <SmartImage
              src={universe.image_url}
              alt=""
              decoding="async"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/70 to-violet-500/10" />
          <div className="relative flex flex-wrap items-center gap-4 p-4 sm:p-5">
            {universe.image_url && (
              <SmartImage
                src={universe.image_url}
                alt=""
                decoding="async"
                className="h-16 w-16 flex-shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/10"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Wiki for
              </p>
              <h2 className="truncate text-2xl font-bold tracking-tight">
                {universe.name ?? 'This universe'}
              </h2>
            </div>
            {universe.accessModel && universe.accessModel !== 'open' && (
              <Badge variant="outline" className="gap-1 text-xs">
                <Lock className="h-3 w-3" aria-hidden="true" />
                {universe.accessModel}
              </Badge>
            )}
            <div className="flex flex-shrink-0 items-center gap-2">
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setEditorOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Edit universe
                </Button>
              )}
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/universe/$id/watch" params={{ id: universe.id }}>
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  Open universe
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1 text-muted-foreground"
                onClick={() => onUniverseChange(undefined)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear
              </Button>
            </div>
          </div>
        </div>
      )}

      {canEdit && universe && (
        <UniverseProfileEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          universe={{
            id: universe.id,
            name: universe.name,
            description: universe.description,
            image_url: universe.image_url,
            portrait_image_url: universe.portrait_image_url,
            isPrivate: universe.isPrivate,
            universeType: universe.universeType,
          }}
        />
      )}

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">World Encyclopedia</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            {universe
              ? `Everything canon in ${universe.name ?? 'this universe'}.`
              : 'Everything known across all public universes.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RandomEntityButton universeAddress={universeAddress} />
          <Button asChild size="sm">
            <Link to="/create" search={createSearch}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              Create
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.preventDefault();
                onSearchChange('');
              }
            }}
            placeholder={
              universe
                ? `Search ${universe.name ?? 'this universe'}…`
                : 'Search characters, places, lore…'
            }
            aria-label="Search the wiki"
            autoComplete="off"
            className="h-11 pl-10 pr-10 text-base"
          />
          {search ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block"
            >
              /
            </kbd>
          )}
        </div>
        <UniverseSwitcher
          universes={universes}
          value={universeAddress}
          current={universe}
          onChange={onUniverseChange}
        />
      </div>
    </div>
  );
}
