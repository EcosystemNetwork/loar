"""TTS selection and prompt assembly — the choices that decide what the user hears."""

from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.services.hume.tts import HumeTTSService

from bot import select_tts
from config import Settings
from prompts import character_prompt, director_prompt


def make_settings(**overrides) -> Settings:
    base = dict(
        loar_api_base="https://loar.test",
        loar_api_key="k",
        gradium_api_key="g",
        sambanova_api_key="s",
        voice_session_secret="v",
        hume_api_key="h",
        sambanova_model="Meta-Llama-3.3-70B-Instruct",
        director_voice_id=None,
        allowed_origins=(),
    )
    return Settings(**{**base, **overrides})


def test_character_with_a_hume_voice_speaks_through_hume_with_its_acting_description():
    tts = select_tts(
        make_settings(), {"humeVoiceId": "hume-kira", "humeVoiceDescription": "wary, low, precise"}
    )
    assert isinstance(tts, HumeTTSService)
    assert tts._settings.voice == "hume-kira"
    assert tts._settings.description == "wary, low, precise"


def test_hume_voice_without_a_hume_key_falls_back_to_gradium_rather_than_failing():
    tts = select_tts(make_settings(hume_api_key=None), {"humeVoiceId": "hume-kira"})
    assert isinstance(tts, GradiumTTSService)


def test_gradium_voice_id_is_used_when_there_is_no_hume_voice():
    tts = select_tts(make_settings(), {"gradiumVoiceId": "grad-1"})
    assert isinstance(tts, GradiumTTSService)
    assert tts._settings.voice == "grad-1"


def test_director_and_unassigned_characters_get_the_configured_or_default_gradium_voice():
    configured = select_tts(make_settings(director_voice_id="dir-voice"), None)
    assert configured._settings.voice == "dir-voice"
    default = select_tts(make_settings(), {})
    assert isinstance(default, GradiumTTSService)


NODES = [
    {"nodeId": 1, "previousNodeId": 0, "title": "Ep 1 — Static", "canon": True},
    {"nodeId": 2, "previousNodeId": 1, "title": "Ep 2 — Vault", "canon": False},
]


def test_director_prompt_lists_characters_and_nodes_with_ids_and_leaves_no_placeholders():
    prompt = director_prompt("Meridian", [{"id": "a", "name": "Kira Voss"}], NODES)
    assert 'universe "Meridian"' in prompt
    assert "Kira Voss" in prompt
    assert "#1 Ep 1 — Static [canon]" in prompt
    assert "#2 Ep 2 — Vault (follows #1)" in prompt
    assert "{" not in prompt and "}" not in prompt


def test_director_prompt_handles_an_empty_universe():
    prompt = director_prompt("Blank", [], [])
    assert "(no story nodes yet)" in prompt and "(none yet)" in prompt


def test_director_prompt_encodes_the_safety_and_canon_rules():
    prompt = director_prompt("M", [], [])
    assert "alternate branch" in prompt  # contradiction → branch, not overwrite
    assert "deletion isn't available by voice" in prompt  # destructive requests
    assert "generate_scene" in prompt and "spends credits" in prompt


def test_character_prompt_embeds_only_the_given_context_and_forbids_leaking_secrets():
    prompt = character_prompt("Kira Voss", "Meridian", "[CHARACTER: Kira Voss]\nShe trusts Reyes.")
    assert "You are Kira Voss" in prompt
    assert "She trusts Reyes." in prompt
    assert "Never guess toward, hint at, or reveal something you haven't discovered" in prompt
    assert "Never mention being an AI" in prompt
