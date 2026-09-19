/**
 * Pure state for a live voice conversation, driven by RTVI events from the
 * pipeline. Kept free of React and browser APIs so the trickiest behaviours —
 * interim-vs-final transcript merging and tool-call bookkeeping — are unit
 * tested.
 */
import type { RtviMessage } from './pipecatProtocol';

export type VoiceStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'bot';
  text: string;
  /** False while a user utterance is still being transcribed (interim). */
  final: boolean;
}

export interface ToolStep {
  id: string;
  name: string;
  done: boolean;
  cancelled: boolean;
}

export interface VoiceState {
  status: VoiceStatus;
  error: string | null;
  userSpeaking: boolean;
  botSpeaking: boolean;
  transcript: TranscriptEntry[];
  steps: ToolStep[];
  /** Increments each time a tool reports it changed the story — effects key off it. */
  storyChanges: number;
  nextId: number;
}

export const initialVoiceState: VoiceState = {
  status: 'idle',
  error: null,
  userSpeaking: false,
  botSpeaking: false,
  transcript: [],
  steps: [],
  storyChanges: 0,
  nextId: 1,
};

export type VoiceEvent =
  | { type: 'connecting' }
  | { type: 'closed'; reason?: string }
  | { type: 'failed'; message: string }
  | { type: 'rtvi'; message: RtviMessage };

const MAX_STEPS = 12;

/** Spoken-friendly labels for each tool: what it's doing, and what it did. */
export const TOOL_LABELS: Record<string, { active: string; done: string }> = {
  get_universe_context: { active: 'Reading the universe…', done: 'Read the universe' },
  get_canon: { active: 'Checking canon…', done: 'Checked canon' },
  get_character: { active: 'Looking up a character…', done: 'Looked up a character' },
  create_story_node: { active: 'Creating a scene…', done: 'Created a scene' },
  create_story_branch: { active: 'Branching the story…', done: 'Created an alternate branch' },
  update_story_node: { active: 'Revising the scene…', done: 'Revised the scene' },
  generate_scene: { active: 'Starting scene generation…', done: 'Started scene generation' },
  submit_canon_proposal: { active: 'Opening a canon vote…', done: 'Opened a canon vote' },
};

export function stepLabel(step: ToolStep): string {
  const labels = TOOL_LABELS[step.name];
  if (step.cancelled) return `${labels?.done ?? step.name} (cancelled)`;
  if (!labels) return step.name;
  return step.done ? labels.done : labels.active;
}

function upsertUserTranscript(state: VoiceState, text: string, final: boolean): VoiceState {
  const last = state.transcript[state.transcript.length - 1];
  // Providers can re-emit the same final transcript (e.g. an end-of-turn
  // signal followed by the aggregator's own final); don't show it twice.
  if (last && last.role === 'user' && last.final && last.text === text) return state;
  if (last && last.role === 'user' && !last.final) {
    const updated = { ...last, text, final };
    return { ...state, transcript: [...state.transcript.slice(0, -1), updated] };
  }
  const entry: TranscriptEntry = { id: `t${state.nextId}`, role: 'user', text, final };
  return { ...state, transcript: [...state.transcript, entry], nextId: state.nextId + 1 };
}

function upsertBotOutput(state: VoiceState, text: string, segmentId: unknown): VoiceState {
  if (segmentId !== undefined && segmentId !== null) {
    const id = `b${segmentId}`;
    const index = state.transcript.findIndex((e) => e.id === id);
    if (index >= 0) {
      const transcript = state.transcript.slice();
      transcript[index] = { ...transcript[index], text };
      return { ...state, transcript };
    }
    return { ...state, transcript: [...state.transcript, { id, role: 'bot', text, final: true }] };
  }
  const entry: TranscriptEntry = { id: `t${state.nextId}`, role: 'bot', text, final: true };
  return { ...state, transcript: [...state.transcript, entry], nextId: state.nextId + 1 };
}

function withStep(state: VoiceState, step: ToolStep): VoiceState {
  const steps = [...state.steps.filter((s) => s.id !== step.id), step];
  return { ...state, steps: steps.slice(-MAX_STEPS) };
}

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case 'connecting':
      return { ...initialVoiceState, status: 'connecting' };
    case 'closed':
      return {
        ...state,
        status: 'closed',
        userSpeaking: false,
        botSpeaking: false,
        error: event.reason ?? state.error,
      };
    case 'failed':
      return {
        ...state,
        status: 'error',
        userSpeaking: false,
        botSpeaking: false,
        error: event.message,
      };
    case 'rtvi':
      return applyRtvi(state, event.message);
  }
}

function applyRtvi(state: VoiceState, msg: RtviMessage): VoiceState {
  const data = msg.data ?? {};
  switch (msg.type) {
    case 'bot-ready':
      return { ...state, status: 'live', error: null };
    case 'user-started-speaking':
      return { ...state, userSpeaking: true };
    case 'user-stopped-speaking':
      return { ...state, userSpeaking: false };
    case 'bot-started-speaking':
      return { ...state, botSpeaking: true };
    case 'bot-stopped-speaking':
      return { ...state, botSpeaking: false };
    case 'user-transcription':
      return typeof data.text === 'string' && data.text.trim()
        ? upsertUserTranscript(state, data.text, Boolean(data.final))
        : state;
    case 'bot-output':
      return typeof data.text === 'string' && data.text.trim()
        ? upsertBotOutput(state, data.text, data.segment_id)
        : state;
    case 'llm-function-call-in-progress':
      return withStep(state, {
        id: String(data.tool_call_id ?? state.nextId),
        name: String(data.function_name ?? 'tool'),
        done: false,
        cancelled: false,
      });
    case 'llm-function-call-stopped': {
      const id = String(data.tool_call_id ?? '');
      const existing = state.steps.find((s) => s.id === id);
      return withStep(state, {
        id,
        name: String(data.function_name ?? existing?.name ?? 'tool'),
        done: !data.cancelled,
        cancelled: Boolean(data.cancelled),
      });
    }
    case 'server-message':
      return data.type === 'loar_story_changed'
        ? { ...state, storyChanges: state.storyChanges + 1 }
        : state;
    case 'error':
      return data.fatal
        ? { ...state, status: 'error', error: String(data.error ?? 'Voice error') }
        : state;
    default:
      return state;
  }
}
