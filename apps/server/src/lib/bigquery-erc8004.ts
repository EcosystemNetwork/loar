/**
 * ERC-8004 agent reputation, powered by Google BigQuery.
 *
 * Queries raw Ethereum mainnet logs from the public crypto_ethereum dataset,
 * filtered to the ERC-8004 registries (Identity / Reputation / Validation), to
 * rank agents by on-chain feedback and surface a discovery layer for the agent
 * economy. This is the Google Cloud "On-Chain Agent Economy" track: BigQuery is
 * the core query engine over the EF ERC-8004 registry addresses.
 *
 * Auth reuses the existing GCP service account (google-auth-library is already
 * a dependency). Billing project = GCP_PROJECT_ID or the service account's
 * project. Reads run against the free public dataset (you pay only for bytes
 * scanned in your own project).
 *
 * Env:
 *   GCP_PROJECT_ID              — billing project (defaults to SA project_id)
 *   GCP_SERVICE_ACCOUNT_JSON    — inline SA json (falls back to FIREBASE_SERVICE_ACCOUNT
 *                                 / FIREBASE_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS)
 *   ERC8004_IDENTITY_REGISTRY   — override (default EF mainnet deploy)
 *   ERC8004_REPUTATION_REGISTRY — override
 *   ERC8004_VALIDATION_REGISTRY — optional
 */
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

// ERC-8004 registries — canonical CREATE2 singletons (same address per chain).
// Defaults are the ETHEREUM MAINNET deployment (the 0x8004… vanity prefix
// encodes the ERC #). NOTE: 0x8004A818…/0x8004B663… is the *Sepolia* pair —
// mainnet uses 0x8004A169…/0x8004BAa1…. ValidationRegistry has no canonical
// mainnet deployment yet (spec in flux), so it defaults empty.
export const ERC8004 = {
  identity: (
    process.env.ERC8004_IDENTITY_REGISTRY || '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
  ).toLowerCase(),
  reputation: (
    process.env.ERC8004_REPUTATION_REGISTRY || '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'
  ).toLowerCase(),
  validation: (process.env.ERC8004_VALIDATION_REGISTRY || '').toLowerCase(),
};

// Exact event topic0 hashes — count only the events we mean, not every log.
const TOPIC = {
  // ReputationRegistry.NewFeedback(uint256 indexed agentId, address indexed client, …)
  newFeedback: '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc',
  // IdentityRegistry.Registered(uint256 indexed agentId, string uri, address indexed owner)
  registered: '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a',
};

const PUBLIC_LOGS = 'bigquery-public-data.crypto_ethereum.logs';

/** topics[1] is a 32-byte hex word holding the uint256 agentId → decimal string. */
function agentIdToDecimal(topic1: string): string {
  try {
    return BigInt(topic1).toString();
  } catch {
    return topic1;
  }
}

// ── Auth / config ─────────────────────────────────────────────────────────────

function serviceAccountJson(): Record<string, unknown> | null {
  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      /* fall through to path */
    }
  }
  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    try {
      return JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

export function isBigQueryConfigured(): boolean {
  const sa = serviceAccountJson();
  const project = process.env.GCP_PROJECT_ID || (sa?.project_id as string | undefined);
  return !!(sa && project);
}

function projectId(): string {
  const sa = serviceAccountJson();
  const project = process.env.GCP_PROJECT_ID || (sa?.project_id as string | undefined);
  if (!project) throw new Error('GCP_PROJECT_ID not set and no service-account project_id found');
  return project;
}

let _auth: GoogleAuth | null = null;
async function accessToken(): Promise<string> {
  if (!_auth) {
    const credentials = serviceAccountJson();
    if (!credentials) throw new Error('No GCP service account credentials available');
    _auth = new GoogleAuth({
      credentials: credentials as Record<string, string>,
      scopes: ['https://www.googleapis.com/auth/bigquery.readonly'],
    });
  }
  const token = await _auth.getAccessToken();
  if (!token) throw new Error('Failed to obtain GCP access token');
  return token;
}

// ── Query runner (BigQuery REST API) ─────────────────────────────────────────

interface BqParam {
  name: string;
  type: 'STRING' | 'INT64';
  value: string;
}

/** Run a parameterized standard-SQL query and return rows as plain objects. */
async function runQuery<T = Record<string, string>>(
  sql: string,
  params: BqParam[] = []
): Promise<T[]> {
  const token = await accessToken();
  const resp = await fetch(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId()}/queries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        timeoutMs: 30_000,
        parameterMode: params.length ? 'NAMED' : undefined,
        queryParameters: params.map((p) => ({
          name: p.name,
          parameterType: { type: p.type },
          parameterValue: { value: p.value },
        })),
      }),
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`BigQuery query failed: ${resp.status} ${text}`.trim());
  }
  const json = (await resp.json()) as {
    schema?: { fields: { name: string }[] };
    rows?: { f: { v: string }[] }[];
  };
  const fields = json.schema?.fields?.map((f) => f.name) ?? [];
  return (json.rows ?? []).map((row) => {
    const obj: Record<string, string> = {};
    row.f.forEach((cell, i) => {
      obj[fields[i]] = cell.v;
    });
    return obj as T;
  });
}

// ── ERC-8004 reputation queries ──────────────────────────────────────────────

export interface RankedAgent {
  /** Hex agentId (32-byte topic word). */
  agentId: string;
  /** Decimal agentId (the ERC-721 tokenId in the IdentityRegistry). */
  agentIdDecimal: string;
  feedbackCount: number;
  lastFeedbackAt: string | null;
  registeredAt: string | null;
  reputationScore: number;
}

/**
 * Rank agents by on-chain reputation feedback volume. Counts ReputationRegistry
 * `NewFeedback` events (agentId in topics[1]) and joins IdentityRegistry
 * `Registered` events for registration time. Filtered by exact event topic0 so
 * we don't miscount URIUpdated / Transfer / MetadataSet logs.
 */
export async function rankAgents(limit = 25): Promise<RankedAgent[]> {
  const sql = `
    WITH rep AS (
      SELECT topics[SAFE_OFFSET(1)] AS agent_id,
             COUNT(*) AS feedback_count,
             MAX(block_timestamp) AS last_feedback_at
      FROM \`${PUBLIC_LOGS}\`
      WHERE address = @reputation
        AND topics[SAFE_OFFSET(0)] = @newFeedback
        AND ARRAY_LENGTH(topics) >= 2
      GROUP BY agent_id
    ),
    ident AS (
      SELECT topics[SAFE_OFFSET(1)] AS agent_id,
             MIN(block_timestamp) AS registered_at
      FROM \`${PUBLIC_LOGS}\`
      WHERE address = @identity
        AND topics[SAFE_OFFSET(0)] = @registered
        AND ARRAY_LENGTH(topics) >= 2
      GROUP BY agent_id
    )
    SELECT rep.agent_id AS agentId,
           rep.feedback_count AS feedbackCount,
           CAST(rep.last_feedback_at AS STRING) AS lastFeedbackAt,
           CAST(ident.registered_at AS STRING) AS registeredAt
    FROM rep
    LEFT JOIN ident USING (agent_id)
    ORDER BY rep.feedback_count DESC
    LIMIT @limit`;

  const rows = await runQuery<Record<string, string>>(sql, [
    { name: 'reputation', type: 'STRING', value: ERC8004.reputation },
    { name: 'identity', type: 'STRING', value: ERC8004.identity },
    { name: 'newFeedback', type: 'STRING', value: TOPIC.newFeedback },
    { name: 'registered', type: 'STRING', value: TOPIC.registered },
    { name: 'limit', type: 'INT64', value: String(limit) },
  ]);

  return rows.map((r) => {
    const feedbackCount = Number(r.feedbackCount ?? 0);
    return {
      agentId: r.agentId,
      agentIdDecimal: agentIdToDecimal(r.agentId),
      feedbackCount,
      lastFeedbackAt: r.lastFeedbackAt ?? null,
      registeredAt: r.registeredAt ?? null,
      // Simple log-scaled score; richer scoring can layer on validation events.
      reputationScore: Math.round(Math.log10(feedbackCount + 1) * 100) / 100,
    };
  });
}

/** Reputation summary for a single agent id (hex topic word, 0x + 64 hex). */
export async function getAgentReputation(agentId: string): Promise<RankedAgent | null> {
  const rep = ERC8004.reputation;
  if (!/^0x[0-9a-f]{40}$/.test(rep)) return null;

  const sql = `
    SELECT COUNT(*) AS feedbackCount,
           CAST(MAX(block_timestamp) AS STRING) AS lastFeedbackAt
    FROM \`${PUBLIC_LOGS}\`
    WHERE address = @reputation
      AND topics[SAFE_OFFSET(0)] = @newFeedback
      AND ARRAY_LENGTH(topics) >= 2
      AND topics[SAFE_OFFSET(1)] = @agentId`;

  const rows = await runQuery<Record<string, string>>(sql, [
    { name: 'reputation', type: 'STRING', value: rep },
    { name: 'newFeedback', type: 'STRING', value: TOPIC.newFeedback },
    { name: 'agentId', type: 'STRING', value: agentId.toLowerCase() },
  ]);
  const r = rows[0];
  if (!r || Number(r.feedbackCount ?? 0) === 0) return null;
  const feedbackCount = Number(r.feedbackCount);
  return {
    agentId: agentId.toLowerCase(),
    agentIdDecimal: agentIdToDecimal(agentId),
    feedbackCount,
    lastFeedbackAt: r.lastFeedbackAt ?? null,
    registeredAt: null,
    reputationScore: Math.round(Math.log10(feedbackCount + 1) * 100) / 100,
  };
}
