/**
 * AssetInspector — right panel in the Edit Canvas.
 *
 * Shows source asset metadata (title, kind, universe link, rights class,
 * version number) for the currently opened asset/version.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface BaseVersionLike {
  id: string;
  versionNumber: number;
  label: string;
  mediaType: string;
  mediaUrl: string;
  rightsDeclaration: 'fan' | 'original' | 'licensed' | null;
}

interface ContentLike {
  id: string;
  title: string;
  description: string;
  universeId: string | null;
  classification: 'fan' | 'original' | 'licensed';
  tags: string[];
  creatorUid: string;
}

export function AssetInspector({
  content,
  baseVersion,
  versionCount,
}: {
  content: ContentLike | null;
  baseVersion: BaseVersionLike | null;
  versionCount: number;
}) {
  if (!content || !baseVersion) {
    return (
      <Card className="h-full">
        <CardContent className="p-4 space-y-3 text-sm text-muted-foreground">
          Loading asset…
        </CardContent>
      </Card>
    );
  }

  const rightsLabel = {
    fan: 'Fan / non-commercial',
    original: 'Original IP',
    licensed: 'Rights-cleared',
  }[content.classification];

  return (
    <Card className="h-full">
      <CardContent className="p-4 space-y-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Asset</div>
          <div className="font-medium truncate">{content.title}</div>
          {content.description && (
            <div className="text-xs text-muted-foreground mt-1 line-clamp-3">
              {content.description}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Version
            </div>
            <div className="font-medium">
              v{baseVersion.versionNumber}
              <span className="text-muted-foreground ml-1 text-xs">of {versionCount}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Kind</div>
            <div className="font-medium capitalize">{baseVersion.mediaType.replace('-', ' ')}</div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Rights</div>
          <Badge variant="outline" className="mt-1">
            {rightsLabel}
          </Badge>
        </div>

        {content.universeId && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Universe
            </div>
            <div className="font-mono text-xs truncate">{content.universeId}</div>
          </div>
        )}

        {content.tags.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Tags
            </div>
            <div className="flex flex-wrap gap-1">
              {content.tags.slice(0, 8).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
