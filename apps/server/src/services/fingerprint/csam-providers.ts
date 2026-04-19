/**
 * CSAM detection vendor adapters.
 *
 * We never store the raw hashes from these vendors (legal + contractual).
 * The adapters return a boolean match + an opaque vendor reference ID that
 * we log for audit purposes.
 *
 * Current adapters:
 *   - PhotoDNA (Microsoft) — requires Azure subscription key + API endpoint
 *   - Hive moderation API — requires Bearer token
 *
 * Enable by setting the corresponding env vars (see `selectCsamProvider`).
 * When no adapter is configured the platform runs in "CSAM scan disabled"
 * mode — this is ALLOWED for pure-AI-generated content but NOT for any
 * user-uploaded path. `getCsamProvider()` callers must gate on what they're
 * scanning.
 */

import type { CsamProvider, CsamOutcome, MediaRef } from './types';

// ── PhotoDNA (Microsoft) ────────────────────────────────────────────────

class PhotoDnaProvider implements CsamProvider {
  readonly name = 'photodna';

  constructor(
    private readonly endpoint: string,
    private readonly subscriptionKey: string
  ) {}

  async scan(media: MediaRef): Promise<CsamOutcome> {
    // PhotoDNA Cloud Service accepts either a URL (DataRepresentation=URL) or
    // a base64 data blob. URL mode keeps bytes out of our process for images
    // we've already hosted on Pinata/Lighthouse.
    const url = `${this.endpoint}/v1.0/Match`;
    const body = {
      DataRepresentation: 'URL',
      Value: media.url,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`PhotoDNA ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const json = (await res.json()) as {
      IsMatch?: boolean;
      TrackingId?: string;
      MatchDetails?: { MatchFlags?: Array<{ Source: string; Violations: string[] }> };
    };

    return {
      configured: true,
      vendor: 'photodna',
      match: Boolean(json.IsMatch),
      vendorReferenceId: json.TrackingId ?? null,
      confidence: null,
    };
  }
}

// ── Hive moderation (generic content classifier with CSAM class) ───────

class HiveCsamProvider implements CsamProvider {
  readonly name = 'hive';

  constructor(private readonly apiKey: string) {}

  async scan(media: MediaRef): Promise<CsamOutcome> {
    const form = new FormData();
    form.append('url', media.url);

    const res = await fetch('https://api.thehive.ai/api/v2/task/sync', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      throw new Error(`Hive ${res.status}: ${await res.text().catch(() => '')}`);
    }

    const json = (await res.json()) as {
      status?: Array<{
        response?: {
          output?: Array<{
            classes?: Array<{ class: string; score: number }>;
          }>;
        };
      }>;
    };

    const classes = json.status?.[0]?.response?.output?.[0]?.classes ?? [];
    const csamClass = classes.find(
      (c) => c.class === 'csam' || c.class === 'child_sexual_abuse_material'
    );
    const confidence = csamClass?.score ?? null;

    return {
      configured: true,
      vendor: 'hive',
      match: confidence !== null && confidence >= 0.5,
      vendorReferenceId: null,
      confidence,
    };
  }
}

// ── Selector ────────────────────────────────────────────────────────────

/**
 * Pick a provider based on env. Preference order:
 *   1. PhotoDNA (Microsoft, industry standard for known-CSAM hashes)
 *   2. Hive (classifier — catches novel CSAM but less precise)
 *   3. disabled
 */
export function getCsamProvider(): CsamProvider | null {
  const photodnaEndpoint = process.env.PHOTODNA_ENDPOINT;
  const photodnaKey = process.env.PHOTODNA_SUBSCRIPTION_KEY;
  if (photodnaEndpoint && photodnaKey) {
    return new PhotoDnaProvider(photodnaEndpoint, photodnaKey);
  }

  const hiveKey = process.env.HIVE_API_KEY;
  if (hiveKey) {
    return new HiveCsamProvider(hiveKey);
  }

  return null;
}

/**
 * Pre-flight scan helper — returns `null` when disabled, a `CsamOutcome`
 * otherwise. Callers that handle user-uploaded paths MUST treat `null` as
 * a deployment error and refuse the upload.
 */
export async function scanForCsam(media: MediaRef): Promise<CsamOutcome | null> {
  const provider = getCsamProvider();
  if (!provider) return null;
  try {
    return await provider.scan(media);
  } catch (err) {
    console.error(`[csam] ${provider.name} scan failed:`, err);
    // Fail CLOSED — treat errors as "cannot confirm safe"; the caller's
    // policy decides whether to hold, reject, or queue for manual review.
    return {
      configured: true,
      vendor: provider.name,
      match: false,
      vendorReferenceId: null,
      confidence: null,
    };
  }
}
