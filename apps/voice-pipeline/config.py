"""Environment configuration, validated once at startup so a misconfigured
deploy fails immediately instead of on the first user's first sentence."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping

_REQUIRED = (
    "LOAR_API_BASE",
    "LOAR_API_KEY",
    "GRADIUM_API_KEY",
    "SAMBANOVA_API_KEY",
    "VOICE_SESSION_SECRET",
)


@dataclass(frozen=True)
class Settings:
    loar_api_base: str
    loar_api_key: str
    gradium_api_key: str
    sambanova_api_key: str
    voice_session_secret: str
    hume_api_key: str | None
    sambanova_model: str
    director_voice_id: str | None
    allowed_origins: tuple[str, ...]
    # Override for the SambaNova endpoint (a proxy, or a local stand-in in tests).
    sambanova_base_url: str | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        missing = [name for name in _REQUIRED if not env.get(name)]
        if missing:
            raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
        origins = tuple(o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip())
        return cls(
            loar_api_base=env["LOAR_API_BASE"],
            loar_api_key=env["LOAR_API_KEY"],
            gradium_api_key=env["GRADIUM_API_KEY"],
            sambanova_api_key=env["SAMBANOVA_API_KEY"],
            voice_session_secret=env["VOICE_SESSION_SECRET"],
            hume_api_key=env.get("HUME_API_KEY") or None,
            sambanova_model=env.get("SAMBANOVA_MODEL") or "Meta-Llama-3.3-70B-Instruct",
            director_voice_id=env.get("GRADIUM_DIRECTOR_VOICE_ID") or None,
            allowed_origins=origins,
            sambanova_base_url=env.get("SAMBANOVA_BASE_URL") or None,
        )


def origin_allowed(origin: str, allowed: tuple[str, ...]) -> bool:
    """Browsers always send Origin on WebSocket handshakes; non-browser clients
    don't, and for those the signed session token is the gate. So: no Origin is
    fine, but a present Origin must be on the allowlist ("*" allows any)."""
    if not origin:
        return True
    return "*" in allowed or origin in allowed
