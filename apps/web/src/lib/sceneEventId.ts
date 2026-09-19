/**
 * sceneEventId — collision-free id allocation for scenes created in the
 * universe timeline editor.
 *
 * Ids look like the on-chain ones ("1", "2") for the main line and
 * "<parent><letter>" ("1b", "1c") for branches. The previous inline logic
 * counted existing branches with a `startsWith` scan ("1" also matched "12b"),
 * reused a letter once a branch was deleted, and ran past "z". Every id
 * returned here is guaranteed not to be in `existingIds`.
 */

export interface NextSceneEventIdArgs {
  additionType: 'after' | 'branch';
  /** Event id of the node the user clicked "add" on, if any. */
  sourceEventId?: string | null;
  /** Event id of the current tail of the timeline, used when there's no source. */
  lastEventId?: string | null;
  /** Every id already in play: canvas nodes, stored events, on-chain ids. */
  existingIds: Iterable<string>;
}

const BRANCH_ID = /^(\d+)([a-z]+)$/;

function leadingNumber(id: string): number {
  const n = parseInt(id, 10);
  return Number.isNaN(n) ? 0 : n;
}

function firstFree(taken: Set<string>, candidates: Iterable<string>): string | null {
  for (const c of candidates) if (!taken.has(c)) return c;
  return null;
}

function* branchCandidates(base: string, fromCode: number): Generator<string> {
  for (let code = fromCode; code <= 122 /* z */; code++)
    yield `${base}${String.fromCharCode(code)}`;
  for (let n = 2; n < 10_000; n++) yield `${base}b${n}`;
}

export function nextSceneEventId({
  additionType,
  sourceEventId,
  lastEventId,
  existingIds,
}: NextSceneEventIdArgs): string {
  const taken = new Set<string>();
  for (const id of existingIds) taken.add(String(id));

  if (additionType === 'branch' && sourceEventId) {
    return firstFree(taken, branchCandidates(sourceEventId, 98 /* b */))!;
  }

  // Continue a branch ("1b" → "1c") when the reference node is itself a branch.
  const reference = sourceEventId || lastEventId || null;
  const m = reference ? BRANCH_ID.exec(reference) : null;
  if (m) {
    const [, base, letters] = m;
    const next = firstFree(
      taken,
      branchCandidates(base, letters.charCodeAt(letters.length - 1) + 1)
    );
    if (next) return next;
  }

  let max = 0;
  for (const id of taken) max = Math.max(max, leadingNumber(id));
  let n = max + 1;
  while (taken.has(String(n))) n++;
  return String(n);
}
