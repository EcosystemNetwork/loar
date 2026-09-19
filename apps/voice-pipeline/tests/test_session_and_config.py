"""Session-token verification and config: the security perimeter of the service."""

import base64
import hashlib
import hmac
import json

import pytest

from config import Settings, origin_allowed
from session import SessionVerifier

SECRET = "test-secret"
NOW = 1_700_000_000.0


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(secret: str = SECRET, **overrides) -> str:
    claims = {
        "v": 1,
        "universeId": "0xabc",
        "mode": "director",
        "uid": "u1",
        "exp": NOW + 300,
        "nonce": "n-1",
        **overrides,
    }
    payload = _b64(json.dumps(claims).encode())
    sig = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def test_accepts_a_valid_token_and_returns_claims():
    claims = SessionVerifier(SECRET).verify(make_token(), now=NOW)
    assert claims and claims["universeId"] == "0xabc" and claims["mode"] == "director"


def test_rejects_wrong_secret():
    assert SessionVerifier(SECRET).verify(make_token(secret="other"), now=NOW) is None


def test_rejects_tampered_payload():
    payload, sig = make_token().split(".")
    forged = _b64(json.dumps({"v": 1, "universeId": "victim", "mode": "director", "exp": NOW + 300, "nonce": "x"}).encode())
    assert SessionVerifier(SECRET).verify(f"{forged}.{sig}", now=NOW) is None


def test_rejects_expired_token():
    assert SessionVerifier(SECRET).verify(make_token(exp=NOW - 1), now=NOW) is None


def test_token_is_single_use():
    verifier = SessionVerifier(SECRET)
    token = make_token()
    assert verifier.verify(token, now=NOW) is not None
    assert verifier.verify(token, now=NOW) is None


def test_expired_nonces_are_pruned():
    verifier = SessionVerifier(SECRET)
    verifier.verify(make_token(nonce="old", exp=NOW + 10), now=NOW)
    verifier.verify(make_token(nonce="new", exp=NOW + 500), now=NOW + 100)
    assert "old" not in verifier._used


@pytest.mark.parametrize(
    "overrides",
    [
        {"mode": "root"},  # unknown mode
        {"mode": "character"},  # character mode without an entityId
        {"universeId": ""},
        {"v": 2},
        {"nonce": ""},
    ],
)
def test_rejects_malformed_claims(overrides):
    assert SessionVerifier(SECRET).verify(make_token(**overrides), now=NOW) is None


@pytest.mark.parametrize("garbage", ["", "no-dot", "a.b", "....", "%%%.%%%"])
def test_rejects_garbage_without_raising(garbage):
    assert SessionVerifier(SECRET).verify(garbage, now=NOW) is None


def test_character_token_with_entity_is_accepted():
    claims = SessionVerifier(SECRET).verify(make_token(mode="character", entityId="e1"), now=NOW)
    assert claims and claims["entityId"] == "e1"


def test_verifier_requires_a_secret():
    with pytest.raises(ValueError):
        SessionVerifier("")


def test_settings_from_env_reports_every_missing_variable():
    with pytest.raises(RuntimeError) as err:
        Settings.from_env({"LOAR_API_BASE": "x"})
    for name in ("LOAR_API_KEY", "GRADIUM_API_KEY", "SAMBANOVA_API_KEY", "VOICE_SESSION_SECRET"):
        assert name in str(err.value)


def test_settings_defaults_and_optional_values():
    env = {
        "LOAR_API_BASE": "https://api.example",
        "LOAR_API_KEY": "k",
        "GRADIUM_API_KEY": "g",
        "SAMBANOVA_API_KEY": "s",
        "VOICE_SESSION_SECRET": "v",
        "ALLOWED_ORIGINS": " https://a.example , https://b.example ,",
    }
    s = Settings.from_env(env)
    assert s.sambanova_model == "Meta-Llama-3.3-70B-Instruct"
    assert s.hume_api_key is None and s.director_voice_id is None
    assert s.allowed_origins == ("https://a.example", "https://b.example")


def test_origin_policy():
    allowed = ("https://loar.fun",)
    assert origin_allowed("", allowed)  # non-browser client: the token is the gate
    assert origin_allowed("https://loar.fun", allowed)
    assert not origin_allowed("https://evil.example", allowed)
    assert not origin_allowed("https://loar.fun.evil.example", allowed)
    assert origin_allowed("https://anything", ("*",))
    assert not origin_allowed("https://loar.fun", ())  # empty allowlist denies browsers
