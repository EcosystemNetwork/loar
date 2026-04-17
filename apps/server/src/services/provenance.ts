/**
 * C2PA Content Provenance Service
 *
 * Signs AI-generated content with C2PA (Coalition for Content Provenance and
 * Authenticity) metadata so downstream consumers can verify the content was
 * AI-generated, which model produced it, and that it originated from the LOAR
 * platform.
 *
 * Graceful degradation: if the c2pa-node library is unavailable, the signing
 * certificate is not configured, or any runtime error occurs, the original
 * buffer is returned unchanged. Generation must never fail because of
 * provenance signing.
 */

export interface ProvenanceMetadata {
  /** AI model identifier (e.g. "fal-ai/veo3.1/fast", "bytedance/seedance-2.0") */
  model: string;
  /** Generation prompt (truncated for privacy — first 200 chars) */
  prompt?: string;
  /** ISO-8601 timestamp of generation */
  generatedAt?: string;
  /** Media MIME type (e.g. "video/mp4", "image/png") */
  mimeType?: string;
  /** Additional key/value pairs to embed */
  extra?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Lazy-loaded c2pa-node — the package is optional so the server can start
// even if it isn't installed yet.
// ---------------------------------------------------------------------------

let c2paModule: typeof import('c2pa-node') | null = null;
let c2paLoadAttempted = false;

async function getC2pa(): Promise<typeof import('c2pa-node') | null> {
  if (c2paLoadAttempted) return c2paModule;
  c2paLoadAttempted = true;
  try {
    c2paModule = await import('c2pa-node');
    console.log('[provenance] c2pa-node loaded successfully');
  } catch {
    console.warn(
      '[provenance] c2pa-node not installed — C2PA signing disabled. ' +
        'Install with: pnpm add c2pa-node'
    );
    c2paModule = null;
  }
  return c2paModule;
}

// ---------------------------------------------------------------------------
// Certificate helpers
// ---------------------------------------------------------------------------

function getSigningConfig(): { privateKey: string; certificate: string } | null {
  const privateKey = process.env.C2PA_PRIVATE_KEY;
  const certificate = process.env.C2PA_CERTIFICATE;

  if (!privateKey || !certificate) {
    return null;
  }

  return { privateKey, certificate };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sign a media buffer with C2PA provenance metadata.
 *
 * Returns the signed buffer on success, or the original buffer unchanged if:
 * - c2pa-node is not installed
 * - C2PA_PRIVATE_KEY / C2PA_CERTIFICATE env vars are missing
 * - Any signing error occurs
 *
 * This function is intentionally non-throwing so callers can use it as a
 * pass-through without try/catch.
 */
export async function signWithProvenance(
  buffer: Buffer,
  filename: string,
  metadata: ProvenanceMetadata
): Promise<Buffer> {
  try {
    const c2pa = await getC2pa();
    if (!c2pa) return buffer;

    const signingConfig = getSigningConfig();
    if (!signingConfig) {
      // First time only — subsequent calls are silent
      if (!warnedMissingConfig) {
        console.warn(
          '[provenance] C2PA_PRIVATE_KEY and/or C2PA_CERTIFICATE not set — signing disabled'
        );
        warnedMissingConfig = true;
      }
      return buffer;
    }

    // Determine MIME type from filename or metadata
    const mimeType = metadata.mimeType || guessMimeType(filename);

    // Build the C2PA manifest definition
    const manifestDefinition = buildManifestDefinition(metadata);

    // Create a c2pa instance with the signing credentials
    const { createC2pa, SigningAlgorithm } = c2pa;
    const c2paInstance = createC2pa({
      signer: {
        type: 'local',
        certificate: signingConfig.certificate,
        privateKey: signingConfig.privateKey,
        algorithm: SigningAlgorithm.ES256,
        tsaUrl: 'http://timestamp.digicert.com',
      },
    });

    // Sign the content
    const { signedAsset } = await c2paInstance.sign({
      asset: {
        buffer,
        mimeType,
      },
      manifest: manifestDefinition,
    });

    console.log(
      `[provenance] Signed ${filename} (${buffer.length} -> ${signedAsset.buffer.length} bytes)`
    );

    return Buffer.from(signedAsset.buffer);
  } catch (err) {
    console.error(
      '[provenance] C2PA signing failed (returning unsigned buffer):',
      err instanceof Error ? err.message : err
    );
    return buffer;
  }
}

let warnedMissingConfig = false;

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

function buildManifestDefinition(metadata: ProvenanceMetadata) {
  const timestamp = metadata.generatedAt || new Date().toISOString();

  return {
    claimGenerator: 'LOAR/1.0',
    title: `AI-generated content by ${metadata.model}`,
    assertions: [
      // C2PA standard action assertion — marks this as AI-created content
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              digitalSourceType:
                'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
              softwareAgent: `LOAR/1.0 model:${metadata.model}`,
              when: timestamp,
            },
          ],
        },
      },
      // Custom LOAR assertion with generation details
      {
        label: 'loar.generation',
        data: {
          ai_generated: true,
          model: metadata.model,
          platform: 'LOAR',
          platform_url: 'https://loar.fun',
          generated_at: timestamp,
          ...(metadata.prompt ? { prompt_preview: metadata.prompt.slice(0, 200) } : {}),
          ...(metadata.extra || {}),
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function guessMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'avif':
      return 'image/avif';
    default:
      return 'application/octet-stream';
  }
}
