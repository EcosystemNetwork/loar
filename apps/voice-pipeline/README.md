# LOAR Voice Pipeline

Real-time voice for the LOAR Voice Director, built on [Pipecat](https://pipecat.ai).

```
browser mic ─▶ WebSocket ─▶ Gradium STT ─▶ VAD / turn detection
                                              │
                            SambaNova LLM ◀── tool calls ──▶ LOAR backend (tRPC)
                                              │
browser speaker ◀─ WebSocket ◀─ Gradium TTS  (Hume TTS for characters with a voice)
```

Two modes, chosen by the session token LOAR mints:

| Mode        | Behaviour                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `director`  | Operates the universe with 8 tools (`get_universe_context`, `get_canon`, `get_character`, `create_story_node`, `create_story_branch`, `update_story_node`, `generate_scene`, `submit_canon_proposal`).        |
| `character` | In-persona, first person, **read-only** (no tools). Context is knowledge-scoped server-side (`director.getContext` with `perspective: "character"`) so it can't leak secrets the character hasn't discovered. |

Interruption (barge-in) is Pipecat-native: speak over the bot and its LLM/TTS output is cancelled; the browser also flushes audio it has already queued.

## How a session starts

1. The browser calls `director.createVoiceSession` on the LOAR server (signed-in user; director mode requires universe-collaborator access).
2. LOAR returns `wss://…/ws?token=…` — a **5-minute, single-use HMAC token** carrying `{universeId, mode, entityId}`.
3. The browser connects; this service verifies the token (`session.py`), checks the `Origin` allowlist, and starts a pipeline.
4. Every tool call goes to LOAR's tRPC API as the service identity (`LOAR_API_KEY`), so ownership checks and validation stay in LOAR — the pipeline never touches the database.

## Configuration

See `.env.example`. Required: `LOAR_API_BASE`, `LOAR_API_KEY`, `GRADIUM_API_KEY`, `SAMBANOVA_API_KEY`, `VOICE_SESSION_SECRET`. The service refuses to start if any is missing.

On the **LOAR server** (Railway `loar` service) set the matching pair:

- `VOICE_SESSION_SECRET` — identical to this service's value (`openssl rand -hex 32`)
- `VOICE_PIPELINE_WS_URL` — e.g. `wss://voice-pipeline-production.up.railway.app/ws`

Without those, `director.createVoiceSession` returns `SERVICE_UNAVAILABLE` and the web app falls back to push-to-talk.

Create the service API key once with `pnpm tsx scripts/create-voice-director-api-key.ts` (signs in as the demo creator and prints the key). It needs the `entities.read`, `entities.update`, `universes.read`, `generation.video` and `generation.lipsync` scopes.

> **Identity note.** Tool calls run as the service key's owner, not as the person talking. Nodes the pipeline creates are owned by that identity, and `generate_scene` uses that identity's provider (BYOK) keys — add generation keys to it before demoing scene generation.

## Run locally

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # fill in
uvicorn main:app --port 8080
pytest                 # 52 tests, no network
```

## Deploy (Railway)

`railway.json` + `Dockerfile` follow `apps/mcp-gateway`: build context is the **repo root**.

```bash
railway add --service voice-pipeline        # once
railway variables --service voice-pipeline --set "LOAR_API_BASE=https://api.loar.fun" …
railway up --service voice-pipeline         # or connect the repo and set the root config to apps/voice-pipeline/railway.json
```

Single replica by design: replay protection for session tokens is in-memory. Scale out only after moving nonces to Redis.

## Tests

- `test_session_and_config.py` — token verification (forged, expired, replayed, malformed), origin policy.
- `test_tools.py` — each tool against a fake LOAR backend: procedure, payload, result, error handling.
- `test_bot_and_prompts.py` — TTS selection (Hume → Gradium fallback), prompt contents.
- `test_pipeline_wiring.py` — builds the real Pipecat pipeline for both modes and exercises the WebSocket auth gate.
- `test_wire_compat.py` — bytes from the TypeScript client are accepted by Pipecat's real serializer and RTVI models. The mirror test (TS decoding real server bytes) is in `apps/web/src/lib/voice/__tests__/`.

## Known limits

- Live voice is verified end-to-end against real Gradium (STT + TTS) and Hume TTS with a stand-in LLM. It has **not** been exercised against SambaNova's API or from a real browser microphone.
- Reasoning latency is bounded by SambaNova + any tool round-trip; the director speaks tool results only after they return.
