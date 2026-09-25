/**
 * AddAudioDialog — bring an audio file (upload or URL) onto an audio track.
 *
 * It only gathers {url, label, duration, loop}; where the clip lands (which
 * track, at the playhead) is the caller's decision, so the same dialog can
 * serve the per-track "+" button and a future drag-and-drop.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DirectUpload } from '@/components/DirectUpload';
import { probeDuration } from '@/hooks/useClipDurations';

export interface AudioSource {
  url: string;
  label: string;
  /** Length of the file in seconds; null when it couldn't be read. */
  duration: number | null;
  /** Repeat the file to fill the space instead of playing once. */
  loop: boolean;
}

interface AddAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown in the description so it's clear which track receives the clip. */
  trackName?: string;
  onAdd: (source: AudioSource) => void;
}

const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
];

function labelFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return name.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60);
  } catch {
    return '';
  }
}

export function AddAudioDialog({ open, onOpenChange, trackName, onAdd }: AddAudioDialogProps) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [loop, setLoop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUrl('');
      setLabel('');
      setLoop(false);
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const valid = /^https?:\/\//i.test(url.trim());

  const submit = async () => {
    const trimmed = url.trim();
    if (!valid) return;
    setBusy(true);
    setError(null);
    // Length is best-effort: a host that won't serve metadata to the browser
    // still works, the caller just falls back to a default clip length.
    const duration = await probeDuration(trimmed);
    setBusy(false);
    onAdd({
      url: trimmed,
      label: label.trim() || labelFromUrl(trimmed) || 'Audio',
      duration,
      loop,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add audio</DialogTitle>
          <DialogDescription>
            {trackName
              ? `Adds a clip to “${trackName}” at the playhead.`
              : 'Adds a clip at the playhead.'}{' '}
            Music, voice-over or sound effects — anything mixes down into the final audio track.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <DirectUpload
            acceptedTypes={AUDIO_TYPES}
            maxSizeMB={100}
            label="Upload an audio file"
            onUploadComplete={(manifest) => {
              const uploaded = manifest.uploads[0]?.url;
              if (uploaded) {
                setUrl(uploaded);
                setError(null);
              } else {
                setError('The upload finished but returned no URL.');
              }
            }}
          />

          <div className="space-y-1.5">
            <Label htmlFor="audio-url">Or paste an audio URL</Label>
            <Input
              id="audio-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://…/track.mp3"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="audio-label">Name</Label>
            <Input
              id="audio-label"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={labelFromUrl(url) || 'Audio'}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={loop} onCheckedChange={(v) => setLoop(v === true)} />
            Loop to fill the episode{' '}
            <span className="text-muted-foreground">(good for music beds)</span>
          </label>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={submit}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Add to track
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
