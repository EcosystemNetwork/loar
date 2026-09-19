"""Verification of the session tokens LOAR mints for live voice sessions.

Token format (must stay in sync with apps/server/src/services/voice-session.ts):

    base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, first_segment))

A token is accepted once: expired, tampered, or replayed tokens are rejected,
so the WebSocket endpoint can only be driven by clients LOAR authenticated.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

_MODES = ("director", "character")


def _b64url_decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


class SessionVerifier:
    def __init__(self, secret: str) -> None:
        if not secret:
            raise ValueError("VOICE_SESSION_SECRET must be set")
        self._secret = secret.encode()
        # nonce -> exp. Single-replica service, so in-memory replay protection
        # is sufficient; entries are pruned once their token has expired.
        self._used: dict[str, float] = {}

    def verify(self, token: str, now: float | None = None) -> dict[str, Any] | None:
        now = time.time() if now is None else now

        try:
            payload_b64, sig_b64 = token.split(".")
            given = _b64url_decode(sig_b64)
            claims = json.loads(_b64url_decode(payload_b64))
        except Exception:
            return None

        expected = hmac.new(self._secret, payload_b64.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected, given):
            return None

        if not isinstance(claims, dict) or claims.get("v") != 1:
            return None
        if float(claims.get("exp", 0)) < now:
            return None
        mode = claims.get("mode")
        if mode not in _MODES or not claims.get("universeId"):
            return None
        if mode == "character" and not claims.get("entityId"):
            return None

        nonce = claims.get("nonce")
        if not isinstance(nonce, str) or not nonce:
            return None
        self._prune(now)
        if nonce in self._used:
            return None
        self._used[nonce] = float(claims["exp"])
        return claims

    def _prune(self, now: float) -> None:
        for nonce in [n for n, exp in self._used.items() if exp < now]:
            del self._used[nonce]
