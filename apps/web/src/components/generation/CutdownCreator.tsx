/**
 * CutdownCreator — AI-powered 9:16 vertical short-form video generator
 *
 * Takes existing landscape content and generates vertical cuts with
 * highlight detection, smart cropping, and optional captions.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scissors,
  Smartphone,
  Subtitles,
  Loader2,
  Play,
  Download,
  Clock,
  Sparkles,
  ChevronDown,
  GripVertical,
} from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useWalletAuth } from '../../lib/wallet-auth';
import { toast } from 'sonner';

interface CutdownCreatorProps {
  sourceVideoUrl?: string;
  sourceContentId?: string;
  universeAddress?: string;
}

type AspectRatio = '9:16' | '1:1' | '4:5';
type Mode = 'auto' | 'highlight' | 'full';
type CaptionStyle = 'default' | 'bold' | 'minimal' | 'karaoke';

const ASPECT_LABELS: Record<AspectRatio, { label: string; icon: string }> = {
  '9:16': { label: 'Vertical (9:16)', icon: '📱' },
  '1:1': { label: 'Square (1:1)', icon: '⬛' },
  '4:5': { label: 'Portrait (4:5)', icon: '📷' },
};

const MODE_LABELS: Record<Mode, { label: string; description: string }> = {
  auto: { label: 'Auto', description: 'AI picks the best moments' },
  highlight: { label: 'Highlight', description: 'First N seconds, reframed' },
  full: { label: 'Full', description: 'Reframe the entire video' },
};

const CAPTION_STYLES: Record<CaptionStyle, string> = {
  default: 'Standard white text',
  bold: 'Large bold with shadow',
  minimal: 'Small, bottom-aligned',
  karaoke: 'Word-by-word highlight',
};

export function CutdownCreator({
  sourceVideoUrl,
  sourceContentId,
  universeAddress,
}: CutdownCreatorProps) {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();

  const [videoUrl, setVideoUrl] = useState(sourceVideoUrl ?? '');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [mode, setMode] = useState<Mode>('auto');
  const [maxDuration, setMaxDuration] = useState(60);
  const [addCaptions, setAddCaptions] = useState(true);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('default');
  const [title, setTitle] = useState('');

  const generate = useMutation(
    trpc.cutdown.generate.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Short created! ${data.segments?.length ?? 0} segments detected`);
        queryClient.invalidateQueries({ queryKey: [['cutdown', 'list']] });
      },
      onError: (err) => toast.error(err.message),
    })
  );

  const { data: history } = useQuery(
    trpc.cutdown.list.queryOptions({ universeAddress, limit: 10 }, { enabled: isAuthenticated })
  );

  function handleGenerate() {
    if (!videoUrl.trim()) {
      toast.error('Please enter a video URL');
      return;
    }
    generate.mutate({
      sourceVideoUrl: videoUrl,
      sourceContentId,
      universeAddress,
      targetAspectRatio: aspectRatio,
      mode,
      maxDurationSec: maxDuration,
      addCaptions,
      captionStyle,
      title: title || undefined,
    });
  }

  return (
    <div className="space-y-6">
      {/* Creator panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-violet-600/20 rounded-lg">
            <Scissors className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Auto-Cutdown</h3>
            <p className="text-sm text-zinc-400">Create vertical shorts from your content</p>
          </div>
          <span className="ml-auto text-xs bg-violet-600/20 text-violet-300 px-2 py-1 rounded-full">
            8 credits
          </span>
        </div>

        <div className="space-y-4">
          {/* Video URL */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Source Video</label>
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://... or select from your content"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Epic Short"
              maxLength={200}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Format</label>
            <div className="flex gap-2">
              {(
                Object.entries(ASPECT_LABELS) as [AspectRatio, { label: string; icon: string }][]
              ).map(([ratio, { label, icon }]) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    aspectRatio === ratio
                      ? 'border-violet-500 bg-violet-600/20 text-violet-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">Clip Mode</label>
            <div className="flex gap-2">
              {(
                Object.entries(MODE_LABELS) as [Mode, { label: string; description: string }][]
              ).map(([m, { label, description }]) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2.5 px-3 rounded-lg border text-center transition-colors ${
                    mode === m
                      ? 'border-violet-500 bg-violet-600/20 text-violet-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs mt-0.5 opacity-70">{description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Duration slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-zinc-300">Max Duration</label>
              <span className="text-sm text-zinc-400">{maxDuration}s</span>
            </div>
            <input
              type="range"
              min={5}
              max={90}
              step={5}
              value={maxDuration}
              onChange={(e) => setMaxDuration(Number(e.target.value))}
              className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-violet-600"
            />
            <div className="flex justify-between text-xs text-zinc-500 mt-1">
              <span>5s</span>
              <span>30s</span>
              <span>60s</span>
              <span>90s</span>
            </div>
          </div>

          {/* Captions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Subtitles className="h-4 w-4 text-zinc-400" />
              <span className="text-sm text-zinc-300">Auto-captions</span>
            </div>
            <button
              onClick={() => setAddCaptions(!addCaptions)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                addCaptions ? 'bg-violet-600' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                  addCaptions ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {addCaptions && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                Caption Style
              </label>
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white focus:border-violet-500 focus:outline-none"
              >
                {Object.entries(CAPTION_STYLES).map(([key, desc]) => (
                  <option key={key} value={key}>
                    {key.charAt(0).toUpperCase() + key.slice(1)} — {desc}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generate.isPending || !videoUrl.trim() || !isAuthenticated}
            className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg py-3 transition-colors"
          >
            {generate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating short...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Short
              </>
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {generate.data && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h4 className="text-white font-semibold mb-4">Generated Short</h4>
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-zinc-400">Segments:</span>
              <span className="text-white">{generate.data.segments?.length ?? 0} detected</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-zinc-400">Duration:</span>
              <span className="text-white">{generate.data.totalDurationSec}s</span>
            </div>
            {generate.data.segments?.map((seg: any, i: number) => (
              <div key={i} className="flex items-center gap-3 bg-zinc-800 rounded-lg px-4 py-2">
                <GripVertical className="h-4 w-4 text-zinc-600" />
                <Clock className="h-4 w-4 text-zinc-400" />
                <span className="text-sm text-zinc-300">
                  {seg.startSec.toFixed(1)}s — {seg.endSec.toFixed(1)}s
                </span>
                <div className="flex-1 mx-2">
                  <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full"
                      style={{ width: `${(seg.importance ?? 0.5) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-zinc-500">
                  {((seg.importance ?? 0.5) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
            {generate.data.captions && generate.data.captions.length > 0 && (
              <div className="mt-4">
                <h5 className="text-sm font-medium text-zinc-300 mb-2">Captions Preview</h5>
                <div className="max-h-40 overflow-y-auto space-y-1 bg-zinc-800 rounded-lg p-3">
                  {generate.data.captions.map((cap: any, i: number) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <span className="text-violet-400 shrink-0 font-mono">
                        {cap.start.toFixed(1)}s
                      </span>
                      <span className="text-zinc-300">{cap.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {history && Array.isArray(history) && history.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
          <h4 className="text-white font-semibold mb-4">Recent Shorts</h4>
          <div className="space-y-2">
            {history.map((item: any) => (
              <div
                key={item.id}
                className="flex items-center justify-between bg-zinc-800 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-white">{item.title || 'Untitled Short'}</p>
                    <p className="text-xs text-zinc-500">
                      {item.targetAspectRatio} · {item.totalDurationSec}s ·{' '}
                      {item.segments?.length ?? 0} segments
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    item.status === 'completed'
                      ? 'bg-emerald-600/20 text-emerald-400'
                      : item.status === 'failed'
                        ? 'bg-red-600/20 text-red-400'
                        : 'bg-amber-600/20 text-amber-400'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
