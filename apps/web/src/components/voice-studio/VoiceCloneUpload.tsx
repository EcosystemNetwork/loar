/**
 * Voice Studio — Clone tab.
 *
 * Drag-and-drop audio samples (1–25 files, mp3/wav/ogg/flac) → name + describe
 * → ElevenLabs instant clone → registers in My Voices with a TTS preview.
 *
 * The actual upload goes through the existing POST /api/upload Hono endpoint
 * (same one DirectUpload uses), which returns Pinata-backed permanent URLs.
 * Then we hand those URLs to voice.cloneVoice with saveToMyVoices=true.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, Trash2, Loader2, Mic } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Sample {
  id: string;
  filename: string;
  status: 'uploading' | 'ready' | 'failed';
  url?: string;
  error?: string;
}

const ACCEPT = 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/flac';
const MAX_SAMPLES = 25;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

export function VoiceCloneUpload() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [previewText, setPreviewText] = useState(
    'Here is what I sound like when given a few sentences to read aloud.'
  );

  const cloneMutation = useMutation({
    mutationFn: () =>
      trpcClient.voice.cloneVoice.mutate({
        name,
        description: description.trim() || undefined,
        audioUrls: samples.filter((s) => s.url).map((s) => s.url!),
        saveToMyVoices: true,
        previewText: previewText.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Voice cloned: ${result.name}`);
      // Reset form
      setSamples([]);
      setName('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['voiceLibrary', 'myVoices'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    // Pre-flight auth check — same pattern as sandbox.tsx
    const meRes = await fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' });
    if (!meRes.ok || !(await meRes.json())?.authenticated) {
      throw new Error('Session expired — please sign in again');
    }
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${SERVER_URL}/api/upload`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    const json = await res.json();
    const url: string | undefined = json?.uploads?.[0]?.url || json?.url;
    if (!url) throw new Error('Upload returned no URL');
    return url;
  }, []);

  const onFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (samples.length + arr.length > MAX_SAMPLES) {
        toast.error(`Max ${MAX_SAMPLES} samples`);
        return;
      }

      const next: Sample[] = arr.map((f) => ({
        id: `${Date.now()}-${f.name}`,
        filename: f.name,
        status: 'uploading',
      }));
      setSamples((s) => [...s, ...next]);

      // Upload in parallel
      await Promise.all(
        arr.map(async (file, i) => {
          const sampleId = next[i].id;
          try {
            const url = await uploadFile(file);
            setSamples((s) =>
              s.map((x) => (x.id === sampleId ? { ...x, url, status: 'ready' } : x))
            );
          } catch (err) {
            setSamples((s) =>
              s.map((x) =>
                x.id === sampleId
                  ? {
                      ...x,
                      status: 'failed',
                      error: err instanceof Error ? err.message : 'Upload failed',
                    }
                  : x
              )
            );
            toast.error(`${file.name}: ${err instanceof Error ? err.message : 'failed'}`);
          }
        })
      );
    },
    [samples.length, uploadFile]
  );

  function remove(id: string) {
    setSamples((s) => s.filter((x) => x.id !== id));
  }

  const readyCount = samples.filter((s) => s.status === 'ready').length;
  const canClone = readyCount >= 1 && name.trim().length > 0 && !cloneMutation.isPending;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mic className="size-4" /> Voice samples
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DropZone onFiles={onFiles}>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Upload className="size-6 text-muted-foreground" />
              <p className="text-sm">Drop audio files here, or click to browse</p>
              <p className="text-xs text-muted-foreground">
                1–{MAX_SAMPLES} files · mp3, wav, ogg, flac
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="mx-auto"
              onClick={() => fileInputRef.current?.click()}
            >
              Browse files
            </Button>
          </DropZone>

          {samples.length > 0 ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {samples.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
                >
                  <span className="truncate">{s.filename}</span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {s.status === 'uploading' ? (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    ) : s.status === 'failed' ? (
                      <span className="text-xs text-destructive">{s.error || 'failed'}</span>
                    ) : (
                      <span className="text-xs text-emerald-500">ready</span>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => remove(s.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Clone settings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label htmlFor="clone-name">Voice name</Label>
            <Input
              id="clone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., My Own Narrator"
              maxLength={80}
            />
          </div>
          <div>
            <Label htmlFor="clone-desc">Description (optional)</Label>
            <Textarea
              id="clone-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A few notes — what makes this voice distinctive?"
              rows={3}
              maxLength={500}
            />
          </div>
          <div>
            <Label htmlFor="clone-preview">Preview line</Label>
            <Textarea
              id="clone-preview"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              rows={2}
              maxLength={280}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              We'll render this with the cloned voice so you can hear how it sounds.
            </p>
          </div>
          <Button onClick={() => cloneMutation.mutate()} disabled={!canClone}>
            {cloneMutation.isPending ? (
              <>
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                Cloning…
              </>
            ) : (
              `Clone voice (${readyCount} sample${readyCount === 1 ? '' : 's'})`
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DropZone({
  children,
  onFiles,
}: {
  children: React.ReactNode;
  onFiles: (files: FileList) => void | Promise<void>;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      className={`rounded border-2 border-dashed p-4 transition-colors ${
        dragging ? 'border-primary bg-primary/5' : 'border-border'
      }`}
    >
      {children}
    </div>
  );
}
