/** Description + social links parsed from a token's on-chain metadata (see lib/token-metadata). */
import { useMemo } from 'react';
import { Globe, Send } from 'lucide-react';
import { parseTokenMetadata, type SocialPlatform } from '@/lib/token-metadata';

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const META: Record<
  SocialPlatform,
  { label: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  website: { label: 'Website', Icon: Globe },
  twitter: { label: 'X', Icon: XIcon },
  telegram: { label: 'Telegram', Icon: Send },
};

export function TokenSocialLinks({
  metadata,
  showDescription = true,
}: {
  metadata: string | null | undefined;
  showDescription?: boolean;
}) {
  const { description, socials } = useMemo(() => parseTokenMetadata(metadata), [metadata]);
  const links = (Object.keys(socials) as SocialPlatform[]).filter((p) => socials[p]);
  if (!description && links.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {showDescription && description && (
        <p className="text-sm text-muted-foreground max-w-2xl break-words">{description}</p>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {links.map((p) => {
            const { label, Icon } = META[p];
            return (
              <a
                key={p}
                href={socials[p]}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
