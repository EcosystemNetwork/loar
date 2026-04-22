import React, { useState } from 'react';
import {
  Wand2,
  Video,
  Trash2,
  Check,
  ExternalLink,
  ImageIcon,
  Download,
  Box,
  Plus,
  RefreshCw,
  AudioLines,
  Music,
  Mic,
  Pencil,
  Share,
  ArrowRight,
  Expand,
  Maximize2,
  Sparkles,
  Sun,
  Eraser,
  Frame,
  Loader2,
  Play,
  AlertCircle,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ModelSelector';
import { toast } from 'sonner';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { VoiceModifyPanel } from '@/components/editing/VoiceModifyPanel';
import {
  EDIT_OP_LABELS,
  RESTYLE_MODELS,
  INTERPOLATE_MULTIPLIERS,
  OUTPAINT_ASPECTS,
  QUICK_RELIGHT_PRESETS,
  MAX_RETRIES_PER_GEN,
} from './constants';
import type {
  Generation,
  EditOp,
  RestyleModelId,
  InterpolateMultiplier,
  OutpaintAspect,
  VideoModel,
} from '@/types/sandbox.types';

export type EditPanel = null | 'menu' | 'relight' | 'outpaint' | 'restyle' | 'extend' | 'menu';

// ── Generation Card ─────────────────────────────────────────────────

interface GenerationCardProps {
  gen: Generation;
  onDismiss: () => void;
  onRetry: () => void;
  onAnimate: () => void;
  onUseAsStyleRef: () => void;
  onEditOp: (
    op: EditOp,
    opts?: {
      relightPresetIds?: string[];
      relightFreeText?: string;
      outpaintAspect?: OutpaintAspect;
      outpaintPrompt?: string;
      restylePrompt?: string;
      restyleStrength?: number;
      restyleModelId?: RestyleModelId;
      extendPrompt?: string;
      extendDurationSec?: number;
      interpolateMultiplier?: InterpolateMultiplier;
    }
  ) => void;
  onRetryDraftSave: () => void;
  onVoiceModified: (newAudioUrl: string, newGenerationId: string, presetLabel: string) => void;
}

export function GenerationCard({
  gen,
  onDismiss,
  onRetry,
  onAnimate,
  onUseAsStyleRef,
  onEditOp,
  onRetryDraftSave,
  onVoiceModified,
}: GenerationCardProps) {
  const retriesLeft = MAX_RETRIES_PER_GEN - (gen.retryCount ?? 0);
  const [editPanel, setEditPanel] = useState<EditPanel>(null);
  const [voiceModifyOpen, setVoiceModifyOpen] = useState(false);
  const [relightPresets, setRelightPresets] = useState<string[]>([]);
  const [relightFree, setRelightFree] = useState('');
  const [outpaintAspect, setOutpaintAspect] = useState<OutpaintAspect>('16:9');
  const [outpaintPrompt, setOutpaintPrompt] = useState('');
  const [restylePrompt, setRestylePrompt] = useState('');
  const [restyleStrength, setRestyleStrength] = useState(0.65);
  const [restyleModelId, setRestyleModelId] = useState<RestyleModelId>('restyle-wan-v2v');
  const [extendPrompt, setExtendPrompt] = useState('');
  const [extendDuration, setExtendDuration] = useState(5);

  const toggleRelightPreset = (id: string) => {
    setRelightPresets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {gen.status === 'generating' && (
          <>
            {gen.sourceImageUrl && (
              <img
                src={gen.sourceImageUrl}
                alt=""
                className="w-full h-full object-cover opacity-30"
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Generating {gen.kind}…</span>
            </div>
          </>
        )}
        {gen.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <span className="text-xs text-destructive">Failed</span>
            {gen.error && (
              <span className="text-[10px] text-muted-foreground line-clamp-2">{gen.error}</span>
            )}
          </div>
        )}
        {gen.status === 'done' && gen.kind === 'audio' && gen.audioUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/20 to-primary/5 px-3">
            <Sparkles className="h-6 w-6 text-primary" />
            <audio src={gen.audioUrl} controls className="w-full" />
          </div>
        )}
        {gen.status === 'done' && gen.kind === '3d-model' && (
          <>
            {gen.videoUrl ? (
              // Turntable preview if Meshy returned one
              <video
                src={resolveIpfsUrl(gen.videoUrl)}
                className="w-full h-full object-cover"
                autoPlay
                muted
                loop
                playsInline
              />
            ) : gen.thumbnailUrl ? (
              <img
                src={resolveIpfsUrl(gen.thumbnailUrl)}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <Frame className="h-8 w-8 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">3D model ready</span>
              </div>
            )}
          </>
        )}
        {gen.status === 'done' &&
          gen.kind !== 'audio' &&
          gen.kind !== '3d-model' &&
          gen.videoUrl && (
            <video
              src={resolveIpfsUrl(gen.videoUrl)}
              className="w-full h-full object-cover"
              controls
              muted
              loop
              playsInline
            />
          )}
        {gen.status === 'done' &&
          gen.kind !== 'audio' &&
          gen.kind !== '3d-model' &&
          !gen.videoUrl &&
          gen.imageUrl && (
            <img src={resolveIpfsUrl(gen.imageUrl)} alt="" className="w-full h-full object-cover" />
          )}

        <Button
          size="icon"
          variant="secondary"
          className="absolute top-1.5 right-1.5 h-6 w-6 opacity-80 hover:opacity-100"
          onClick={onDismiss}
          title="Dismiss from queue"
        >
          <X className="h-3 w-3" />
        </Button>

        <Badge variant="secondary" className="absolute top-1.5 left-1.5 text-[10px]">
          {gen.kind === 'video' ? (
            <Video className="h-2.5 w-2.5 mr-1" />
          ) : gen.kind === 'audio' ? (
            <Sparkles className="h-2.5 w-2.5 mr-1" />
          ) : gen.kind === '3d-model' ? (
            <Frame className="h-2.5 w-2.5 mr-1" />
          ) : (
            <ImageIcon className="h-2.5 w-2.5 mr-1" />
          )}
          {gen.kind === '3d-model' ? '3D' : gen.audioFlavor || gen.kind}
        </Badge>
      </div>

      <CardContent className="p-2 space-y-1.5">
        <p className="text-xs text-muted-foreground line-clamp-2">{gen.prompt}</p>
        <div className="flex items-center gap-1 flex-wrap">
          {gen.status === 'done' && gen.draftId && (
            <Badge variant="outline" className="text-[10px]">
              Saved
            </Badge>
          )}
          {gen.status === 'done' && !gen.draftId && gen.draftSaveError && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] text-destructive"
              onClick={onRetryDraftSave}
              title={gen.draftSaveError}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Save draft
            </Button>
          )}
          {gen.status === 'done' && gen.kind === 'image' && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={onAnimate}
              >
                <Video className="h-3 w-3 mr-1" />
                Animate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={onUseAsStyleRef}
                title="Use as style + composition reference for new images"
              >
                <ImageIcon className="h-3 w-3 mr-1" />
                Style ref
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel((p) => (p === 'menu' ? null : 'menu'))}
                title="Image edit operations"
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Edit
              </Button>
            </>
          )}
          {gen.status === 'done' && gen.kind === 'video' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel((p) => (p === 'menu' ? null : 'menu'))}
              title="Video edit operations: restyle, extend, interpolate"
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
          {gen.status === 'done' && gen.kind === 'audio' && gen.audioUrl && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setVoiceModifyOpen(true)}
              title="Swap voice or apply an effect preset"
            >
              <Mic className="h-3 w-3 mr-1" />
              Modify voice
            </Button>
          )}
          {gen.status === 'failed' && retriesLeft > 0 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onRetry}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry ({retriesLeft} left)
            </Button>
          )}
          {gen.status === 'failed' && retriesLeft <= 0 && (
            <span className="text-[10px] text-muted-foreground">Retry limit reached</span>
          )}
        </div>

        {/* Edit menu — one-click ops + expandable panels */}
        {gen.status === 'done' && gen.kind === 'image' && editPanel === 'menu' && (
          <div className="mt-1.5 pt-1.5 border-t flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setEditPanel(null);
                onEditOp('upscale');
              }}
              title="4× super-resolution upscale"
            >
              <Maximize2 className="h-3 w-3 mr-1" />
              4× Upscale
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setEditPanel(null);
                onEditOp('remove-bg');
              }}
              title="Remove background — outputs transparent PNG"
            >
              <Eraser className="h-3 w-3 mr-1" />
              Remove BG
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('relight')}
            >
              <Sun className="h-3 w-3 mr-1" />
              Relight…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('outpaint')}
              title="Extend the canvas to a new aspect ratio"
            >
              <Frame className="h-3 w-3 mr-1" />
              Outpaint…
            </Button>
          </div>
        )}

        {gen.status === 'done' && editPanel === 'relight' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">
              Pick lighting (multi-select OK)
            </p>
            <div className="flex flex-wrap gap-1">
              {QUICK_RELIGHT_PRESETS.map((p) => {
                const active = relightPresets.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleRelightPreset(p.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <Input
              value={relightFree}
              onChange={(e) => setRelightFree(e.target.value)}
              placeholder="Or describe the look in your own words"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                disabled={relightPresets.length === 0 && !relightFree.trim()}
                onClick={() => {
                  onEditOp('relight', {
                    relightPresetIds: relightPresets,
                    relightFreeText: relightFree.trim() || undefined,
                  });
                  setEditPanel(null);
                  setRelightPresets([]);
                  setRelightFree('');
                }}
              >
                Relight
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {gen.status === 'done' && editPanel === 'outpaint' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">Target aspect</p>
            <div className="flex flex-wrap gap-1">
              {OUTPAINT_ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setOutpaintAspect(a)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    outpaintAspect === a
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <Input
              value={outpaintPrompt}
              onChange={(e) => setOutpaintPrompt(e.target.value)}
              placeholder="Optional: hint at what to add in the new canvas"
              className="h-7 text-[11px]"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                onClick={() => {
                  onEditOp('outpaint', {
                    outpaintAspect,
                    outpaintPrompt: outpaintPrompt.trim() || undefined,
                  });
                  setEditPanel(null);
                  setOutpaintPrompt('');
                }}
              >
                Outpaint
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Video edit menu */}
        {gen.status === 'done' && gen.kind === 'video' && editPanel === 'menu' && (
          <div className="mt-1.5 pt-1.5 border-t flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('restyle')}
              title="Video-to-video restyle: keep motion, swap look"
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Restyle…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => setEditPanel('extend')}
              title="Continue the clip from its last frame"
            >
              <ArrowRight className="h-3 w-3 mr-1" />
              Extend…
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                setEditPanel(null);
                onEditOp('interpolate', { interpolateMultiplier: 2 });
              }}
              title="Frame interpolation — smoother motion (2× by default)"
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Smooth
            </Button>
          </div>
        )}

        {gen.status === 'done' && gen.kind === 'video' && editPanel === 'restyle' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">Restyle (v2v)</p>
            <Textarea
              value={restylePrompt}
              onChange={(e) => setRestylePrompt(e.target.value)}
              placeholder="Describe the new look — e.g. 'cyberpunk neon, rain-slick streets'"
              rows={2}
              className="resize-none text-[11px]"
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground whitespace-nowrap">
                Strength {restyleStrength.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={restyleStrength}
                onChange={(e) => setRestyleStrength(Number(e.target.value))}
                className="flex-1 accent-primary"
                title="Higher = more aggressive style swap"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {RESTYLE_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setRestyleModelId(m.id)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    restyleModelId === m.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                disabled={!restylePrompt.trim()}
                onClick={() => {
                  onEditOp('restyle', {
                    restylePrompt: restylePrompt.trim(),
                    restyleStrength,
                    restyleModelId,
                  });
                  setEditPanel(null);
                  setRestylePrompt('');
                }}
              >
                Restyle
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {gen.status === 'done' && gen.kind === 'video' && editPanel === 'extend' && (
          <div className="mt-1.5 pt-1.5 border-t space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground">
              Extend clip — describe what happens next
            </p>
            <Textarea
              value={extendPrompt}
              onChange={(e) => setExtendPrompt(e.target.value)}
              placeholder="What follows the current shot — e.g. 'camera dollies forward, character draws sword'"
              rows={2}
              className="resize-none text-[11px]"
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground whitespace-nowrap">
                Duration {extendDuration}s
              </label>
              <input
                type="range"
                min="2"
                max="10"
                step="1"
                value={extendDuration}
                onChange={(e) => setExtendDuration(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                className="h-6 px-2 text-[10px] flex-1"
                disabled={!extendPrompt.trim()}
                onClick={() => {
                  onEditOp('extend', {
                    extendPrompt: extendPrompt.trim(),
                    extendDurationSec: extendDuration,
                  });
                  setEditPanel(null);
                  setExtendPrompt('');
                }}
              >
                Extend
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={() => setEditPanel(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={voiceModifyOpen} onOpenChange={setVoiceModifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modify voice</DialogTitle>
          </DialogHeader>
          <VoiceModifyPanel
            audioUrl={gen.audioUrl ?? null}
            parentGenerationId={gen.id}
            onComplete={(newUrl, newId, label) => {
              onVoiceModified(newUrl, newId, label);
              setVoiceModifyOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
