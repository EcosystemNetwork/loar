"""Minimal tRPC-over-HTTP client for LOAR's backend.

LOAR's tRPC router has no transformer, so the wire format is plain JSON:
mutations POST `{"0": input}` to `/trpc/<proc>?batch=1`, queries GET the same
path with `input` URL-encoded. Auth is the service API key
(`Authorization: Bearer loar_...`, see scripts/create-voice-director-api-key.ts).
"""

from __future__ import annotations

import json
from typing import Any

import httpx


class LoarError(Exception):
    """A tRPC error returned by LOAR, carrying its human-readable message."""


def _unwrap(response: httpx.Response, procedure: str) -> Any:
    try:
        body = response.json()
    except ValueError as exc:
        raise LoarError(f"{procedure}: non-JSON response ({response.status_code})") from exc

    item = body[0] if isinstance(body, list) and body else body
    if isinstance(item, dict) and "error" in item:
        err = item["error"]
        message = (
            err.get("message")
            or (err.get("json") or {}).get("message")
            or f"HTTP {response.status_code}"
        )
        raise LoarError(f"{procedure}: {message}")
    try:
        return item["result"]["data"]
    except (KeyError, TypeError) as exc:
        raise LoarError(f"{procedure}: unexpected response shape") from exc


class LoarClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
            transport=transport,
        )

    async def query(self, procedure: str, payload: dict[str, Any]) -> Any:
        response = await self._http.get(
            f"/trpc/{procedure}",
            params={"batch": "1", "input": json.dumps({"0": payload})},
        )
        return _unwrap(response, procedure)

    async def mutate(self, procedure: str, payload: dict[str, Any]) -> Any:
        response = await self._http.post(
            f"/trpc/{procedure}", params={"batch": "1"}, json={"0": payload}
        )
        return _unwrap(response, procedure)

    async def aclose(self) -> None:
        await self._http.aclose()
