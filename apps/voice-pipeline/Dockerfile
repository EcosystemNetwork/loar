# syntax=docker/dockerfile:1.6
#
# LOAR Voice Pipeline (Pipecat) — production image for Railway.
#
# Build from the monorepo root: `docker build -f apps/voice-pipeline/Dockerfile .`
# (the root is the context so Railway's dockerfilePath resolves the same way
# it does for apps/mcp-gateway).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# libsndfile: soundfile (Pipecat audio); libgomp1: onnxruntime (Silero VAD).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY apps/voice-pipeline/requirements.txt ./
RUN pip install -r requirements.txt

COPY apps/voice-pipeline/*.py ./

# Railway injects PORT; default for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
