/**
 * /lab/voice-studio — LOAR Voice Studio.
 *
 * Pro voice editing pipeline:
 *   Library     — curated catalog of signature LOAR voices (~50)
 *   My Voices   — user's saved/cloned/designed voices
 *   Create      — design a brand-new voice from a prompt (parametric synthesis)
 *   Clone       — drag-drop audio samples → ElevenLabs instant clone
 *   Mix         — cross-cast a performance from one owned/licensed voice into another's timbre
 *   Script      — script-first episode dubbing (cast + generate + composite)
 *   Multi-track — pro waveform editor (wavesurfer.js)
 *   Multilingual — episode dubbing across N languages via ElevenLabs Dubbing API
 *
 * Optional ?episodeId=… query param scopes the Script + Multilingual tabs
 * to a specific episode.
 */

import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import {
  Mic2,
  Library,
  UserCircle,
  Upload,
  FileText,
  Layers,
  Globe,
  Wand2,
  Shuffle,
  Captions,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VoiceLibrary } from '@/components/voice-studio/VoiceLibrary';
import { MyVoices } from '@/components/voice-studio/MyVoices';
import { VoiceDesigner } from '@/components/voice-studio/VoiceDesigner';
import { VoiceCloneUpload } from '@/components/voice-studio/VoiceCloneUpload';
import { VoiceMixer } from '@/components/voice-studio/VoiceMixer';
import { ScriptEditor } from '@/components/voice-studio/ScriptEditor';
import { MultiTrackEditor } from '@/components/voice-studio/MultiTrackEditor';
import { MultilingualPanel } from '@/components/voice-studio/MultilingualPanel';
import { CaptionsPanel } from '@/components/voice-studio/CaptionsPanel';

const searchSchema = z.object({
  episodeId: z.string().optional(),
  tab: z
    .enum([
      'library',
      'mine',
      'create',
      'clone',
      'mix',
      'script',
      'multitrack',
      'multilingual',
      'captions',
    ])
    .optional(),
  projectId: z.string().optional(),
});

export const Route = createFileRoute('/lab/voice-studio')({
  validateSearch: searchSchema,
  component: VoiceStudioPage,
});

function VoiceStudioPage() {
  const { address } = useWalletAuth();
  const { episodeId, tab: initialTab, projectId: initialProjectId } = Route.useSearch();
  const [tab, setTab] = useState<string>(initialTab ?? 'library');
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Voice Studio</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to enter the studio.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Mic2 className="size-7 text-sky-400" />
            Voice Studio
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Cast, clone, script, dub, and edit voices end-to-end. Powered by ElevenLabs Flash v2.5 ·
            v3 · Dubbing · Instant Clone. {episodeId ? `Scoped to episode ${episodeId}.` : null}
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid grid-cols-4 lg:grid-cols-9">
          <TabsTrigger value="library">
            <Library className="mr-1 size-3.5" /> Library
          </TabsTrigger>
          <TabsTrigger value="mine">
            <UserCircle className="mr-1 size-3.5" /> My Voices
          </TabsTrigger>
          <TabsTrigger value="create">
            <Wand2 className="mr-1 size-3.5" /> Create
          </TabsTrigger>
          <TabsTrigger value="clone">
            <Upload className="mr-1 size-3.5" /> Clone
          </TabsTrigger>
          <TabsTrigger value="mix">
            <Shuffle className="mr-1 size-3.5" /> Mix
          </TabsTrigger>
          <TabsTrigger value="script">
            <FileText className="mr-1 size-3.5" /> Script
          </TabsTrigger>
          <TabsTrigger value="multitrack">
            <Layers className="mr-1 size-3.5" /> Multi-track
          </TabsTrigger>
          <TabsTrigger value="multilingual">
            <Globe className="mr-1 size-3.5" /> Multilingual
          </TabsTrigger>
          <TabsTrigger value="captions">
            <Captions className="mr-1 size-3.5" /> Captions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          <VoiceLibrary />
        </TabsContent>
        <TabsContent value="mine" className="mt-4">
          <MyVoices />
        </TabsContent>
        <TabsContent value="create" className="mt-4">
          <VoiceDesigner />
        </TabsContent>
        <TabsContent value="clone" className="mt-4">
          <VoiceCloneUpload />
        </TabsContent>
        <TabsContent value="mix" className="mt-4">
          <VoiceMixer />
        </TabsContent>
        <TabsContent value="script" className="mt-4">
          <ScriptEditor episodeId={episodeId} initialProjectId={projectId} />
        </TabsContent>
        <TabsContent value="multitrack" className="mt-4">
          <MultiTrackEditor projectId={projectId} onSelectProject={setProjectId} />
        </TabsContent>
        <TabsContent value="multilingual" className="mt-4">
          <MultilingualPanel episodeId={episodeId} />
        </TabsContent>
        <TabsContent value="captions" className="mt-4">
          <CaptionsPanel episodeId={episodeId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
