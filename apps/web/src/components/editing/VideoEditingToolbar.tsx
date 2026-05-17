/**
 * VideoEditingToolbar
 *
 * Runway/Higgsfield-style editing tools panel.
 * Shows available operations as tool buttons with expandable panels.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowUpCircle,
  Timer,
  Paintbrush,
  Eraser,
  Scissors,
  Plus,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type { EditingOperation, EditingModel, EditingResult } from '@/hooks/useVideoEditing';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface VideoEditingToolbarProps {
  videoUrl: string | null;
  imageUrl: string | null;
  onUpscale: (params: {
    imageUrl: string;
    modelId?: string;
    prompt?: string;
    scale?: number;
  }) => Promise<any>;
  onInterpolate: (params: {
    videoUrl: string;
    multiplier?: number;
    modelId?: string;
  }) => Promise<any>;
  onRestyle: (params: {
    videoUrl: string;
    prompt: string;
    modelId?: string;
    strength?: number;
  }) => Promise<any>;
  onInpaint: (params: {
    imageUrl: string;
    maskUrl: string;
    prompt: string;
    modelId?: string;
  }) => Promise<any>;
  onRemoveBackground: (params: { imageUrl: string; modelId?: string }) => Promise<any>;
  onExtend: (params: { videoUrl: string; prompt: string; durationSec?: number }) => Promise<any>;
  isProcessing: boolean;
  activeOperation: EditingOperation | null;
  lastResult: EditingResult | null;
  models: EditingModel[];
  getModelsForOperation: (op: EditingOperation) => EditingModel[];
  /** Canvas mask URL from inpaint brush (provided externally) */
  maskUrl?: string;
}

interface ToolConfig {
  id: EditingOperation;
  label: string;
  icon: React.ReactNode;
  description: string;
  requiresVideo: boolean;
  requiresImage: boolean;
  color: string;
}

const TOOLS: ToolConfig[] = [
  {
    id: 'upscale',
    label: 'Upscale 4K',
    icon: <ArrowUpCircle className="w-4 h-4" />,
    description: 'Super-resolution to 4K quality',
    requiresVideo: false,
    requiresImage: true,
    color: 'text-blue-400',
  },
  {
    id: 'interpolate',
    label: 'Slow-Mo',
    icon: <Timer className="w-4 h-4" />,
    description: 'Smooth slow-motion via frame interpolation',
    requiresVideo: true,
    requiresImage: false,
    color: 'text-purple-400',
  },
  {
    id: 'restyle',
    label: 'Restyle',
    icon: <Paintbrush className="w-4 h-4" />,
    description: 'Change visual style while keeping motion',
    requiresVideo: true,
    requiresImage: false,
    color: 'text-orange-400',
  },
  {
    id: 'inpaint',
    label: 'Inpaint',
    icon: <Eraser className="w-4 h-4" />,
    description: 'Paint over a region and replace it',
    requiresVideo: false,
    requiresImage: true,
    color: 'text-green-400',
  },
  {
    id: 'remove_bg',
    label: 'Remove BG',
    icon: <Scissors className="w-4 h-4" />,
    description: 'Remove background for compositing',
    requiresVideo: false,
    requiresImage: true,
    color: 'text-pink-400',
  },
  {
    id: 'extend',
    label: 'Extend',
    icon: <Plus className="w-4 h-4" />,
    description: 'Continue the video with new content',
    requiresVideo: true,
    requiresImage: false,
    color: 'text-cyan-400',
  },
];

export function VideoEditingToolbar({
  videoUrl,
  imageUrl,
  onUpscale,
  onInterpolate,
  onRestyle,
  onInpaint,
  onRemoveBackground,
  onExtend,
  isProcessing,
  activeOperation,
  lastResult,
  models,
  getModelsForOperation,
  maskUrl,
}: VideoEditingToolbarProps) {
  const [activeTool, setActiveTool] = useState<EditingOperation | null>(null);

  // Per-tool state
  const [restylePrompt, setRestylePrompt] = useState('');
  const [restyleStrength, setRestyleStrength] = useState(0.65);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [extendPrompt, setExtendPrompt] = useState('');
  const [extendDuration, setExtendDuration] = useState(5);
  const [interpolateMultiplier, setInterpolateMultiplier] = useState(2);
  const [upscaleScale, setUpscaleScale] = useState(4);
  const [upscalePrompt, setUpscalePrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  const getSelectedModel = (op: EditingOperation) => {
    if (selectedModels[op]) return selectedModels[op];
    const available = getModelsForOperation(op);
    return available[0]?.id;
  };

  const isToolAvailable = (tool: ToolConfig) => {
    if (tool.requiresVideo && !videoUrl) return false;
    if (tool.requiresImage && !imageUrl) return false;
    return true;
  };

  const handleExecute = async () => {
    if (!activeTool) return;

    try {
      switch (activeTool) {
        case 'upscale':
          if (!imageUrl) return;
          await onUpscale({
            imageUrl,
            modelId: getSelectedModel('upscale'),
            prompt: upscalePrompt || undefined,
            scale: upscaleScale,
          });
          break;
        case 'interpolate':
          if (!videoUrl) return;
          await onInterpolate({
            videoUrl,
            multiplier: interpolateMultiplier,
            modelId: getSelectedModel('interpolate'),
          });
          break;
        case 'restyle':
          if (!videoUrl || !restylePrompt) return;
          await onRestyle({
            videoUrl,
            prompt: restylePrompt,
            modelId: getSelectedModel('restyle'),
            strength: restyleStrength,
          });
          break;
        case 'inpaint':
          if (!imageUrl || !maskUrl || !inpaintPrompt) return;
          await onInpaint({
            imageUrl,
            maskUrl,
            prompt: inpaintPrompt,
            modelId: getSelectedModel('inpaint'),
          });
          break;
        case 'remove_bg':
          if (!imageUrl) return;
          await onRemoveBackground({
            imageUrl,
            modelId: getSelectedModel('remove_bg'),
          });
          break;
        case 'extend':
          if (!videoUrl || !extendPrompt) return;
          await onExtend({
            videoUrl,
            prompt: extendPrompt,
            durationSec: extendDuration,
          });
          break;
      }
    } catch (err: any) {
      console.error(`Editing operation ${activeTool} failed:`, err.message);
    }
  };

  const getModelCost = (op: EditingOperation) => {
    const modelId = getSelectedModel(op);
    const model = models.find((m) => m.id === modelId);
    return model?.creditCost || 0;
  };

  return (
    <div className="space-y-3">
      {/* Tool Buttons Row */}
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((tool) => {
          const available = isToolAvailable(tool);
          const isActive = activeTool === tool.id;
          const isRunning = activeOperation === tool.id;

          return (
            <Button
              key={tool.id}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              disabled={!available || (isProcessing && !isRunning)}
              onClick={() => setActiveTool(isActive ? null : tool.id)}
              className={`relative ${isActive ? 'ring-2 ring-offset-2 ring-offset-background' : ''}`}
            >
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <span className={`mr-1.5 ${tool.color}`}>{tool.icon}</span>
              )}
              {tool.label}
              {!available && (
                <span className="ml-1 text-[10px] opacity-50">
                  ({tool.requiresVideo ? 'needs video' : 'needs image'})
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {/* Expanded Tool Panel */}
      {activeTool && (
        <Card className="p-4 border-border/60 bg-card/50 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-500" />
              <h3 className="text-sm font-medium">
                {TOOLS.find((t) => t.id === activeTool)?.label}
              </h3>
              <Badge variant="secondary" className="text-[10px]">
                {getModelCost(activeTool)} credits
              </Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setActiveTool(null)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mb-3">
            {TOOLS.find((t) => t.id === activeTool)?.description}
          </p>

          {/* Model selector (if multiple models available) */}
          {getModelsForOperation(activeTool).length > 1 && (
            <div className="mb-3">
              <label className="text-xs text-muted-foreground mb-1 block">Model</label>
              <Select
                value={getSelectedModel(activeTool)}
                onValueChange={(val) =>
                  setSelectedModels((prev) => ({ ...prev, [activeTool]: val }))
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getModelsForOperation(activeTool).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <div className="flex items-center gap-2">
                        <span>{m.displayName}</span>
                        <Badge variant="outline" className="text-[9px]">
                          {m.tier}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{m.creditCost} cr</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Tool-specific controls */}
          {activeTool === 'upscale' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Scale</label>
                <div className="flex gap-2">
                  {[2, 3, 4].map((s) => (
                    <Button
                      key={s}
                      variant={upscaleScale === s ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setUpscaleScale(s)}
                    >
                      {s}x
                    </Button>
                  ))}
                </div>
              </div>
              {getSelectedModel('upscale') === 'upscale-creative' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Detail prompt (optional)
                  </label>
                  <Input
                    value={upscalePrompt}
                    onChange={(e) => setUpscalePrompt(e.target.value)}
                    placeholder="Add extra detail when upscaling..."
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {activeTool === 'interpolate' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Frame multiplier ({interpolateMultiplier}x slow-mo)
              </label>
              <Slider
                value={[interpolateMultiplier]}
                onValueChange={([v]) => setInterpolateMultiplier(v)}
                min={2}
                max={8}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>2x (gentle)</span>
                <span>8x (ultra slow-mo)</span>
              </div>
            </div>
          )}

          {activeTool === 'restyle' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  New style description
                </label>
                <Textarea
                  value={restylePrompt}
                  onChange={(e) => setRestylePrompt(e.target.value)}
                  placeholder="Anime style with vibrant colors, cel-shaded..."
                  className="text-xs min-h-[60px]"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Strength ({Math.round(restyleStrength * 100)}%)
                </label>
                <Slider
                  value={[restyleStrength]}
                  onValueChange={([v]) => setRestyleStrength(v)}
                  min={0.1}
                  max={1}
                  step={0.05}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Subtle (keep original)</span>
                  <span>Full restyle</span>
                </div>
              </div>
            </div>
          )}

          {activeTool === 'inpaint' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">What to fill in</label>
                <Textarea
                  value={inpaintPrompt}
                  onChange={(e) => setInpaintPrompt(e.target.value)}
                  placeholder="A red sports car, photorealistic..."
                  className="text-xs min-h-[60px]"
                />
              </div>
              {!maskUrl && (
                <p className="text-xs text-amber-500">
                  Use the brush tool on the canvas to paint the area you want to replace.
                </p>
              )}
              {maskUrl && (
                <Badge variant="secondary" className="text-[10px]">
                  Mask ready
                </Badge>
              )}
            </div>
          )}

          {activeTool === 'extend' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  What happens next
                </label>
                <Textarea
                  value={extendPrompt}
                  onChange={(e) => setExtendPrompt(e.target.value)}
                  placeholder="The character walks through the door into a bright room..."
                  className="text-xs min-h-[60px]"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Extension duration ({extendDuration}s)
                </label>
                <Slider
                  value={[extendDuration]}
                  onValueChange={([v]) => setExtendDuration(v)}
                  min={2}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {/* Execute button */}
          <Button
            className="w-full mt-4"
            disabled={isProcessing || !isToolAvailable(TOOLS.find((t) => t.id === activeTool)!)}
            onClick={handleExecute}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Apply {TOOLS.find((t) => t.id === activeTool)?.label}
              </>
            )}
          </Button>

          {/* Last result */}
          {lastResult && !isProcessing && (
            <div className="mt-3 p-2 rounded bg-green-500/10 border border-green-500/20">
              <p className="text-xs text-green-400">Done! Processed with {lastResult.model}.</p>
              {lastResult.videoUrl && (
                <video
                  src={resolveIpfsUrl(lastResult.videoUrl)}
                  controls
                  className="w-full mt-2 rounded max-h-48"
                />
              )}
              {lastResult.imageUrl && (
                <img
                  src={resolveIpfsUrl(lastResult.imageUrl)}
                  alt="Result"
                  className="w-full mt-2 rounded max-h-48 object-contain"
                />
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
