/**
 * Small pieces of the character page header: identity chips pulled straight
 * from metadata, and a bio that collapses when it runs long.
 */
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { UserText } from '@/components/user-text';

/** [label, metadata keys to read in order] — spec keys first, then older seeded ones. */
const CHIP_FIELDS: Array<[string, string[]]> = [
  ['Role', ['role']],
  ['Faction', ['affiliations', 'faction']],
  ['Species', ['ancestry', 'species']],
  ['Status', ['status']],
  ['Age', ['age']],
];

/** Chips are for glanceable facts — anything sentence-length belongs in the dossier below. */
const MAX_CHIP_LENGTH = 48;

export function characterChips(
  metadata: Record<string, unknown> | null | undefined
): Array<{ label: string; value: string }> {
  const md = metadata ?? {};
  const chips: Array<{ label: string; value: string }> = [];
  for (const [label, keys] of CHIP_FIELDS) {
    for (const k of keys) {
      const value =
        typeof md[k] === 'string' || typeof md[k] === 'number' ? String(md[k]).trim() : '';
      if (value && value.length <= MAX_CHIP_LENGTH && !/^[-–—?.]+$/.test(value)) {
        chips.push({ label, value });
        break;
      }
    }
  }
  return chips;
}

export function CharacterChips({
  metadata,
}: {
  metadata: Record<string, unknown> | null | undefined;
}) {
  const chips = characterChips(metadata);
  if (chips.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-6 pb-1" aria-label="Character summary">
      {chips.map((c) => (
        <li key={c.label}>
          <Badge variant="outline" className="gap-1.5 font-normal">
            <span className="text-muted-foreground">{c.label}</span>
            <span className="font-medium">{c.value}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const CLAMP_AT = 420;

export function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_AT;
  return (
    <div>
      <p
        className={`text-muted-foreground leading-relaxed break-words ${
          long && !open ? 'line-clamp-5' : ''
        }`}
      >
        <UserText>{text}</UserText>
      </p>
      {long && (
        <button
          type="button"
          className="mt-2 text-sm font-medium text-primary hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}
