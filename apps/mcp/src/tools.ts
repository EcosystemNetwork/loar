/**
 * LOAR MCP Tools — Exposes LOAR platform capabilities as MCP tools
 *
 * Each tool wraps a tRPC endpoint, providing AI agents with typed
 * access to entity creation, content generation, marketplace operations,
 * universe management, and more.
 */
import type { LoarClient } from './loar-client';

// ── Tool Definition Type ───────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  handler: (client: LoarClient, args: Record<string, unknown>) => Promise<unknown>;
}

// ── Entity Tools ───────────────────────────────────────────────────────

const createEntity: ToolDefinition = {
  name: 'loar_create_entity',
  description:
    'Create a new entity (character, place, thing, faction, event, lore, etc.) in a universe or as standalone',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Entity name' },
      description: { type: 'string', description: 'Entity description' },
      kind: {
        type: 'string',
        description: 'Entity type',
        enum: [
          'person',
          'place',
          'thing',
          'faction',
          'event',
          'lore',
          'species',
          'vehicle',
          'technology',
          'organization',
        ],
      },
      universeAddress: {
        type: 'string',
        description: 'Universe contract address (optional for standalone)',
      },
      parentId: { type: 'string', description: 'Parent entity ID (optional)' },
    },
    required: ['name', 'description', 'kind'],
  },
  handler: async (client, args) => {
    return client.mutate('entities.create', args);
  },
};

const listEntities: ToolDefinition = {
  name: 'loar_list_entities',
  description: 'List entities in a universe, optionally filtered by kind',
  inputSchema: {
    type: 'object',
    properties: {
      universeAddress: { type: 'string', description: 'Universe contract address' },
      kind: { type: 'string', description: 'Filter by entity kind (optional)' },
    },
    required: ['universeAddress'],
  },
  handler: async (client, args) => {
    return client.query('entities.list', args);
  },
};

const getEntity: ToolDefinition = {
  name: 'loar_get_entity',
  description: 'Get full details of a specific entity by ID',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: { type: 'string', description: 'Entity ID' },
    },
    required: ['entityId'],
  },
  handler: async (client, args) => {
    return client.query('entities.get', args);
  },
};

// ── Generation Tools ───────────────────────────────────────────────────

const generateVideo: ToolDefinition = {
  name: 'loar_generate_video',
  description:
    'Generate a video using AI. Supports text-to-video and image-to-video modes with smart model routing.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the video' },
      mode: {
        type: 'string',
        description: 'Generation mode',
        enum: ['text_to_video', 'image_to_video'],
      },
      durationSec: { type: 'number', description: 'Video duration in seconds (1-20, default 5)' },
      imageUrl: {
        type: 'string',
        description: 'Input image URL (required for image_to_video mode)',
      },
      universeId: {
        type: 'string',
        description: 'Universe ID for model preference routing (optional)',
      },
    },
    required: ['prompt'],
  },
  handler: async (client, args) => {
    return client.mutate('generation.generate', {
      ...args,
      mode: args.mode || 'text_to_video',
      durationSec: args.durationSec || 5,
      routingMode: 'auto',
    });
  },
};

const generateImage: ToolDefinition = {
  name: 'loar_generate_image',
  description: 'Generate images using AI with smart model routing',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text prompt describing the image' },
      count: { type: 'number', description: 'Number of images to generate (1-4, default 1)' },
      aspectRatio: {
        type: 'string',
        description: 'Aspect ratio',
        enum: ['square_hd', 'landscape_16_9', 'portrait_9_16'],
      },
    },
    required: ['prompt'],
  },
  handler: async (client, args) => {
    return client.mutate('image.generate', args);
  },
};

const createAssetPack: ToolDefinition = {
  name: 'loar_create_asset_pack',
  description:
    'Generate a complete asset pack for an entity (portrait, voice, 3D model, lore card, etc.)',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: { type: 'string', description: 'Entity to generate assets for' },
      capabilities: {
        type: 'string',
        description:
          'Comma-separated list of capabilities: portrait, voice, sound_motif, intro_video, 3d_model, lore_card, hero_image, ambience_sound, establishing_shot, product_shot, sound_effect, keyframe_image, animated_short',
      },
    },
    required: ['entityId'],
  },
  handler: async (client, args) => {
    const capabilities =
      typeof args.capabilities === 'string'
        ? args.capabilities.split(',').map((s: string) => s.trim())
        : args.capabilities || ['portrait', 'lore_card'];
    return client.mutate('studio.createEntityPack', { ...args, capabilities });
  },
};

// ── Universe Tools ─────────────────────────────────────────────────────

const listUniverses: ToolDefinition = {
  name: 'loar_list_universes',
  description: 'List all universes on the platform',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (client) => {
    return client.query('universes.getAll', {});
  },
};

const getUniverse: ToolDefinition = {
  name: 'loar_get_universe',
  description: 'Get details of a specific universe',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Universe ID or address' },
    },
    required: ['id'],
  },
  handler: async (client, args) => {
    return client.query('universes.get', args);
  },
};

// ── Marketplace Tools ──────────────────────────────────────────────────

const submitToCanon: ToolDefinition = {
  name: 'loar_submit_to_canon',
  description:
    "Submit content for inclusion in a universe's canon. Goes through token-weighted community voting.",
  inputSchema: {
    type: 'object',
    properties: {
      universeId: { type: 'string', description: 'Universe to submit to' },
      universeToken: { type: 'string', description: 'Universe token address' },
      submissionType: {
        type: 'string',
        description: 'Submission type',
        enum: ['CHARACTER', 'PLOT_ARC', 'LOCATION', 'LORE_RULE'],
      },
      title: { type: 'string', description: 'Submission title' },
      description: { type: 'string', description: 'Detailed description' },
      contentHash: { type: 'string', description: 'Content hash' },
      metadataURI: { type: 'string', description: 'Metadata URI' },
    },
    required: [
      'universeId',
      'universeToken',
      'submissionType',
      'title',
      'description',
      'contentHash',
      'metadataURI',
    ],
  },
  handler: async (client, args) => {
    return client.mutate('marketplace.submit', args);
  },
};

const getCanon: ToolDefinition = {
  name: 'loar_get_canon',
  description: 'Get accepted canon entries for a universe',
  inputSchema: {
    type: 'object',
    properties: {
      universeId: { type: 'string', description: 'Universe ID' },
    },
    required: ['universeId'],
  },
  handler: async (client, args) => {
    return client.query('marketplace.getCanon', args);
  },
};

// ── Collab Tools ───────────────────────────────────────────────────────

const proposeCollab: ToolDefinition = {
  name: 'loar_propose_collab',
  description: 'Propose a cross-universe collaboration with revenue sharing',
  inputSchema: {
    type: 'object',
    properties: {
      universeA: { type: 'string', description: 'First universe ID' },
      universeB: { type: 'string', description: 'Second universe ID' },
      title: { type: 'string', description: 'Collab title' },
      description: { type: 'string', description: 'Collab description' },
      revenueShareBps: { type: 'number', description: 'Revenue share in basis points (0-10000)' },
      durationDays: { type: 'number', description: 'Collab duration in days' },
    },
    required: ['universeA', 'universeB', 'title', 'description', 'revenueShareBps', 'durationDays'],
  },
  handler: async (client, args) => {
    return client.mutate('collabs.propose', args);
  },
};

// ── AI Agent Tools ─────────────────────────────────────────────────────

const listAIAgents: ToolDefinition = {
  name: 'loar_list_ai_agents',
  description: 'List AI agents assigned to a universe',
  inputSchema: {
    type: 'object',
    properties: {
      universeId: { type: 'string', description: 'Universe ID' },
    },
    required: ['universeId'],
  },
  handler: async (client, args) => {
    return client.query('aiAgents.listByUniverse', args);
  },
};

const runPipeline: ToolDefinition = {
  name: 'loar_run_pipeline',
  description: 'Execute an AI agent pipeline (multi-step automated workflow)',
  inputSchema: {
    type: 'object',
    properties: {
      pipelineId: { type: 'string', description: 'Pipeline ID to execute' },
    },
    required: ['pipelineId'],
  },
  handler: async (client, args) => {
    return client.mutate('aiPipelines.run', args);
  },
};

const getPipelineRun: ToolDefinition = {
  name: 'loar_get_pipeline_run',
  description: 'Get the status and results of a pipeline execution',
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Pipeline run ID' },
    },
    required: ['runId'],
  },
  handler: async (client, args) => {
    return client.query('aiPipelines.getRun', args);
  },
};

// ── Profile Tools ──────────────────────────────────────────────────────

const getProfile: ToolDefinition = {
  name: 'loar_get_profile',
  description: 'Get a user profile by username',
  inputSchema: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Username to look up' },
    },
    required: ['username'],
  },
  handler: async (client, args) => {
    return client.query('profiles.getByUsername', args);
  },
};

const discoverProfiles: ToolDefinition = {
  name: 'loar_discover_profiles',
  description: 'Discover public creator profiles with optional search and tag filters',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Search query (optional)' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
  },
  handler: async (client, args) => {
    return client.query('profiles.discover', args);
  },
};

// ── Talent Agent Tools ─────────────────────────────────────────────────

const discoverTalentAgents: ToolDefinition = {
  name: 'loar_discover_talent_agents',
  description:
    'Browse talent agents on the platform. Filter by specialties and verification status.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Search by name or agency' },
      specialties: { type: 'string', description: 'Comma-separated specialties filter' },
      verifiedOnly: { type: 'boolean', description: 'Only show verified agents' },
    },
  },
  handler: async (client, args) => {
    const specialties =
      typeof args.specialties === 'string'
        ? args.specialties.split(',').map((s: string) => s.trim())
        : undefined;
    return client.query('talentAgents.discover', { ...args, specialties });
  },
};

// ── Credit Tools ───────────────────────────────────────────────────────

const getCredits: ToolDefinition = {
  name: 'loar_get_credits',
  description: 'Get the current credit balance and usage stats',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (client) => {
    return client.query('credits.getBalance', {});
  },
};

// ── Export All Tools ───────────────────────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [
  // Entities
  createEntity,
  listEntities,
  getEntity,
  // Generation
  generateVideo,
  generateImage,
  createAssetPack,
  // Universes
  listUniverses,
  getUniverse,
  // Marketplace
  submitToCanon,
  getCanon,
  // Collabs
  proposeCollab,
  // AI Agents
  listAIAgents,
  runPipeline,
  getPipelineRun,
  // Profiles
  getProfile,
  discoverProfiles,
  // Talent Agents
  discoverTalentAgents,
  // Credits
  getCredits,
];
