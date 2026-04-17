# Content Provenance (C2PA)

LOAR embeds [C2PA](https://c2pa.org/) (Coalition for Content Provenance and Authenticity) metadata into every AI-generated image and video before it is persisted to permanent storage. This cryptographically signed provenance chain lets anyone verify that a piece of content was AI-generated, which model created it, and that it originated from the LOAR platform.

## Why it matters

- **Transparency**: viewers can confirm content is AI-generated rather than a deepfake or deceptive media.
- **IP attribution**: the embedded metadata links each asset back to LOAR and the specific generation model.
- **Regulatory readiness**: the EU AI Act and similar legislation increasingly require AI-generated media to carry machine-readable provenance.
- **Platform trust**: Content Credentials travel with the file, surviving re-uploads and screenshots (for images with soft binding).

## How LOAR signs content

When AI-generated content is persisted to permanent storage (Pinata/IPFS), the server calls `signWithProvenance()` which:

1. Creates a C2PA manifest with:
   - **claim_generator**: `LOAR/1.0`
   - **action**: `c2pa.created` with `digitalSourceType` = `trainedAlgorithmicMedia`
   - **software agent**: `LOAR/1.0 model:<model-id>`
   - **timestamp**: ISO-8601 generation time
2. Adds a custom `loar.generation` assertion containing the model name, platform URL, and a truncated prompt preview.
3. Signs with the platform's ES256 certificate and embeds the signed manifest into the file.
4. Returns the signed buffer for upload.

If signing fails for any reason (missing certificate, library not installed, runtime error), the original unsigned buffer is uploaded instead. Generation never fails because of provenance.

## What metadata is embedded

| Field               | Source                        | Example                             |
| ------------------- | ----------------------------- | ----------------------------------- |
| `claim_generator`   | Hardcoded                     | `LOAR/1.0`                          |
| `action`            | C2PA standard                 | `c2pa.created`                      |
| `digitalSourceType` | IPTC vocabulary               | `trainedAlgorithmicMedia`           |
| `softwareAgent`     | Model ID                      | `LOAR/1.0 model:fal-ai/veo3.1/fast` |
| `when`              | Server clock                  | `2026-04-17T14:30:00.000Z`          |
| `ai_generated`      | Custom assertion              | `true`                              |
| `model`             | Generation router             | `bytedance/seedance-2.0`            |
| `platform`          | Hardcoded                     | `LOAR`                              |
| `prompt_preview`    | User prompt (first 200 chars) | `A dragon flying over...`           |

## Configuration

### Environment variables

Add to your `.env`:

```
C2PA_PRIVATE_KEY=<PEM-encoded private key>
C2PA_CERTIFICATE=<PEM-encoded certificate>
```

Both are optional. If either is missing, C2PA signing is silently disabled.

### Generate a self-signed certificate (testnet)

```bash
openssl req -x509 -newkey ec \
  -pkeyopt ec_paramgen_curve:P-256 \
  -keyout c2pa-key.pem \
  -out c2pa-cert.pem \
  -days 365 -nodes \
  -subj "/CN=LOAR Platform/O=LOAR/C=US"
```

Then paste the contents of each file into the env vars (including the `-----BEGIN/END-----` lines).

### Production certificate

For mainnet, obtain a code-signing certificate from a CA that is part of the C2PA trust list (e.g., DigiCert, GlobalSign). This ensures verifiers show a green checkmark instead of "self-signed" warnings.

## How to verify provenance

### c2patool (CLI)

```bash
# Install
cargo install c2patool

# Verify a file
c2patool verify my-video.mp4
```

### Content Credentials website

Upload the file to [contentcredentials.org/verify](https://contentcredentials.org/verify) to see a visual breakdown of the provenance chain.

### Programmatic verification (Node.js)

```typescript
import { createC2pa } from 'c2pa-node';

const c2pa = createC2pa();
const result = await c2pa.read({ buffer: fileBuffer, mimeType: 'video/mp4' });
console.log(result.manifestStore?.activeManifest);
```

## Architecture

```
AI Generation Request
        |
        v
  dispatchGeneration()  -->  FAL / ByteDance API
        |
        v
  result.videoUrl / imageUrls
        |
        v
  persistVideoToStorage() / persistImagesToStorage()
        |
        v
  fetch buffer from temp URL
        |
        v
  signWithProvenance(buffer, filename, metadata)   <-- C2PA signing happens here
        |
        v
  StorageManager.upload(signedBuffer)  -->  Pinata / Lighthouse / Firebase
```

The signing step sits between fetching the raw AI output and uploading to permanent storage, keeping it non-blocking (fire-and-forget from the generation response path).

## Supported formats

C2PA signing works with:

- **Images**: PNG, JPEG, WebP, AVIF, GIF
- **Video**: MP4, WebM, MOV

The `c2pa-node` library handles format detection and manifest embedding automatically.

## Dependencies

- [`c2pa-node`](https://www.npmjs.com/package/c2pa-node) — official C2PA Node.js SDK (Rust core via NAPI)
- Loaded lazily at first use; server starts normally without it
