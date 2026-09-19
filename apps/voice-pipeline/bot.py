"""The voice pipeline for one connected client.

    browser mic ─▶ WebSocket ─▶ Gradium STT ─▶ (VAD/turn aggregation)
                                                  │
                                    SambaNova LLM ◀─ tool calls ─▶ LOAR backend
                                                  │
    browser speaker ◀─ WebSocket ◀─ Gradium / Hume TTS

Barge-in is Pipecat-native: when the user starts speaking over the bot, the
in-flight LLM/TTS frames are cancelled and playback stops. Two modes share
the pipeline — "director" (tool-calling, operates the universe) and
"character" (in-persona, read-only, voiced by the character's own voice).
"""

from __future__ import annotations

from typing import Any

from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIFunctionCallReportLevel, RTVIObserverParams
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.gradium.stt import GradiumSTTService
from pipecat.services.gradium.tts import GradiumTTSService
from pipecat.services.hume.tts import HumeTTSService
from pipecat.services.sambanova.llm import SambaNovaLLMService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport
from pipecat.workers.runner import WorkerRunner

from config import Settings
from loar_client import LoarClient
from prompts import character_prompt, director_prompt
from tools import DirectorSession, register_tools, tool_schemas

AUDIO_IN_HZ = 16_000
AUDIO_OUT_HZ = 24_000

GREETINGS = {
    "director": (
        "The user has just opened the Voice Director. Greet them in one short sentence and "
        "tell them you're ready."
    ),
    "character": "Someone has just started talking with you. Greet them briefly, in character.",
}


def select_tts(settings: Settings, voice: dict[str, Any] | None):
    """Pick the TTS engine for a speaker.

    A character with a Hume voice id speaks through Hume (expressive, with the
    character's acting description); one with a Gradium voice id uses that;
    everyone else — including the Director — gets Gradium's default/configured
    voice, so an unassigned character still talks rather than failing.
    """
    voice = voice or {}
    if voice.get("humeVoiceId") and settings.hume_api_key:
        kwargs: dict[str, Any] = {"voice": voice["humeVoiceId"]}
        if voice.get("humeVoiceDescription"):
            kwargs["description"] = voice["humeVoiceDescription"]
        return HumeTTSService(
            api_key=settings.hume_api_key, settings=HumeTTSService.Settings(**kwargs)
        )

    voice_id = voice.get("gradiumVoiceId") or settings.director_voice_id
    if voice_id:
        return GradiumTTSService(
            api_key=settings.gradium_api_key, settings=GradiumTTSService.Settings(voice=voice_id)
        )
    return GradiumTTSService(api_key=settings.gradium_api_key)


async def run_bot(websocket, claims: dict[str, Any], settings: Settings) -> None:
    client = LoarClient(settings.loar_api_base, settings.loar_api_key)
    mode: str = claims["mode"]
    universe_id: str = claims["universeId"]

    try:
        if mode == "director":
            data = await client.query(
                "director.getContext", {"universeId": universe_id, "perspective": "director"}
            )
            session = DirectorSession(client, universe_id, data["characters"], data["nodes"])
            system_prompt = director_prompt(data["universeName"], data["characters"], data["nodes"])
            tools = tool_schemas()
            tts = select_tts(settings, None)
            temperature = 0.4
        else:
            data = await client.query(
                "director.getContext",
                {"universeId": universe_id, "entityId": claims["entityId"], "perspective": "character"},
            )
            session = None
            system_prompt = character_prompt(
                data["entity"]["name"], data["universeName"], data["context"]
            )
            tools = None
            tts = select_tts(settings, data.get("voice"))
            temperature = 0.7

        transport = FastAPIWebsocketTransport(
            websocket=websocket,
            params=FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                add_wav_header=False,
                serializer=ProtobufFrameSerializer(),
            ),
        )
        stt = GradiumSTTService(api_key=settings.gradium_api_key)
        llm_kwargs: dict[str, Any] = {}
        if settings.sambanova_base_url:
            llm_kwargs["base_url"] = settings.sambanova_base_url
        llm = SambaNovaLLMService(
            api_key=settings.sambanova_api_key,
            settings=SambaNovaLLMService.Settings(
                model=settings.sambanova_model,
                temperature=temperature,
                max_tokens=500,
                system_instruction=system_prompt,
            ),
            **llm_kwargs,
        )
        if session is not None:
            register_tools(llm, session)

        context = LLMContext(**({"tools": tools} if tools else {}))
        user_agg, assistant_agg = LLMContextAggregatorPair(
            context, user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer())
        )

        pipeline = Pipeline(
            [transport.input(), stt, user_agg, llm, tts, transport.output(), assistant_agg]
        )
        task = PipelineWorker(
            pipeline,
            params=PipelineParams(
                audio_in_sample_rate=AUDIO_IN_HZ, audio_out_sample_rate=AUDIO_OUT_HZ
            ),
            # Tool *names* reach the browser (for the live action checklist);
            # arguments and results never do.
            rtvi_observer_params=RTVIObserverParams(
                function_call_report_level={"*": RTVIFunctionCallReportLevel.NAME},
            ),
        )

        @task.rtvi.event_handler("on_client_ready")
        async def _greet(_rtvi) -> None:
            context.add_message({"role": "user", "content": GREETINGS[mode]})
            await task.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def _disconnected(_transport, _client) -> None:
            await task.cancel()

        logger.info(f"voice session start mode={mode} universe={universe_id}")
        await WorkerRunner(handle_sigint=False).run(task)
    finally:
        await client.aclose()
        logger.info(f"voice session end mode={mode} universe={universe_id}")
