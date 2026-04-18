/**
 * Scene Controls Panel
 *
 * Inspector panel for per-node scene controls in the timeline editor.
 * Tabs: Camera | Cast | Motion | Keyframe | VFX | Style
 *
 * Each tab controls one feature from the Node Editor Expansion PRD.
 * Data is persisted via the sceneControls.saveNodeControls tRPC endpoint.
 */

import { useState, useCallback, useEffect } from 'react';
// Card wrapper removed — panel is already inside a bordered container in universe/$id.tsx
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Camera,
  Users,
  Paintbrush,
  Link2,
  Sparkles,
  Palette,
  ChevronRight,
  Plus,
  X,
  Check,
} from 'lucide-react';
import type {
  SceneControls,
  CameraPresetId,
  CameraIntensity,
  StylePresetId,
  VfxPresetId,
} from './TimelineNodes';

// ── Camera Presets ─────────────────────────────────────────────────────

const CAMERA_PRESETS: Array<{
  id: CameraPresetId;
  label: string;
  category: string;
}> = [
  { id: 'locked', label: 'Locked', category: 'Static' },
  { id: 'handheld_subtle', label: 'Handheld', category: 'Static' },
  { id: 'dolly_in_slow', label: 'Dolly In Slow', category: 'Dolly' },
  { id: 'dolly_in_fast', label: 'Dolly In Fast', category: 'Dolly' },
  { id: 'dolly_out_slow', label: 'Dolly Out Slow', category: 'Dolly' },
  { id: 'dolly_out_fast', label: 'Dolly Out Fast', category: 'Dolly' },
  { id: 'pan_left', label: 'Pan Left', category: 'Pan' },
  { id: 'pan_right', label: 'Pan Right', category: 'Pan' },
  { id: 'tilt_up', label: 'Tilt Up', category: 'Tilt' },
  { id: 'tilt_down', label: 'Tilt Down', category: 'Tilt' },
  { id: 'orbit_left_slow', label: 'Orbit Left', category: 'Orbit' },
  { id: 'orbit_right_slow', label: 'Orbit Right', category: 'Orbit' },
  { id: 'orbit_right_fast', label: 'Orbit Right Fast', category: 'Orbit' },
  { id: 'crane_up', label: 'Crane Up', category: 'Crane' },
  { id: 'crane_down', label: 'Crane Down', category: 'Crane' },
  { id: 'whip_pan_right', label: 'Whip Pan', category: 'Push' },
];

const STYLE_PRESETS: Array<{ id: StylePresetId; label: string; color: string }> = [
  { id: 'noir', label: 'Noir', color: '#1a1a2e' },
  { id: 'watercolor', label: 'Watercolor', color: '#a8d8ea' },
  { id: 'vhs_80s', label: "'80s VHS", color: '#ff6b9d' },
  { id: 'anime', label: 'Anime', color: '#c44dff' },
  { id: 'cyberpunk', label: 'Cyberpunk', color: '#00fff5' },
  { id: 'fantasy', label: 'Fantasy', color: '#ffd700' },
  { id: 'horror', label: 'Horror', color: '#2d0a0a' },
  { id: 'documentary', label: 'Documentary', color: '#8b7355' },
  { id: 'comic_book', label: 'Comic Book', color: '#ff4444' },
  { id: 'cinematic', label: 'Cinematic', color: '#2c3e50' },
  { id: 'surreal', label: 'Surreal', color: '#9b59b6' },
  { id: 'steampunk', label: 'Steampunk', color: '#b87333' },
];

const VFX_PRESETS: Array<{ id: VfxPresetId; label: string; category: string }> = [
  { id: 'noir_grade', label: 'Noir Grade', category: 'Color' },
  { id: 'sunset_grade', label: 'Sunset Grade', category: 'Color' },
  { id: 'teal_orange', label: 'Teal & Orange', category: 'Color' },
  { id: 'bleach_bypass', label: 'Bleach Bypass', category: 'Color' },
  { id: 'film_grain', label: 'Film Grain', category: 'Film' },
  { id: 'vhs_effect', label: 'VHS Effect', category: 'Film' },
  { id: 'lens_flare', label: 'Lens Flare', category: 'Light' },
  { id: 'light_leak', label: 'Light Leak', category: 'Light' },
  { id: 'slow_motion', label: 'Slow Motion', category: 'Speed' },
  { id: 'speed_ramp', label: 'Speed Ramp', category: 'Speed' },
  { id: 'rain_overlay', label: 'Rain', category: 'Atmosphere' },
  { id: 'dust_motes', label: 'Dust Motes', category: 'Atmosphere' },
  { id: 'glitch', label: 'Glitch', category: 'Distortion' },
  { id: 'vignette', label: 'Vignette', category: 'Distortion' },
];

// ── Component Props ───────────────────────────────────────────────────

interface CastMember {
  id: string;
  name: string;
  referenceImageUrls?: string[];
}

interface SceneControlsPanelProps {
  nodeId: string;
  universeId: string;
  controls: SceneControls;
  onChange: (controls: SceneControls) => void;
  castMembers?: CastMember[];
  onOpenCastManager?: () => void;
  onOpenMotionBrush?: () => void;
  siblingNodes?: Array<{ id: string; label: string; videoUrl?: string }>;
}

type Tab = 'camera' | 'cast' | 'motion' | 'keyframe' | 'vfx' | 'style';

export function SceneControlsPanel({
  nodeId,
  universeId,
  controls,
  onChange,
  castMembers = [],
  onOpenCastManager,
  onOpenMotionBrush,
  siblingNodes = [],
}: SceneControlsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('camera');

  const updateControl = useCallback(
    <K extends keyof SceneControls>(key: K, value: SceneControls[K]) => {
      onChange({ ...controls, [key]: value });
    },
    [controls, onChange]
  );

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode; hasValue: boolean }> = [
    {
      id: 'camera',
      label: 'Camera',
      icon: <Camera className="h-3.5 w-3.5" />,
      hasValue: !!controls.cameraPreset,
    },
    {
      id: 'cast',
      label: 'Cast',
      icon: <Users className="h-3.5 w-3.5" />,
      hasValue: (controls.castMemberIds?.length || 0) > 0,
    },
    {
      id: 'motion',
      label: 'Motion',
      icon: <Paintbrush className="h-3.5 w-3.5" />,
      hasValue: !!controls.motionMaskHash,
    },
    {
      id: 'keyframe',
      label: 'Keyframe',
      icon: <Link2 className="h-3.5 w-3.5" />,
      hasValue: !!controls.startFrameFrom,
    },
    {
      id: 'vfx',
      label: 'VFX',
      icon: <Sparkles className="h-3.5 w-3.5" />,
      hasValue: (controls.vfxPresets?.length || 0) > 0,
    },
    {
      id: 'style',
      label: 'Style',
      icon: <Palette className="h-3.5 w-3.5" />,
      hasValue: !!controls.stylePreset || !!controls.inheritedStylePreset,
    },
  ];

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
            } ${tab.hasValue ? 'ring-1 ring-primary/40' : ''}`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {/* ── Camera Tab ─────────────────────────────────────────── */}
        {activeTab === 'camera' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Camera Motion</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {CAMERA_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() =>
                    updateControl(
                      'cameraPreset',
                      controls.cameraPreset === preset.id ? null : preset.id
                    )
                  }
                  className={`text-left text-xs px-2 py-1.5 rounded border transition-colors ${
                    controls.cameraPreset === preset.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:border-primary/40'
                  }`}
                >
                  <span className="font-medium">{preset.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{preset.category}</span>
                </button>
              ))}
            </div>

            {controls.cameraPreset && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Intensity</Label>
                <div className="flex gap-1.5">
                  {(['subtle', 'standard', 'pronounced'] as CameraIntensity[]).map((level) => (
                    <button
                      key={level}
                      onClick={() => updateControl('cameraIntensity', level)}
                      className={`flex-1 text-xs px-2 py-1 rounded border transition-colors capitalize ${
                        (controls.cameraIntensity || 'standard') === level
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/40'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Cast Tab ───────────────────────────────────────────── */}
        {activeTab === 'cast' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Characters in this shot</Label>
              {onOpenCastManager && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={onOpenCastManager}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Manage Cast
                </Button>
              )}
            </div>

            {castMembers.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No cast members defined for this universe.
                {onOpenCastManager && ' Click "Manage Cast" to add characters.'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {castMembers.map((member) => {
                  const isSelected = controls.castMemberIds?.includes(member.id) || false;
                  return (
                    <button
                      key={member.id}
                      onClick={() => {
                        const current = controls.castMemberIds || [];
                        if (isSelected) {
                          updateControl(
                            'castMemberIds',
                            current.filter((id) => id !== member.id)
                          );
                        } else {
                          updateControl('castMemberIds', [...current, member.id]);
                        }
                      }}
                      className={`flex items-center gap-2 w-full text-left text-xs px-2 py-2 rounded border transition-colors ${
                        isSelected
                          ? 'border-pink-500 bg-pink-500/10'
                          : 'border-border hover:border-pink-500/40'
                      }`}
                    >
                      {member.referenceImageUrls?.[0] ? (
                        <img
                          src={member.referenceImageUrls[0]}
                          alt={member.name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm">
                          {member.name[0]}
                        </div>
                      )}
                      <span className="font-medium flex-1">{member.name}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-pink-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Motion Mask Tab ────────────────────────────────────── */}
        {activeTab === 'motion' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Region Motion Mask</Label>
            <p className="text-xs text-muted-foreground">
              Paint regions on the input image to control which areas move and which stay still.
            </p>

            {controls.motionMaskHash ? (
              <div className="space-y-2">
                <Badge variant="secondary" className="text-xs">
                  Mask applied
                </Badge>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={onOpenMotionBrush}
                  >
                    <Paintbrush className="h-3 w-3 mr-1" />
                    Edit Mask
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => updateControl('motionMaskHash', null)}
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={onOpenMotionBrush}
              >
                <Paintbrush className="h-3.5 w-3.5 mr-1.5" />
                Open Motion Brush
              </Button>
            )}

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="useSourceMask"
                checked={controls.useSourceMask || false}
                onChange={(e) => updateControl('useSourceMask', e.target.checked)}
                className="rounded"
              />
              <label htmlFor="useSourceMask" className="text-xs text-muted-foreground">
                Use mask from source image
              </label>
            </div>
          </div>
        )}

        {/* ── Keyframe Tab ───────────────────────────────────────── */}
        {activeTab === 'keyframe' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Start Frame</Label>
            <p className="text-xs text-muted-foreground">
              Set this node to start from another node's final frame for seamless cuts.
            </p>

            <select
              value={controls.startFrameFrom || ''}
              onChange={(e) => updateControl('startFrameFrom', e.target.value || null)}
              className="w-full text-xs px-2 py-1.5 rounded border bg-background"
            >
              <option value="">None (default)</option>
              <option value="first-frame-of-input">First frame of input</option>
              {siblingNodes
                .filter((n) => n.id !== nodeId)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    Node {n.label || n.id}
                    {n.videoUrl ? ' (has video)' : ''}
                  </option>
                ))}
            </select>

            <Label className="text-xs text-muted-foreground">End Frame Target</Label>
            <select
              value={controls.endFrameTarget || ''}
              onChange={(e) => updateControl('endFrameTarget', e.target.value || null)}
              className="w-full text-xs px-2 py-1.5 rounded border bg-background"
            >
              <option value="">Free (default)</option>
              {siblingNodes
                .filter((n) => n.id !== nodeId)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    Node {n.label || n.id}
                  </option>
                ))}
            </select>

            {controls.startFrameFrom && (
              <Badge variant="secondary" className="text-xs">
                <Link2 className="h-3 w-3 mr-1" />
                Linked to{' '}
                {controls.startFrameFrom === 'first-frame-of-input'
                  ? 'input frame'
                  : `node ${controls.startFrameFrom}`}
              </Badge>
            )}
          </div>
        )}

        {/* ── VFX Tab ────────────────────────────────────────────── */}
        {activeTab === 'vfx' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">
              Post-Processing Effects (no regen needed)
            </Label>

            {/* Group by category */}
            {Object.entries(
              VFX_PRESETS.reduce(
                (acc, p) => {
                  if (!acc[p.category]) acc[p.category] = [];
                  acc[p.category].push(p);
                  return acc;
                },
                {} as Record<string, typeof VFX_PRESETS>
              )
            ).map(([category, presets]) => (
              <div key={category} className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  {category}
                </span>
                <div className="flex flex-wrap gap-1">
                  {presets.map((preset) => {
                    const isActive = controls.vfxPresets?.includes(preset.id) || false;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          const current = controls.vfxPresets || [];
                          if (isActive) {
                            updateControl(
                              'vfxPresets',
                              current.filter((id) => id !== preset.id)
                            );
                          } else {
                            updateControl('vfxPresets', [...current, preset.id]);
                          }
                        }}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          isActive
                            ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                            : 'border-border hover:border-orange-500/40'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {(controls.vfxPresets?.length || 0) > 0 && (
              <div className="pt-1 flex items-center justify-between">
                <Badge variant="secondary" className="text-xs">
                  {controls.vfxPresets!.length} effect
                  {controls.vfxPresets!.length > 1 ? 's' : ''} applied
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => updateControl('vfxPresets', [])}
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Style Tab ──────────────────────────────────────────── */}
        {activeTab === 'style' && (
          <div className="space-y-3">
            <Label className="text-xs text-muted-foreground">Visual Style</Label>

            <div className="grid grid-cols-3 gap-1.5">
              {STYLE_PRESETS.map((style) => (
                <button
                  key={style.id}
                  onClick={() =>
                    updateControl(
                      'stylePreset',
                      controls.stylePreset === style.id ? null : style.id
                    )
                  }
                  className={`text-xs px-2 py-2 rounded border transition-colors text-center ${
                    controls.stylePreset === style.id
                      ? 'border-2 ring-1 ring-primary/50'
                      : 'border-border hover:border-primary/40'
                  }`}
                  style={{
                    borderColor: controls.stylePreset === style.id ? style.color : undefined,
                  }}
                >
                  <div
                    className="w-full h-3 rounded-sm mb-1"
                    style={{ backgroundColor: style.color }}
                  />
                  <span>{style.label}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="styleInherits"
                checked={controls.styleInherits !== false}
                onChange={(e) => updateControl('styleInherits', e.target.checked)}
                className="rounded"
              />
              <label htmlFor="styleInherits" className="text-xs text-muted-foreground">
                Inherit style from parent branch
              </label>
            </div>

            {controls.inheritedStylePreset && !controls.stylePreset && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                Inherited:{' '}
                <span className="font-medium">
                  {STYLE_PRESETS.find((s) => s.id === controls.inheritedStylePreset)?.label ||
                    controls.inheritedStylePreset}
                </span>
                {controls.inheritedStyleSource && (
                  <span> from node {controls.inheritedStyleSource}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
