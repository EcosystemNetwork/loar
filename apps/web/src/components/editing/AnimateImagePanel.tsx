/**
 * AnimateImagePanel — PRD 8 image-to-video flow
 *
 * Animates a stored image into a short clip using a curated motion preset
 * (push-in, orbit, crash zoom, dolly, walk-up). Mutates `generation.generate`
 * in image_to_video mode with the underlying camera preset.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Sparkles,
  ArrowRight,
  RotateCw,
  ZoomIn,
  ArrowLeft,
  Footprints,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';

type MotionPresetId = 'push_in' | 'orbit' | 'crash_zoom' | 'dolly' | 'walk_up';
type Intensity = 'subtle' | 'standard' | 'pronounced';

const MOTION_PRESETS: Array<{
  id: MotionPresetId;
  label: string;
  description: string;
  icon: React.ReactNode;
  // Underlying camera preset registry IDs from scene-controls (per intensity)
  cameraByIntensity: Record<Intensity, { cameraPreset: string; cameraIntensity: Intensity }>;
}> = [
  {
    id: 'push_in',
    label: 'Push In',
    description: 'Slow steady push toward subject',
    icon: <ArrowRight className="w-4 h-4" />,
    cameraByIntensity: {
      subtle: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'dolly_in_slow', cameraIntensity: 'pronounced' },
    },
  },
  {
    id: 'orbit',
    label: 'Orbit',
    description: 'Camera circles around subject',
    icon: <RotateCw className="w-4 h-4" />,
    cameraByIntensity: {
      subtle: { cameraPreset: 'orbit_right_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'orbit_right_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'orbit_right_fast', cameraIntensity: 'standard' },
    },
  },
  {
    id: 'crash_zoom',
    label: 'Crash Zoom',
    description: 'Aggressive snap-zoom — comedic / shock',
    icon: <ZoomIn className="w-4 h-4" />,
    cameraByIntensity: {
      subtle: { cameraPreset: 'crash_zoom', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'crash_zoom', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'crash_zoom', cameraIntensity: 'pronounced' },
    },
  },
  {
    id: 'dolly',
    label: 'Dolly Out',
    description: 'Camera pulls back to reveal',
    icon: <ArrowLeft className="w-4 h-4" />,
    cameraByIntensity: {
      subtle: { cameraPreset: 'dolly_out_slow', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'dolly_out_slow', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'dolly_out_fast', cameraIntensity: 'standard' },
    },
  },
  {
    id: 'walk_up',
    label: 'Walk Up',
    description: 'POV approach with footstep cadence',
    icon: <Footprints className="w-4 h-4" />,
    cameraByIntensity: {
      subtle: { cameraPreset: 'walk_up', cameraIntensity: 'subtle' },
      standard: { cameraPreset: 'walk_up', cameraIntensity: 'standard' },
      pronounced: { cameraPreset: 'walk_up', cameraIntensity: 'pronounced' },
    },
  },
];

interface AnimateImagePanelProps {
  imageUrl: string | null;
  onComplete: (videoUrl: string) => void;
}

export function AnimateImagePanel({ imageUrl, onComplete }: AnimateImagePanelProps) {
  const [presetId, setPresetId] = useState<MotionPresetId>('push_in');
  const [intensity, setIntensity] = useState<Intensity>('standard');
  const [prompt, setPrompt] = useState('');
  const [durationSec, setDurationSec] = useState(5);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');

  const animate = useMutation({
    mutationFn: async () => {
      if (!imageUrl) throw new Error('Load an image first');
      const preset = MOTION_PRESETS.find((p) => p.id === presetId)!;
      const camera = preset.cameraByIntensity[intensity];
      const finalPrompt =
        prompt.trim() ||
        `Cinematic ${preset.label.toLowerCase()} on the subject, ${preset.description.toLowerCase()}`;

      return await trpcClient.generation.generate.mutate({
        prompt: finalPrompt,
        mode: 'image_to_video',
        imageUrl,
        durationSec,
        resolution: '720p',
        aspectRatio,
        audio: false,
        routingMode: 'auto',
        cameraPreset: camera.cameraPreset,
        cameraIntensity: camera.cameraIntensity,
      } as any);
    },
    onSuccess: (r: any) => {
      const url = r?.videoUrl;
      if (!url) {
        toast.error('No video returned');
        return;
      }
      toast.success('Image animated');
      onComplete(url);
    },
    onError: (err: any) => toast.error(err?.message || 'Animation failed'),
  });

  return (
    <div className="space-y-3">
      {!imageUrl && (
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-amber-400">Load an image in the Input tab to animate it.</p>
        </Card>
      )}

      {/* Motion preset grid */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Motion preset</label>
        <div className="grid grid-cols-2 gap-2">
          {MOTION_PRESETS.map((p) => {
            const active = presetId === p.id;
            return (
              <Button
                key={p.id}
                variant={active ? 'default' : 'outline'}
                size="sm"
                className="h-auto py-2 px-3 justify-start text-left"
                onClick={() => setPresetId(p.id)}
              >
                <div className="flex items-start gap-2 w-full">
                  <span className="mt-0.5 text-purple-400">{p.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {p.description}
                    </div>
                  </div>
                </div>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Intensity */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Intensity</label>
        <div className="flex gap-2">
          {(['subtle', 'standard', 'pronounced'] as Intensity[]).map((i) => (
            <Button
              key={i}
              variant={intensity === i ? 'default' : 'outline'}
              size="sm"
              className="flex-1 capitalize text-xs"
              onClick={() => setIntensity(i)}
            >
              {i}
            </Button>
          ))}
        </div>
      </div>

      {/* Aspect ratio */}
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Aspect</label>
        <div className="flex gap-2">
          {(['16:9', '9:16', '1:1'] as const).map((a) => (
            <Button
              key={a}
              variant={aspectRatio === a ? 'default' : 'outline'}
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setAspectRatio(a)}
            >
              {a}
            </Button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Duration ({durationSec}s)
        </label>
        <Slider
          value={[durationSec]}
          onValueChange={([v]) => setDurationSec(v)}
          min={3}
          max={10}
          step={1}
        />
      </div>

      {/* Optional prompt override */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Scene description (optional)
        </label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Override the auto-generated motion description..."
          className="text-xs min-h-[60px]"
        />
      </div>

      <Button
        className="w-full"
        disabled={!imageUrl || animate.isPending}
        onClick={() => animate.mutate()}
      >
        {animate.isPending ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Animating ({durationSec}s clip)...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4 mr-2" />
            Animate Image
          </>
        )}
      </Button>

      {animate.data?.videoUrl && (
        <Card className="p-2 mt-2 border-green-500/20 bg-green-500/5">
          <Badge variant="secondary" className="text-[9px] mb-1">
            Linked to source image
          </Badge>
          <video src={animate.data.videoUrl} controls className="w-full rounded max-h-48" />
        </Card>
      )}
    </div>
  );
}
