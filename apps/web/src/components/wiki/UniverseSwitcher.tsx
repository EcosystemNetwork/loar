import { useMemo, useState } from 'react';
import { ChevronDown, Globe, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SmartImage } from '@/components/SmartImage';
import { cn } from '@/lib/utils';

export interface SwitcherUniverse {
  id: string;
  name?: string;
  image_url?: string;
}

interface UniverseSwitcherProps {
  universes: SwitcherUniverse[];
  /** Currently scoped universe id, if any. */
  value: string | undefined;
  /** Name/cover of the scoped universe when it isn't in `universes` (e.g. private). */
  current?: SwitcherUniverse;
  onChange: (universeId: string | undefined) => void;
}

const MAX_RESULTS = 200;

function UniverseAvatar({ universe, size }: { universe?: SwitcherUniverse; size: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-6 w-6' : 'h-10 w-10';
  if (universe?.image_url) {
    return (
      <SmartImage
        src={universe.image_url}
        alt=""
        decoding="async"
        className={cn(box, 'flex-shrink-0 rounded-md object-cover')}
      />
    );
  }
  return (
    <div
      className={cn(
        box,
        'flex flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500/30 to-purple-500/30'
      )}
    >
      <Globe className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} aria-hidden="true" />
    </div>
  );
}

/**
 * One compact control that replaces the old always-open universe strip:
 * shows the current scope and opens a searchable picker.
 */
export function UniverseSwitcher({ universes, value, current, onChange }: UniverseSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = value ? (universes.find((u) => u.id === value) ?? current) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return universes;
    return universes.filter(
      (u) =>
        String(u.name ?? '')
          .toLowerCase()
          .includes(q) || u.id.toLowerCase().includes(q)
    );
  }, [universes, query]);

  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className="h-11 w-full justify-start gap-2.5 px-3 sm:w-auto sm:min-w-52"
      >
        {value ? (
          <UniverseAvatar universe={selected} size="sm" />
        ) : (
          <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="truncate">
          {value ? (selected?.name ?? 'This universe') : 'All universes'}
        </span>
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a universe</DialogTitle>
            <DialogDescription>
              {universes.length} public universe{universes.length !== 1 ? 's' : ''}. The wiki will
              show only that universe's canon.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search universes…"
              aria-label="Search universes"
              className="pl-9"
            />
          </div>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            {!query.trim() && (
              <button
                type="button"
                onClick={() => pick(undefined)}
                className={cn(
                  'mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !value
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                </div>
                All universes
              </button>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.slice(0, MAX_RESULTS).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    value === u.id
                      ? 'border-violet-500 bg-violet-500/10 text-violet-400'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <UniverseAvatar universe={u} size="md" />
                  <span className="truncate">{u.name || `${u.id.slice(0, 10)}…`}</span>
                </button>
              ))}
            </div>
            {filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No universes match “{query.trim()}”.
              </p>
            )}
            {filtered.length > MAX_RESULTS && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                Showing the first {MAX_RESULTS} of {filtered.length}. Refine your search.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
