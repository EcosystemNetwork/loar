/**
 * UserText — canonical renderer for any text that came from another user.
 *
 * WEB-5: all user-authored copy (bios, wiki entity bodies, comments, universe
 * descriptions, etc.) should go through this component. It enforces three
 * properties:
 *   1. The input is always treated as plain text. No HTML, no MDX, no
 *      markdown-to-HTML. React's default JSX escaping protects against
 *      `<script>` and other tag injection.
 *   2. Autolinks are built from `new URL(...)` and reject any non-http(s)
 *      protocol (javascript:, data:, vbscript:, etc.).
 *   3. Autolink targets always open with `rel="noopener noreferrer nofollow"`
 *      and `target="_blank"` to neutralize tabnabbing and SEO leak.
 *
 * This is intentionally NOT a markdown renderer. If we need formatting later,
 * add a whitelist-based parser (e.g. remark with a strict plugin list) inside
 * this same file so every surface keeps the same guarantees.
 */

import { useMemo } from 'react';

export interface UserTextProps {
  /** Raw text authored by an end user. Assumed untrusted. */
  children: string | null | undefined;
  /** Optional override className passed through to the outer wrapper. */
  className?: string;
  /**
   * When true (default), http(s) URLs in the text are rendered as anchor
   * tags. Turn off for contexts where bare text is preferred (e.g. compact
   * badges).
   */
  autolink?: boolean;
  /** Max characters to render before truncating with an ellipsis. */
  maxLength?: number;
}

// Match bare URLs with an http/https prefix. We intentionally skip protocol-
// relative URLs and unprefixed `example.com` strings — safer to render them
// as text than to guess a scheme.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

interface Chunk {
  kind: 'text' | 'url';
  value: string;
}

function tokenize(input: string): Chunk[] {
  const out: Chunk[] = [];
  let lastIndex = 0;
  URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: 'text', value: input.slice(lastIndex, match.index) });
    }
    out.push({ kind: 'url', value: match[0] });
    lastIndex = URL_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    out.push({ kind: 'text', value: input.slice(lastIndex) });
  }
  return out;
}

function safeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function UserText({ children, className, autolink = true, maxLength }: UserTextProps) {
  const text = useMemo(() => {
    if (children == null) return '';
    let s = String(children);
    if (maxLength != null && s.length > maxLength) {
      s = s.slice(0, maxLength).trimEnd() + '…';
    }
    return s;
  }, [children, maxLength]);

  const chunks = useMemo<Chunk[]>(
    () => (autolink ? tokenize(text) : [{ kind: 'text', value: text }]),
    [text, autolink]
  );

  if (!text) return null;

  return (
    <span className={className}>
      {chunks.map((chunk, idx) => {
        if (chunk.kind === 'text') return <span key={idx}>{chunk.value}</span>;
        const href = safeUrl(chunk.value);
        if (!href) return <span key={idx}>{chunk.value}</span>;
        return (
          <a
            key={idx}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {chunk.value}
          </a>
        );
      })}
    </span>
  );
}

/**
 * Block-level variant — same safety properties, renders inside a `<p>`
 * tag with preserved whitespace so multi-line bios keep their line breaks.
 */
export function UserTextBlock(props: UserTextProps) {
  return (
    <p className={`whitespace-pre-wrap break-words ${props.className ?? ''}`.trim()}>
      <UserText {...props} className={undefined} />
    </p>
  );
}
