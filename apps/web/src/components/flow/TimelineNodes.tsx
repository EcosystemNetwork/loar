/**
 * Timeline Node Components
 *
 * Custom ReactFlow node for timeline events. Displays a video thumbnail
 * (with hover-to-play), event label, canon status badge, and action buttons
 * for adding subsequent or branching events.
 *
 * Also exports the TimelineNodeData interface used across the flow system.
 */

import { Handle, Position } from 'reactflow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Plus,
  Film,
  Camera,
  Users,
  Paintbrush,
  Palette,
  Sparkles,
  Link2,
  Pencil,
  Trash2,
  Copy,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { LoarIcon } from '@/components/loar-icons';
import { useState, useEffect } from 'react';

// ── Scene Control Types (mirrors server scene-controls/types.ts) ──────

export type CameraPresetId =
  | 'locked'
  | 'handheld_subtle'
  | 'dolly_in_slow'
  | 'dolly_in_fast'
  | 'dolly_out_slow'
  | 'dolly_out_fast'
  | 'pan_left'
  | 'pan_right'
  | 'tilt_up'
  | 'tilt_down'
  | 'orbit_left_slow'
  | 'orbit_right_slow'
  | 'orbit_right_fast'
  | 'crane_up'
  | 'crane_down'
  | 'whip_pan_right';

export type CameraIntensity = 'subtle' | 'standard' | 'pronounced';

export type StylePresetId =
  | 'noir'
  | 'watercolor'
  | 'vhs_80s'
  | 'anime'
  | 'cyberpunk'
  | 'fantasy'
  | 'horror'
  | 'documentary'
  | 'comic_book'
  | 'cinematic'
  | 'surreal'
  | 'steampunk';

export type VfxPresetId =
  | 'noir_grade'
  | 'sunset_grade'
  | 'teal_orange'
  | 'bleach_bypass'
  | 'film_grain'
  | 'vhs_effect'
  | 'lens_flare'
  | 'light_leak'
  | 'slow_motion'
  | 'speed_ramp'
  | 'rain_overlay'
  | 'dust_motes'
  | 'glitch'
  | 'vignette';

export interface SceneControls {
  // Feature 2: Camera
  cameraPreset?: CameraPresetId | null;
  cameraIntensity?: CameraIntensity;
  // Feature 3: Cast
  castMemberIds?: string[];
  // Feature 4: Motion mask
  motionMaskHash?: string | null;
  useSourceMask?: boolean;
  // Feature 5: Keyframe handoff
  startFrameFrom?: string | null;
  endFrameTarget?: string | null;
  // Feature 6: VFX
  vfxPresets?: VfxPresetId[];
  // Feature 7: Style
  stylePreset?: StylePresetId | null;
  styleInherits?: boolean;
  inheritedStylePreset?: StylePresetId | null; // resolved from ancestor walk
  inheritedStyleSource?: string | null; // nodeId of the ancestor that set the style
}

export interface TimelineNodeData {
  label: string;
  description: string;
  videoUrl?: string;
  characters?: string[];
  timelineColor?: string;
  timelineName?: string;
  isRoot?: boolean;
  eventId?: string;
  blockchainNodeId?: number; // Actual blockchain node ID for navigation
  displayName?: string; // User-friendly display name for UI
  timelineId?: string;
  universeId?: string;
  nodeType?: 'scene' | 'branch' | 'add';
  isCanon?: boolean; // Whether this node is canonical
  isInCanonChain?: boolean; // Whether this node is part of the canonical chain
  segmentCount?: number; // Number of video segments composing this event
  childCount?: number; // Number of child/branching nodes
  onAddScene?: (position: 'after' | 'branch', sourceNodeId?: string) => void;
  onEditScene?: (eventId: string) => void;
  onRegenerateScene?: (eventId: string) => void;
  onSwitchVersion?: (eventId: string, versionIndex: number) => void;
  onDeleteNode?: (eventId: string) => void;
  isSelected?: boolean;
  isRegenerating?: boolean;
  videoVersions?: Array<{
    videoUrl: string;
    versionNumber: number;
    generatedAt: number;
    model?: string;
  }>;
  currentVersionIndex?: number; // -1 or undefined = latest (current), 0+ = historical version
  wiki?: { title?: string; summary?: string; plot?: string };

  // ── Scene Controls (Node Editor Expansion v1) ──────────────────
  sceneControls?: SceneControls;

  // ── Node Management ───────────────────────────────────────────
  arcId?: string | null;
  tags?: string[];
  dimmed?: boolean; // true when filter is active and this node doesn't match
}

// Style preset colors for visual indicators
const STYLE_COLORS: Record<string, string> = {
  noir: '#1a1a2e',
  watercolor: '#a8d8ea',
  vhs_80s: '#ff6b9d',
  anime: '#c44dff',
  cyberpunk: '#00fff5',
  fantasy: '#ffd700',
  horror: '#2d0a0a',
  documentary: '#8b7355',
  comic_book: '#ff4444',
  cinematic: '#2c3e50',
  surreal: '#9b59b6',
  steampunk: '#b87333',
};
function getStyleColor(styleId: string | null | undefined): string {
  if (!styleId) return 'transparent';
  return STYLE_COLORS[styleId] || '#666';
}

export function TimelineEventNode({ data }: { data: TimelineNodeData }) {
  const [displayVideoUrl, setDisplayVideoUrl] = useState<string | null>(data.videoUrl || null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [videoError, setVideoError] = useState(false);

  // Storage URLs are direct HTTP URLs, no conversion needed
  useEffect(() => {
    // Simply use the video URL directly — Firebase Storage provides HTTP URLs
    setDisplayVideoUrl(data.videoUrl || null);
    setVideoError(false);
    setIsLoadingStorage(false);
  }, [data.videoUrl]);

  // Handle video play/pause based on hover state
  useEffect(() => {
    if (!videoElement) return;

    let playPromise: Promise<void> | undefined;

    if (isHovered) {
      playPromise = videoElement.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Auto-play was prevented, silently ignore
        });
      }
    } else {
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            videoElement.pause();
            videoElement.currentTime = 0;
          })
          .catch(() => {
            // Play was prevented, no need to pause
          });
      } else {
        videoElement.pause();
        videoElement.currentTime = 0;
      }
    }
  }, [isHovered, videoElement]);

  const handleClick = () => {
    if (!data.universeId) return;

    // Use blockchainNodeId if available (the actual blockchain node ID)
    // Otherwise fall back to parsing eventId
    let eventIdToUse: string | number;

    if (data.blockchainNodeId !== undefined) {
      // Use the actual blockchain node ID
      eventIdToUse = data.blockchainNodeId;
    } else if (data.eventId) {
      // Fallback: Extract numeric ID from eventId (e.g., "4b" -> 4, "10" -> 10)
      eventIdToUse = data.eventId;
      if (typeof eventIdToUse === 'string') {
        const match = eventIdToUse.match(/^\d+/);
        if (match) {
          eventIdToUse = match[0];
        }
      }
    } else {
      return;
    }

    const eventUrl = `/event/${data.universeId}/${eventIdToUse}`;
    window.location.href = eventUrl;
  };

  // Add Event Node - just a + button
  if (data.nodeType === 'add') {
    return (
      <>
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <div className="flex items-center justify-center">
          <Button
            variant="outline"
            size="sm"
            className="w-12 h-12 p-0 border-2 border-dashed border-primary/60 hover:border-primary hover:bg-primary/10 rounded-full transition-all duration-200"
            onClick={() => data.onAddScene?.('after', data.eventId)}
            title="Add new event"
          >
            <Plus className="h-6 w-6 text-primary" />
          </Button>
        </div>
        <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      </>
    );
  }

  // Regular Timeline Event Node - Merged design with best of both branches
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div
        className={`relative group ${data.dimmed ? 'opacity-30 pointer-events-none' : ''}`}
        style={{ transition: 'opacity 0.2s ease' }}
      >
        {/* Selection indicator ring */}
        {data.isSelected && (
          <div className="absolute -inset-1 rounded-xl border-2 border-blue-500 bg-blue-500/10 pointer-events-none z-10" />
        )}
        <div
          className={`w-80 h-72 rounded-lg border-2 bg-card hover:bg-card/80 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md overflow-hidden ${data.isRoot ? 'ring-2 ring-primary/50' : ''} ${data.isSelected ? 'ring-2 ring-blue-500/70' : ''}`}
          style={{ borderColor: data.isSelected ? '#3b82f6' : data.timelineColor || '#10b981' }}
          onClick={handleClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Video Preview - Fixed size with proper containment and hover effects */}
          <div className="w-full h-52 bg-black relative overflow-hidden">
            {isLoadingStorage && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto mb-1"></div>
                  <p className="text-white text-xs">Loading...</p>
                </div>
              </div>
            )}
            {displayVideoUrl && !videoError ? (
              <>
                <video
                  ref={setVideoElement}
                  className="w-full h-full object-cover"
                  controls={false}
                  preload="metadata"
                  muted
                  loop
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onError={() => setVideoError(true)}
                >
                  <source src={displayVideoUrl} type="video/mp4" />
                  <source src={displayVideoUrl} />
                </video>

                {/* Hover overlay — edit + regenerate actions */}
                <div
                  className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onEditScene?.(data.eventId || '');
                  }}
                >
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-3">
                    {/* Edit button */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="bg-white/90 rounded-full p-2">
                        <Pencil className="h-5 w-5 text-gray-800" />
                      </div>
                      <span className="text-white text-xs font-medium drop-shadow-lg">Edit</span>
                    </div>
                    {/* Regenerate button */}
                    {data.onRegenerateScene && (
                      <div
                        className="flex flex-col items-center gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          data.onRegenerateScene?.(data.eventId || '');
                        }}
                      >
                        <div
                          className={`bg-white/90 rounded-full p-2 ${data.isRegenerating ? 'animate-spin' : 'hover:bg-primary/20'} transition-colors`}
                        >
                          <RefreshCw className="h-5 w-5 text-gray-800" />
                        </div>
                        <span className="text-white text-xs font-medium drop-shadow-lg">
                          {data.isRegenerating ? 'Generating...' : 'Regenerate'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Version picker — shows when multiple versions exist */}
                {data.videoVersions && data.videoVersions.length > 0 && (
                  <div
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/75 rounded-full px-2 py-1 z-10"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="text-white/70 hover:text-white p-0.5 disabled:opacity-30"
                      disabled={
                        (data.currentVersionIndex ?? -1) <= 0 &&
                        data.currentVersionIndex !== -1 &&
                        data.currentVersionIndex !== undefined
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        const current = data.currentVersionIndex ?? -1;
                        // -1 means "latest". Going left means going to older versions.
                        // versions array: [v1(oldest), v2, ...] current video is "latest" beyond array
                        const totalVersions = data.videoVersions!.length + 1; // +1 for current
                        const currentIdx = current === -1 ? totalVersions - 1 : current;
                        if (currentIdx > 0) {
                          data.onSwitchVersion?.(data.eventId || '', currentIdx - 1);
                        }
                      }}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-white text-xs font-medium min-w-[28px] text-center">
                      v
                      {(data.currentVersionIndex ?? -1) === -1
                        ? data.videoVersions.length + 1
                        : (data.currentVersionIndex ?? 0) + 1}
                    </span>
                    <span className="text-white/50 text-xs">/ {data.videoVersions.length + 1}</span>
                    <button
                      className="text-white/70 hover:text-white p-0.5 disabled:opacity-30"
                      disabled={(data.currentVersionIndex ?? -1) === -1}
                      onClick={(e) => {
                        e.stopPropagation();
                        const current = data.currentVersionIndex ?? -1;
                        const totalVersions = data.videoVersions!.length + 1;
                        const currentIdx = current === -1 ? totalVersions - 1 : current;
                        if (currentIdx < totalVersions - 1) {
                          const nextIdx = currentIdx + 1;
                          // If next is the latest, use -1
                          data.onSwitchVersion?.(
                            data.eventId || '',
                            nextIdx >= totalVersions - 1 ? -1 : nextIdx
                          );
                        }
                      }}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                {/* Event ID overlay - with displayName support */}
                <div className="absolute top-2 left-2 bg-black/75 text-white text-xs px-2 py-1 rounded pointer-events-none">
                  {data.displayName || `Event ${data.eventId || '?'}`}
                </div>

                {/* Status badges - top right */}
                <div className="absolute top-2 right-2 flex gap-1 flex-wrap max-w-[180px] justify-end pointer-events-none">
                  {data.segmentCount && data.segmentCount > 1 && (
                    <Badge
                      variant="secondary"
                      className="bg-blue-500/90 hover:bg-blue-600 text-white text-xs px-1.5 py-0.5"
                    >
                      {data.segmentCount} clips
                    </Badge>
                  )}
                  {data.isInCanonChain && (
                    <Badge
                      variant="default"
                      className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold text-xs px-2 py-1"
                    >
                      Canon
                    </Badge>
                  )}
                  {/* Scene control indicators */}
                  {data.sceneControls?.cameraPreset && (
                    <Badge
                      variant="secondary"
                      className="bg-indigo-500/90 text-white text-xs px-1 py-0.5"
                      title={`Camera: ${data.sceneControls.cameraPreset}`}
                    >
                      <Camera className="h-3 w-3" />
                    </Badge>
                  )}
                  {data.sceneControls?.castMemberIds &&
                    data.sceneControls.castMemberIds.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-pink-500/90 text-white text-xs px-1 py-0.5"
                        title={`${data.sceneControls.castMemberIds.length} cast`}
                      >
                        <Users className="h-3 w-3" />
                      </Badge>
                    )}
                  {data.sceneControls?.vfxPresets && data.sceneControls.vfxPresets.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-orange-500/90 text-white text-xs px-1 py-0.5"
                      title={`${data.sceneControls.vfxPresets.length} VFX`}
                    >
                      <Sparkles className="h-3 w-3" />
                    </Badge>
                  )}
                  {data.sceneControls?.startFrameFrom && (
                    <Badge
                      variant="secondary"
                      className="bg-cyan-500/90 text-white text-xs px-1 py-0.5"
                      title="Keyframe linked"
                    >
                      <Link2 className="h-3 w-3" />
                    </Badge>
                  )}
                </div>

                {/* Style indicator — colored bar at bottom of video */}
                {(data.sceneControls?.stylePreset || data.sceneControls?.inheritedStylePreset) && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1 pointer-events-none"
                    style={{
                      backgroundColor: getStyleColor(
                        data.sceneControls.stylePreset || data.sceneControls.inheritedStylePreset
                      ),
                    }}
                    title={`Style: ${data.sceneControls.stylePreset || data.sceneControls.inheritedStylePreset}${data.sceneControls.inheritedStyleSource ? ` (inherited from node ${data.sceneControls.inheritedStyleSource})` : ''}`}
                  />
                )}
              </>
            ) : (
              <div
                className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800 flex flex-col items-center justify-center cursor-pointer hover:from-gray-500 hover:to-gray-700 transition-all duration-200"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onEditScene?.(data.eventId || '');
                }}
              >
                <LoarIcon name="clapperboard" size={40} className="text-white mb-2" />
                <div className="text-white text-sm font-medium">Add Video</div>
                <div className="text-white/60 text-xs mt-1">Click to upload or paste URL</div>
              </div>
            )}
          </div>

          {/* Event ID and Status - Fixed footer with displayName support */}
          <div className="p-4 h-20 flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${data.isRoot ? 'bg-primary' : 'bg-current'}`}
                style={{
                  backgroundColor: data.timelineColor || '#10b981',
                }}
              />
              <span className="text-lg font-bold text-primary truncate">
                {data.displayName || `Event ${data.eventId || '?'}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {data.isRoot && (
                <Badge variant="secondary" className="text-xs">
                  Start
                </Badge>
              )}
              {data.childCount && data.childCount > 1 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {data.childCount} branches
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onEditScene?.(data.eventId || '');
                }}
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Change video"
              >
                <Film className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Bottom action buttons - appear on hover */}
        <div className="absolute -bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
          {/* Delete button */}
          {data.onDeleteNode && (
            <Button
              variant="outline"
              size="sm"
              className="w-8 h-8 p-0 border-2 border-red-500/60 hover:border-red-500 hover:bg-red-500/20 rounded-full bg-card"
              onClick={(e) => {
                e.stopPropagation();
                data.onDeleteNode?.(data.eventId || '');
              }}
              title="Delete node"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
          {/* Branch button */}
          <Button
            variant="outline"
            size="sm"
            className="w-8 h-8 p-0 border-2 border-dashed border-primary/60 hover:border-primary hover:bg-primary/10 rounded-full bg-card"
            onClick={(e) => {
              e.stopPropagation();
              data.onAddScene?.('branch', data.eventId);
            }}
            title="Create branch event"
          >
            <Plus className="h-4 w-4 text-primary" />
          </Button>
        </div>

        {/* Selection checkbox — top-left, appears on hover or when selected */}
        {data.isSelected !== undefined && (
          <div
            className={`absolute -top-2 -left-2 z-20 ${data.isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200`}
          >
            <div
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all ${
                data.isSelected
                  ? 'bg-blue-500 border-blue-500 text-white'
                  : 'bg-card border-zinc-500 hover:border-blue-400'
              }`}
            >
              {data.isSelected && <Check className="h-3.5 w-3.5" />}
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  );
}

export function TimelineBranchNode({ data }: { data: { label: string; color: string } }) {
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className="px-3 py-1 rounded-full text-xs font-medium text-white"
        style={{ backgroundColor: data.color }}
      >
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}
