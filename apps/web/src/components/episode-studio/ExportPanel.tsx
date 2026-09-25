/**
 * ExportPanel — pick a format, render the episode, and share the result.
 *
 * Purely presentational: the Studio page owns the job, this shows it. The job
 * survives navigation (the page resumes it), so the copy says progress keeps
 * going if you leave.
 */
import { Check, Copy, Download, ExternalLink, Loader2, Upload } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ExportSettings } from '@/lib/episodeCut';
import { Segmented } from './Segmented';

const ASPECTS: Array<{ id: ExportSettings['aspect']; label: string }> = [
  { id: '16:9', label: '16:9 Landscape' },
  { id: '9:16', label: '9:16 Vertical' },
  { id: '1:1', label: '1:1 Square' },
];
const RESOLUTIONS: Array<{ id: ExportSettings['resolution']; label: string }> = [
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p' },
];
const FRAMINGS: Array<{ id: ExportSettings['framing']; label: string }> = [
  { id: 'fit', label: 'Fit (letterbox)' },
  { id: 'fill', label: 'Fill (crop)' },
];

/** Server job stages → what a creator reads. */
export const EXPORT_STAGE_LABELS: Record<string, string> = {
  queued: 'Waiting to start',
  downloading: 'Preparing clips',
  concatenating: 'Joining clips',
  finishing: 'Adding captions and soundtrack',
  uploading: 'Uploading your episode',
};

interface ExportPanelProps {
  settings: ExportSettings;
  onSettingsChange: (settings: ExportSettings) => void;
  hasClips: boolean;
  exporting: boolean;
  progress: number;
  stage?: string;
  warnings: string[];
  exportedUrl?: string | null;
  isCanon: boolean;
  universeId: string;
  episodeId: string;
  copied: boolean;
  onExport: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
}

export function ExportPanel({
  settings,
  onSettingsChange,
  hasClips,
  exporting,
  progress,
  stage,
  warnings,
  exportedUrl,
  isCanon,
  universeId,
  episodeId,
  copied,
  onExport,
  onDownload,
  onCopyLink,
}: ExportPanelProps) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)));
  const stageLabel = (stage && EXPORT_STAGE_LABELS[stage]) || 'Rendering';

  return (
    <Card className="mt-6 space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Export</h2>
        <p className="text-xs text-muted-foreground">
          Renders one MP4 with your cuts, fades, captions and soundtrack. Exports run on our servers
          — you can leave this page and it will keep going.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented
          label="Aspect ratio"
          value={settings.aspect}
          options={ASPECTS}
          onChange={(aspect) => onSettingsChange({ ...settings, aspect })}
        />
        <Segmented
          label="Resolution"
          value={settings.resolution}
          options={RESOLUTIONS}
          onChange={(resolution) => onSettingsChange({ ...settings, resolution })}
        />
        <Segmented
          label="Framing"
          value={settings.framing}
          options={FRAMINGS}
          onChange={(framing) => onSettingsChange({ ...settings, framing })}
        />
      </div>
      {settings.aspect !== '16:9' && (
        <p className="text-xs text-muted-foreground">
          {settings.framing === 'fit'
            ? 'Clips keep their whole picture with black bars where the shapes differ.'
            : 'Clips are cropped to fill the frame — edges may be cut off.'}
        </p>
      )}

      {exporting && (
        <div className="space-y-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {stageLabel}…
            </span>
            <span className="tabular-nums text-muted-foreground">{pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Export progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="h-2 overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full bg-primary transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {exportedUrl && !exporting && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-medium">Your episode is ready</p>
          <video
            src={exportedUrl}
            controls
            playsInline
            preload="metadata"
            className="mx-auto max-h-80 w-full rounded-md bg-black"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onDownload}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download MP4
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onCopyLink}>
              {copied ? (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" />
              )}
              {copied ? 'Link copied' : 'Copy watch link'}
            </Button>
            <Button type="button" size="sm" variant="ghost" asChild>
              <Link to="/episode/$id" params={{ id: episodeId }}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open watch page
              </Link>
            </Button>
          </div>
          {!isCanon && (
            <p className="text-xs text-muted-foreground">
              Only you and this universe’s collaborators can open the link until the episode is
              published as canon —{' '}
              <Link
                to="/universe/$id"
                params={{ id: universeId }}
                className="underline underline-offset-2"
              >
                publish it from the universe page
              </Link>
              .
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button disabled={!hasClips || exporting} onClick={onExport}>
          {exporting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Exporting {pct}%
            </>
          ) : (
            <>
              <Upload className="mr-1.5 h-4 w-4" />
              {exportedUrl ? 'Export again' : 'Export episode'}
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
