/**
 * AudioToolbar — Floating action bar for adding audio layers to selected video clips.
 *
 * Appears when the user selects one or more video generations in the universe timeline.
 * Provides buttons for:
 *   - Background Music (generates via FAL stable-audio)
 *   - Sound Effects (generates via ElevenLabs SFX)
 *   - Lip Sync (syncs dialogue audio to video via FAL lipsync CV model)
 *
 * Each action creates sound nodes on the timeline with independent volume controls.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AudioPlayer } from '@/components/AudioPlayer';
import { Slider } from '@/components/ui/slider';
import {
  Music,
  Volume2,
  Mic,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Waves,
  Megaphone,
} from 'lucide-react';

export interface SelectedClip {
  videoUrl: string;
  title: string;
  generationId: string;
  nodeId?: number;
}

interface AudioToolbarProps {
  universeId: string;
  selectedClips: SelectedClip[];
  onClearSelection: () => void;
  /** Called when a sound node is created so the timeline can refresh */
  onSoundNodeCreated?: () => void;
}

/** Music genre presets */
const MUSIC_PRESETS = [
  {
    label: 'Cinematic',
    prompt: 'Cinematic orchestral score, dramatic, emotional, film soundtrack. No vocals.',
  },
  {
    label: 'Ambient',
    prompt: 'Ambient atmospheric soundscape, dreamy pads, ethereal textures. No vocals.',
  },
  {
    label: 'Epic',
    prompt: 'Epic orchestral trailer music, powerful brass, thundering drums, heroic. No vocals.',
  },
  {
    label: 'Lo-Fi',
    prompt: 'Lo-fi hip hop beat, chill vibes, vinyl crackle, soft piano. No vocals.',
  },
  {
    label: 'Dark',
    prompt: 'Dark atmospheric synth, noir tension, low rumbling bass, unsettling. No vocals.',
  },
  {
    label: 'Sci-Fi',
    prompt: 'Futuristic sci-fi electronic soundtrack, data streams, cyber ambient. No vocals.',
  },
  {
    label: 'Action',
    prompt:
      'High energy action soundtrack, driving electronic beat, intense percussion. No vocals.',
  },
  {
    label: 'Horror',
    prompt: 'Horror ambient, creepy drones, dissonant strings, eerie atmosphere. No vocals.',
  },
  {
    label: 'Fantasy',
    prompt: 'Fantasy adventure orchestral theme, magical, sweeping strings, wonder. No vocals.',
  },
  {
    label: 'Peaceful',
    prompt: 'Peaceful ambient music, gentle acoustic guitar, nature sounds, calm. No vocals.',
  },
] as const;

/** SFX category presets */
const SFX_PRESETS = [
  {
    label: 'City',
    prompt: 'City street ambience, traffic, distant sirens, pedestrians walking, urban atmosphere',
  },
  {
    label: 'Nature',
    prompt: 'Nature ambience, birds chirping, wind through trees, rustling leaves, peaceful forest',
  },
  {
    label: 'Rain',
    prompt:
      'Heavy rain on pavement, thunder rumbling in distance, water dripping, storm atmosphere',
  },
  {
    label: 'Crowd',
    prompt: 'Indoor crowd murmur, people chatting, glasses clinking, busy event atmosphere',
  },
  {
    label: 'Tech',
    prompt:
      'Computer room ambience, keyboard typing, server humming, electronic beeps, data processing',
  },
  {
    label: 'Combat',
    prompt: 'Sword clash, impact sounds, shield block, combat grunts, battle atmosphere',
  },
  {
    label: 'Space',
    prompt:
      'Spaceship interior ambience, engine hum, console beeps, airlock pressurization, sci-fi',
  },
  {
    label: 'Ocean',
    prompt: 'Ocean waves crashing on shore, seagulls, wind, beach atmosphere, water sounds',
  },
  {
    label: 'Fire',
    prompt: 'Crackling fire, wood burning, embers popping, warm fireplace ambience',
  },
  {
    label: 'Horror',
    prompt: 'Creaking floorboards, distant whispers, dripping water, eerie silence, suspense',
  },
] as const;

export function AudioToolbar({
  universeId,
  selectedClips,
  onClearSelection,
  onSoundNodeCreated,
}: AudioToolbarProps) {
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<'music' | 'sfx' | 'lipsync' | 'mixer' | null>(
    null
  );

  // Music state
  const [musicPrompt, setMusicPrompt] = useState('');
  const [musicDuration, setMusicDuration] = useState(30);
  const [musicVolume, setMusicVolume] = useState(0.3);

  // SFX state
  const [sfxPrompt, setSfxPrompt] = useState('');
  const [sfxDuration, setSfxDuration] = useState(10);
  const [sfxVolume, setSfxVolume] = useState(0.6);

  // Lipsync state
  const [dialogueText, setDialogueText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');

  // Result state
  const [lastResult, setLastResult] = useState<{
    type: string;
    audioUrl?: string;
    videoUrl?: string;
  } | null>(null);

  // Fetch voice profiles for this universe
  const { data: voiceProfiles = [] } = useQuery({
    queryKey: ['voice-profiles', universeId],
    queryFn: () => trpcClient.sceneAudio.getVoiceProfiles.query({ universeId }),
    enabled: activePanel === 'lipsync',
  });

  // Fetch existing sound nodes
  const { data: soundNodes = [] } = useQuery({
    queryKey: ['sound-nodes', universeId],
    queryFn: () => trpcClient.sceneAudio.listSoundNodes.query({ universeId }),
  });

  // ── Mutations ──

  const createMusic = useMutation({
    mutationFn: () =>
      trpcClient.sceneAudio.createSoundNode.mutate({
        universeId,
        kind: 'music',
        prompt: musicPrompt,
        durationSec: musicDuration,
        volume: musicVolume,
        startAtNodeId: selectedClips[0]?.nodeId,
        spanNodes: Math.max(0, selectedClips.length - 1),
        label: `Music — ${musicPrompt.slice(0, 40)}`,
      }),
    onSuccess: (data: any) => {
      toast.success(`Background music created! ${data.credits} credits`);
      setLastResult({ type: 'music', audioUrl: data.audioUrl });
      queryClient.invalidateQueries({ queryKey: ['sound-nodes', universeId] });
      onSoundNodeCreated?.();
    },
    onError: (err: any) => toast.error(err.message ?? 'Music generation failed'),
  });

  const createSFX = useMutation({
    mutationFn: () =>
      trpcClient.sceneAudio.createSoundNode.mutate({
        universeId,
        kind: 'sfx',
        prompt: sfxPrompt,
        durationSec: sfxDuration,
        volume: sfxVolume,
        startAtNodeId: selectedClips[0]?.nodeId,
        spanNodes: Math.max(0, selectedClips.length - 1),
        label: `SFX — ${sfxPrompt.slice(0, 40)}`,
      }),
    onSuccess: (data: any) => {
      toast.success(`Sound effect created! ${data.credits} credits`);
      setLastResult({ type: 'sfx', audioUrl: data.audioUrl });
      queryClient.invalidateQueries({ queryKey: ['sound-nodes', universeId] });
      onSoundNodeCreated?.();
    },
    onError: (err: any) => toast.error(err.message ?? 'SFX generation failed'),
  });

  const runLipsync = useMutation({
    mutationFn: async () => {
      // First generate dialogue audio, then lip-sync each selected clip
      if (!selectedVoiceId) throw new Error('Select a voice profile first');
      if (!dialogueText.trim()) throw new Error('Enter dialogue text');

      const clip = selectedClips[0];
      if (!clip) throw new Error('No clip selected');

      // Generate dialogue
      const dialogueResult = await trpcClient.sceneAudio.generateDialogue.mutate({
        universeId,
        sceneId: clip.generationId,
        dialogue: [
          {
            speaker: 'character',
            text: dialogueText,
            voiceProfileId: selectedVoiceId,
          },
        ],
      });

      // Run lip-sync
      const lipsyncResult = await trpcClient.sceneAudio.lipSync.mutate({
        universeId,
        sceneId: clip.generationId,
        videoUrl: clip.videoUrl,
        audioUrl: dialogueResult.audioUrl,
      });

      return { ...lipsyncResult, dialogueUrl: dialogueResult.audioUrl };
    },
    onSuccess: (data: any) => {
      toast.success(`Lip-sync complete! ${data.credits} credits`);
      setLastResult({
        type: 'lipsync',
        videoUrl: data.videoUrl,
        audioUrl: (data as any).dialogueUrl,
      });
      queryClient.invalidateQueries({ queryKey: ['sound-nodes', universeId] });
      onSoundNodeCreated?.();
    },
    onError: (err: any) => toast.error(err.message ?? 'Lip-sync failed'),
  });

  // Volume update mutation
  const updateVolume = useMutation({
    mutationFn: (input: { nodeId: string; volume: number }) =>
      trpcClient.sceneAudio.updateSoundNode.mutate(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sound-nodes', universeId] }),
  });

  // Delete sound node mutation
  const deleteSoundNode = useMutation({
    mutationFn: (nodeId: string) => trpcClient.sceneAudio.deleteSoundNode.mutate({ nodeId }),
    onSuccess: () => {
      toast.success('Sound node deleted');
      queryClient.invalidateQueries({ queryKey: ['sound-nodes', universeId] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Delete failed'),
  });

  const isProcessing = createMusic.isPending || createSFX.isPending || runLipsync.isPending;

  if (selectedClips.length === 0) return null;

  const togglePanel = (panel: 'music' | 'sfx' | 'lipsync' | 'mixer') => {
    setActivePanel(activePanel === panel ? null : panel);
    setLastResult(null);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl">
      {/* Expanded panel */}
      {activePanel && (
        <div className="mb-2 rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl p-4 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
          {/* Music panel */}
          {activePanel === 'music' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Music className="w-4 h-4 text-purple-500" />
                  Background Music
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setActivePanel(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Genre presets */}
              <div className="flex flex-wrap gap-1">
                {MUSIC_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={musicPrompt === p.prompt ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setMusicPrompt(p.prompt)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              {/* Custom prompt */}
              <textarea
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                placeholder="Describe the background music..."
                className="w-full h-16 text-xs rounded-md border bg-background px-2 py-1.5 resize-none"
              />

              {/* Duration + Volume */}
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-muted-foreground">
                    Duration: {musicDuration}s
                  </label>
                  <Slider
                    value={[musicDuration]}
                    min={5}
                    max={47}
                    step={1}
                    onValueChange={([v]) => setMusicDuration(v)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label className="text-[10px] text-muted-foreground">
                    Volume: {Math.round(musicVolume * 100)}%
                  </label>
                  <Slider
                    value={[musicVolume]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setMusicVolume(v)}
                  />
                </div>
              </div>

              {/* Generate button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  ~6 credits | Spans {selectedClips.length} clip
                  {selectedClips.length > 1 ? 's' : ''}
                </span>
                <Button
                  size="sm"
                  className="h-7"
                  onClick={() => createMusic.mutate()}
                  disabled={!musicPrompt || isProcessing}
                >
                  {createMusic.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Music className="w-3 h-3 mr-1" />
                  )}
                  Generate Music
                </Button>
              </div>

              {/* Result player */}
              {lastResult?.type === 'music' && lastResult.audioUrl && (
                <AudioPlayer src={lastResult.audioUrl} title="Generated Background Music" />
              )}
            </>
          )}

          {/* SFX panel */}
          {activePanel === 'sfx' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Waves className="w-4 h-4 text-amber-500" />
                  Sound Effects
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setActivePanel(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* SFX presets */}
              <div className="flex flex-wrap gap-1">
                {SFX_PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    variant={sfxPrompt === p.prompt ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setSfxPrompt(p.prompt)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              {/* Custom prompt */}
              <textarea
                value={sfxPrompt}
                onChange={(e) => setSfxPrompt(e.target.value)}
                placeholder="Describe the sound effect (e.g., rain on metal roof, footsteps on gravel)..."
                className="w-full h-16 text-xs rounded-md border bg-background px-2 py-1.5 resize-none"
              />

              {/* Duration + Volume */}
              <div className="flex gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] text-muted-foreground">
                    Duration: {sfxDuration}s
                  </label>
                  <Slider
                    value={[sfxDuration]}
                    min={1}
                    max={22}
                    step={0.5}
                    onValueChange={([v]) => setSfxDuration(v)}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label className="text-[10px] text-muted-foreground">
                    Volume: {Math.round(sfxVolume * 100)}%
                  </label>
                  <Slider
                    value={[sfxVolume]}
                    min={0}
                    max={1}
                    step={0.05}
                    onValueChange={([v]) => setSfxVolume(v)}
                  />
                </div>
              </div>

              {/* Generate button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  ~8 credits | Spans {selectedClips.length} clip
                  {selectedClips.length > 1 ? 's' : ''}
                </span>
                <Button
                  size="sm"
                  className="h-7"
                  onClick={() => createSFX.mutate()}
                  disabled={!sfxPrompt || isProcessing}
                >
                  {createSFX.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Waves className="w-3 h-3 mr-1" />
                  )}
                  Generate SFX
                </Button>
              </div>

              {/* Result player */}
              {lastResult?.type === 'sfx' && lastResult.audioUrl && (
                <AudioPlayer src={lastResult.audioUrl} title="Generated Sound Effect" />
              )}
            </>
          )}

          {/* Lip-sync panel */}
          {activePanel === 'lipsync' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-cyan-500" />
                  Lip Sync
                  {selectedClips.length > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      First clip only
                    </Badge>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setActivePanel(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Voice profile selector */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Voice Profile</label>
                {(voiceProfiles as any[]).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No voice profiles yet. Go to a character's wiki page to design one first.
                  </p>
                ) : (
                  <select
                    value={selectedVoiceId}
                    onChange={(e) => setSelectedVoiceId(e.target.value)}
                    className="w-full h-8 text-xs rounded-md border bg-background px-2"
                  >
                    <option value="">Select a voice...</option>
                    {(voiceProfiles as any[]).map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.characterName} ({p.gender} / {p.accent})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Dialogue text */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">
                  Dialogue (what the character says in this clip)
                </label>
                <textarea
                  value={dialogueText}
                  onChange={(e) => setDialogueText(e.target.value)}
                  placeholder="Enter the dialogue text for this scene..."
                  className="w-full h-20 text-xs rounded-md border bg-background px-2 py-1.5 resize-none"
                />
              </div>

              {/* Lip-sync button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">
                  ~7 credits (TTS + lip-sync) | Uses CV model to re-render mouth movements
                </span>
                <Button
                  size="sm"
                  className="h-7"
                  onClick={() => runLipsync.mutate()}
                  disabled={!selectedVoiceId || !dialogueText.trim() || isProcessing}
                >
                  {runLipsync.isPending ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Megaphone className="w-3 h-3 mr-1" />
                  )}
                  Sync Lips
                </Button>
              </div>

              {/* Result */}
              {lastResult?.type === 'lipsync' && lastResult.videoUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-green-600 font-medium">Lip-sync complete!</p>
                  <video
                    src={lastResult.videoUrl}
                    controls
                    className="w-full rounded-lg aspect-video bg-black"
                  />
                  {lastResult.audioUrl && (
                    <AudioPlayer src={lastResult.audioUrl} title="Dialogue Audio" compact />
                  )}
                </div>
              )}
            </>
          )}

          {/* Mixer panel — browse and adjust all sound nodes */}
          {activePanel === 'mixer' && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-green-500" />
                  Sound Mixer
                  <Badge variant="secondary" className="text-[10px]">
                    {(soundNodes as any[]).length} node
                    {(soundNodes as any[]).length !== 1 ? 's' : ''}
                  </Badge>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setActivePanel(null)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              {(soundNodes as any[]).length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No sound nodes yet. Generate music, SFX, or dialogue to see them here.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(soundNodes as any[]).map((node: any) => (
                    <div key={node.id} className="flex items-center gap-2 rounded-lg border p-2">
                      {/* Kind icon */}
                      <div className="shrink-0">
                        {node.kind === 'music' && <Music className="w-3.5 h-3.5 text-purple-400" />}
                        {node.kind === 'sfx' && <Waves className="w-3.5 h-3.5 text-amber-400" />}
                        {node.kind === 'dialogue' && (
                          <Megaphone className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                        {node.kind === 'ambient' && (
                          <Waves className="w-3.5 h-3.5 text-green-400" />
                        )}
                      </div>

                      {/* Label */}
                      <span className="text-[10px] truncate flex-1 min-w-0">
                        {node.label || `${node.kind}`}
                      </span>

                      {/* Volume slider */}
                      <div className="w-20 shrink-0">
                        <Slider
                          value={[node.volume ?? 1]}
                          min={0}
                          max={1}
                          step={0.05}
                          onValueChange={([v]) =>
                            updateVolume.mutate({ nodeId: node.id, volume: v })
                          }
                        />
                      </div>

                      {/* Volume % */}
                      <span className="text-[9px] text-muted-foreground w-7 text-right tabular-nums">
                        {Math.round((node.volume ?? 1) * 100)}%
                      </span>

                      {/* Play preview */}
                      {node.audioUrl && <AudioPlayer src={node.audioUrl} compact />}

                      {/* Delete */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteSoundNode.mutate(node.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Main toolbar bar */}
      <div className="rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl px-4 py-2.5 flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
        {/* Selection info */}
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="shrink-0">
            {selectedClips.length} clip{selectedClips.length > 1 ? 's' : ''}
          </Badge>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">
            {selectedClips[0]?.title}
            {selectedClips.length > 1 && ` +${selectedClips.length - 1}`}
          </span>
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Action buttons */}
        <Button
          variant={activePanel === 'music' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => togglePanel('music')}
          disabled={isProcessing}
        >
          <Music className="w-3.5 h-3.5" />
          Music
        </Button>

        <Button
          variant={activePanel === 'sfx' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => togglePanel('sfx')}
          disabled={isProcessing}
        >
          <Waves className="w-3.5 h-3.5" />
          Sound FX
        </Button>

        <Button
          variant={activePanel === 'lipsync' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => togglePanel('lipsync')}
          disabled={isProcessing}
        >
          <Megaphone className="w-3.5 h-3.5" />
          Lip Sync
        </Button>

        <div className="h-5 w-px bg-border" />

        {/* Mixer button — opens sound node browser */}
        <Button
          variant={activePanel === 'mixer' ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => togglePanel('mixer')}
        >
          <Volume2 className="w-3.5 h-3.5" />
          Mixer
          {(soundNodes as any[]).length > 0 && (
            <Badge variant="secondary" className="text-[9px] h-4 px-1 ml-0.5">
              {(soundNodes as any[]).length}
            </Badge>
          )}
        </Button>

        {/* Clear selection */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 ml-auto"
          onClick={onClearSelection}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
