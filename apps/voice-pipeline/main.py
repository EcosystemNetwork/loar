"""LOAR Voice Pipeline — HTTP/WebSocket entrypoint.

    GET  /health   liveness + which providers are configured (never secrets)
    WS   /ws       ?token=<signed session token minted by LOAR's
                   director.createVoiceSession>; speaks Pipecat's protobuf
                   frame protocol, so the browser uses
                   @pipecat-ai/websocket-transport.
"""

from __future__ import annotations

import sys

from fastapi import FastAPI, WebSocket
from loguru import logger

from bot import run_bot
from config import Settings, origin_allowed
from session import SessionVerifier

logger.remove()
logger.add(sys.stderr, level="INFO")

settings = Settings.from_env()
verifier = SessionVerifier(settings.voice_session_secret)
app = FastAPI(title="LOAR Voice Pipeline")

# Close code 4003 mirrors Pipecat's own runner for rejected handshakes.
_REJECT = 4003


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "providers": {
            "sambanova": True,
            "gradium": True,
            "hume": bool(settings.hume_api_key),
        },
    }


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    if not origin_allowed(websocket.headers.get("origin", ""), settings.allowed_origins):
        logger.warning("ws rejected: origin not allowed")
        await websocket.close(code=_REJECT)
        return

    token = websocket.query_params.get("token")
    claims = verifier.verify(token) if token else None
    if claims is None:
        logger.warning("ws rejected: invalid, expired, or replayed session token")
        await websocket.close(code=_REJECT)
        return

    await websocket.accept()
    try:
        await run_bot(websocket, claims, settings)
    except Exception:
        logger.exception("voice session crashed")
        await websocket.close(code=1011)
