import { describe, it, expect } from 'vitest';
import {
  initialVoiceState,
  stepLabel,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from '../voiceState';

const rtvi = (type: string, data?: unknown): VoiceEvent => ({
  type: 'rtvi',
  message: { label: 'rtvi-ai', type, data },
});
const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) =>
  events.reduce(voiceReducer, from);

describe('voiceReducer', () => {
  it('goes live on bot-ready and resets everything on a new connection', () => {
    const live = run([{ type: 'connecting' }, rtvi('bot-ready')]);
    expect(live.status).toBe('live');
    const again = voiceReducer(
      run([rtvi('user-transcription', { text: 'hi', final: true })], live),
      { type: 'connecting' }
    );
    expect(again.transcript).toEqual([]);
    expect(again.status).toBe('connecting');
  });

  it('merges interim transcripts into one growing entry, then starts a new one after a final', () => {
    const state = run([
      rtvi('user-transcription', { text: 'create a', final: false }),
      rtvi('user-transcription', { text: 'create a new scene', final: false }),
      rtvi('user-transcription', { text: 'Create a new scene.', final: true }),
      rtvi('user-transcription', { text: 'Make it darker', final: false }),
    ]);
    expect(state.transcript.map((e) => [e.role, e.text, e.final])).toEqual([
      ['user', 'Create a new scene.', true],
      ['user', 'Make it darker', false],
    ]);
  });

  it('does not duplicate a final transcript that the pipeline emits twice', () => {
    const state = run([
      rtvi('user-transcription', { text: 'Create a scene.', final: true }),
      rtvi('user-transcription', { text: 'Create a scene.', final: true }),
    ]);
    expect(state.transcript).toHaveLength(1);
    const next = run([rtvi('user-transcription', { text: 'And another.', final: true })], state);
    expect(next.transcript).toHaveLength(2);
  });

  it('upserts bot output by segment id so streaming updates do not duplicate lines', () => {
    const state = run([
      rtvi('bot-output', { text: 'Kira found', segment_id: 3 }),
      rtvi('bot-output', { text: 'Kira found the archive.', segment_id: 3 }),
      rtvi('bot-output', { text: 'Anything else?', segment_id: 4 }),
    ]);
    expect(state.transcript.map((e) => e.text)).toEqual([
      'Kira found the archive.',
      'Anything else?',
    ]);
  });

  it('interleaves user and bot turns in order', () => {
    const state = run([
      rtvi('user-transcription', { text: 'Hello', final: true }),
      rtvi('bot-output', { text: 'Hi there.', segment_id: 1 }),
      rtvi('user-transcription', { text: 'Stop', final: true }),
    ]);
    expect(state.transcript.map((e) => e.role)).toEqual(['user', 'bot', 'user']);
  });

  it('ignores empty transcripts and tracks who is speaking', () => {
    const state = run([
      rtvi('user-transcription', { text: '   ', final: true }),
      rtvi('user-started-speaking'),
      rtvi('bot-started-speaking'),
    ]);
    expect(state.transcript).toEqual([]);
    expect(state.userSpeaking && state.botSpeaking).toBe(true);
    const done = run([rtvi('user-stopped-speaking'), rtvi('bot-stopped-speaking')], state);
    expect(done.userSpeaking || done.botSpeaking).toBe(false);
  });

  it('tracks a tool call from in-progress to done, keeping its name', () => {
    const inProgress = run([
      rtvi('llm-function-call-in-progress', { tool_call_id: 'c1', function_name: 'get_canon' }),
    ]);
    expect(stepLabel(inProgress.steps[0])).toBe('Checking canon…');

    const done = run(
      [rtvi('llm-function-call-stopped', { tool_call_id: 'c1', cancelled: false })],
      inProgress
    );
    expect(done.steps).toHaveLength(1);
    expect(done.steps[0]).toMatchObject({ name: 'get_canon', done: true, cancelled: false });
    expect(stepLabel(done.steps[0])).toBe('Checked canon');
  });

  it('marks a cancelled tool call (e.g. the user interrupted mid-action)', () => {
    const state = run([
      rtvi('llm-function-call-in-progress', {
        tool_call_id: 'c2',
        function_name: 'create_story_node',
      }),
      rtvi('llm-function-call-stopped', { tool_call_id: 'c2', cancelled: true }),
    ]);
    expect(state.steps[0]).toMatchObject({ done: false, cancelled: true });
    expect(stepLabel(state.steps[0])).toBe('Created a scene (cancelled)');
  });

  it('shows a stopped call even if the in-progress event was missed, and caps the checklist', () => {
    const orphan = run([
      rtvi('llm-function-call-stopped', {
        tool_call_id: 'x',
        function_name: 'get_character',
        cancelled: false,
      }),
    ]);
    expect(orphan.steps[0].name).toBe('get_character');

    const many = run(
      Array.from({ length: 20 }, (_, i) =>
        rtvi('llm-function-call-in-progress', { tool_call_id: `c${i}`, function_name: 'get_canon' })
      )
    );
    expect(many.steps).toHaveLength(12);
    expect(many.steps[11].id).toBe('c19');
  });

  it('counts story-changing server messages and ignores other server messages', () => {
    const state = run([
      rtvi('server-message', { type: 'loar_story_changed', action: 'created', nodeId: 4 }),
      rtvi('server-message', { type: 'something_else' }),
      rtvi('server-message', { type: 'loar_story_changed', action: 'updated', nodeId: 4 }),
    ]);
    expect(state.storyChanges).toBe(2);
  });

  it('only a fatal RTVI error flips to the error state; close/failed events set status', () => {
    expect(run([rtvi('error', { error: 'blip', fatal: false })]).status).toBe('idle');
    const fatal = run([rtvi('error', { error: 'boom', fatal: true })]);
    expect(fatal).toMatchObject({ status: 'error', error: 'boom' });
    expect(run([{ type: 'failed', message: 'nope' }]).error).toBe('nope');
    expect(run([{ type: 'closed', reason: 'expired' }])).toMatchObject({
      status: 'closed',
      error: 'expired',
    });
  });

  it('returns the same state object for events it does not handle (no needless re-renders)', () => {
    expect(voiceReducer(initialVoiceState, rtvi('bot-llm-started'))).toBe(initialVoiceState);
  });
});
