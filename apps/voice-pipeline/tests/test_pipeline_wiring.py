"""End-to-end wiring without the network.

`run_bot` is run for real — Pipecat services, aggregators, transport, task and
RTVI are all constructed exactly as in production — but the runner is stubbed
so no audio flows and no provider is contacted. This catches API misuse
(wrong kwargs, missing handlers) that unit tests on the pieces can't.
"""

import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pipecat.services.gradium.stt import GradiumSTTService
from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.services.hume.tts import HumeTTSService
from pipecat.services.sambanova.llm import SambaNovaLLMService

import bot
import main
from config import Settings
from loar_client import LoarClient

DIRECTOR_CONTEXT = {
    "universeName": "Meridian",
    "characters": [{"id": "e-kira", "name": "Kira Voss"}],
    "nodes": [{"nodeId": 1, "previousNodeId": 0, "title": "Ep 1", "plot": "p", "canon": True}],
    "context": "ctx",
    "entity": None,
    "voice": None,
}
CHARACTER_CONTEXT = {
    "universeName": "Meridian",
    "characters": [],
    "nodes": [],
    "context": "[CHARACTER: Kira Voss]\nShe trusts Reyes.",
    "entity": {"id": "e-kira", "name": "Kira Voss"},
    "voice": {"humeVoiceId": "hume-kira", "humeVoiceDescription": "wary"},
}


class CapturedRun:
    def __init__(self):
        self.task = None

    async def run(self, task):
        self.task = task


@pytest.fixture
def harness(monkeypatch):
    """Stub the LOAR backend and the Pipecat runner; expose what was built."""
    seen_requests = []

    def loar(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.url.params["input"])["0"]
        seen_requests.append(payload)
        data = CHARACTER_CONTEXT if payload["perspective"] == "character" else DIRECTOR_CONTEXT
        return httpx.Response(200, json=[{"result": {"data": data}}])

    real_client = bot.LoarClient
    monkeypatch.setattr(
        bot,
        "LoarClient",
        lambda base, key: real_client(base, key, transport=httpx.MockTransport(loar)),
    )
    runner = CapturedRun()
    monkeypatch.setattr(bot, "WorkerRunner", lambda **_: runner)
    fake_ws = SimpleNamespace(client_state=None, application_state=None)
    return SimpleNamespace(runner=runner, ws=fake_ws, requests=seen_requests)


def settings() -> Settings:
    return Settings.from_env()


def processors_of(task):
    """Every processor in the built pipeline, flattened through nested pipelines."""

    def flatten(processor):
        children = getattr(processor, "processors", None)
        if children is None:
            return [processor]
        children = children() if callable(children) else children
        return [processor, *(leaf for child in children for leaf in flatten(child))]

    return flatten(task.pipeline)


async def test_director_mode_builds_the_full_tool_calling_pipeline(harness):
    claims = {"mode": "director", "universeId": "0xabc"}
    await bot.run_bot(harness.ws, claims, settings())

    assert harness.requests == [{"universeId": "0xabc", "perspective": "director"}]
    task = harness.runner.task
    assert task is not None

    kinds = [type(p) for p in processors_of(task)]
    assert GradiumSTTService in kinds
    assert SambaNovaLLMService in kinds
    assert GradiumTTSService in kinds

    llm = next(p for p in processors_of(task) if isinstance(p, SambaNovaLLMService))
    assert llm._settings.model == "Meta-Llama-3.3-70B-Instruct"
    assert "Voice Director" in llm._settings.system_instruction
    assert "Ep 1" in llm._settings.system_instruction  # the story tree is in the prompt
    registered = set(llm._functions)
    assert {"create_story_node", "create_story_branch", "update_story_node",
            "get_canon", "get_character", "get_universe_context",
            "generate_scene", "submit_canon_proposal"} <= registered


async def test_character_mode_is_read_only_and_speaks_with_the_characters_own_hume_voice(harness):
    claims = {"mode": "character", "universeId": "0xabc", "entityId": "e-kira"}
    await bot.run_bot(harness.ws, claims, settings())

    assert harness.requests == [
        {"universeId": "0xabc", "entityId": "e-kira", "perspective": "character"}
    ]
    procs = processors_of(harness.runner.task)
    llm = next(p for p in procs if isinstance(p, SambaNovaLLMService))
    assert not llm._functions  # a character can't mutate the universe
    assert "She trusts Reyes." in llm._settings.system_instruction
    tts = next(p for p in procs if isinstance(p, HumeTTSService))
    assert tts._settings.voice == "hume-kira"


# ── WebSocket auth gate ───────────────────────────────────────────────


def token(secret="app-test-secret", **overrides) -> str:
    claims = {
        "v": 1, "universeId": "0xabc", "mode": "director", "uid": "u",
        "exp": time.time() + 300, "nonce": overrides.pop("nonce", "n-app"), **overrides,
    }
    b = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=").decode()
    payload = b(json.dumps(claims).encode())
    return f"{payload}.{b(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())}"


def rejected(client: TestClient, url: str, **kwargs) -> bool:
    try:
        with client.websocket_connect(url, **kwargs):
            return False
    except Exception:
        return True


def test_health_reports_providers_without_leaking_secrets():
    body = TestClient(main.app).get("/health").json()
    assert body["status"] == "ok"
    assert body["providers"]["hume"] is True
    assert "gsk_test" not in json.dumps(body) and "sn_test" not in json.dumps(body)


def test_ws_rejects_missing_forged_and_disallowed_origin_connections(monkeypatch):
    monkeypatch.setattr(main, "run_bot", lambda *a, **k: None)
    client = TestClient(main.app)
    assert rejected(client, "/ws")
    assert rejected(client, "/ws?token=garbage")
    assert rejected(client, f"/ws?token={token(secret='wrong')}")
    assert rejected(client, f"/ws?token={token(nonce='n-origin')}", headers={"origin": "https://evil.example"})


def test_ws_accepts_a_valid_token_once_and_hands_claims_to_the_bot(monkeypatch):
    received = []

    async def fake_run_bot(websocket, claims, _settings):
        received.append(claims)

    monkeypatch.setattr(main, "run_bot", fake_run_bot)
    client = TestClient(main.app)
    url = f"/ws?token={token(nonce='n-once')}"

    with client.websocket_connect(url, headers={"origin": "https://loar.fun"}):
        pass
    assert received and received[0]["universeId"] == "0xabc"

    assert rejected(client, url, headers={"origin": "https://loar.fun"})  # replay refused
