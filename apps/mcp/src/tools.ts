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

// ── AI Agent Management Tools (G5) ────────────────────────────────────

const createAIAgent: ToolDefinition = {
  name: 'loar_create_ai_agent',
  description:
    'Create a new AI agent owned by the calling user. Agents run pipelines on a budget against specified permissions.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Agent display name' },
      type: {
        type: 'string',
        description: 'Agent type',
        enum: ['content_creator', 'curator', 'moderator', 'community_manager'],
      },
      description: { type: 'string', description: 'Optional agent bio' },
      universeId: {
        type: 'string',
        description: 'Universe scope (optional — omit for cross-universe agents)',
      },
      permissions: {
        type: 'string',
        description:
          'Comma-separated permissions (e.g. "generation,content.create,marketplace.submit")',
      },
      useBYOK: {
        type: 'boolean',
        description: "Bill generations against the owner's BYOK keys instead of platform credits",
      },
    },
    required: ['name', 'type', 'permissions'],
  },
  handler: async (client, args) => {
    const permissions =
      typeof args.permissions === 'string'
        ? args.permissions
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
    return client.mutate('aiAgents.create', { ...args, permissions });
  },
};

const updatePipeline: ToolDefinition = {
  name: 'loar_update_pipeline',
  description: 'Update an existing AI pipeline (name, description, or steps)',
  inputSchema: {
    type: 'object',
    properties: {
      pipelineId: { type: 'string', description: 'Pipeline ID to update' },
      name: { type: 'string', description: 'New name (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
    },
    required: ['pipelineId'],
  },
  handler: async (client, args) => {
    return client.mutate('aiPipelines.update', args);
  },
};

const createApiKey: ToolDefinition = {
  name: 'loar_create_api_key',
  description:
    'Issue a scoped API key for external automation (Zapier, custom scripts, MCP clients). Returns the secret once — store it immediately.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Human-readable key name' },
      permissions: {
        type: 'string',
        description:
          "Comma-separated permissions the key may use (subset of the caller's permissions)",
      },
      expiresInDays: {
        type: 'number',
        description: 'Optional expiry in days; omit for no expiry',
      },
    },
    required: ['name', 'permissions'],
  },
  handler: async (client, args) => {
    const permissions =
      typeof args.permissions === 'string'
        ? args.permissions
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];
    return client.mutate('apiKeys.create', { ...args, permissions });
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

// ── Pipeline Step Tools (Internal actions for AI agent pipeline steps) ──

const generateVoice: ToolDefinition = {
  name: 'loar_generate_voice',
  description: 'Generate voice audio from text using ElevenLabs TTS',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to synthesize' },
      voiceId: { type: 'string', description: 'ElevenLabs voice ID' },
      modelId: { type: 'string', description: 'TTS model ID (optional)' },
      entityId: { type: 'string', description: 'Entity to attach audio to (optional)' },
    },
    required: ['text', 'voiceId'],
  },
  handler: async (client, args) => {
    return client.mutate('voice.synthesize', args);
  },
};

const generate3D: ToolDefinition = {
  name: 'loar_generate_3d',
  description: 'Generate a 3D model from text or image via Meshy',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text prompt for 3D generation' },
      imageUrl: { type: 'string', description: 'Reference image URL (for image-to-3D)' },
      entityId: { type: 'string', description: 'Entity to attach model to (optional)' },
    },
    required: ['prompt'],
  },
  handler: async (client, args) => {
    if (args.imageUrl) {
      return client.mutate('threed.imageToModel', args);
    }
    return client.mutate('threed.textToPreview', args);
  },
};

const generateSoundEffect: ToolDefinition = {
  name: 'loar_generate_sound_effect',
  description: 'Generate a sound effect from a text description',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Description of the sound effect' },
      durationSeconds: { type: 'number', description: 'Duration in seconds (optional)' },
      entityId: { type: 'string', description: 'Entity to attach audio to (optional)' },
    },
    required: ['prompt'],
  },
  handler: async (client, args) => {
    return client.mutate('voice.soundEffect', args);
  },
};

const createContent: ToolDefinition = {
  name: 'loar_create_content',
  description: 'Create a content item (episode, artwork, etc.) in the gallery',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Content title' },
      description: { type: 'string', description: 'Content description' },
      mediaUrl: { type: 'string', description: 'URL of the media file' },
      mediaType: {
        type: 'string',
        description: 'Media type (image, video, audio, model)',
        enum: ['image', 'video', 'audio', 'model'],
      },
      universeId: { type: 'string', description: 'Universe to associate with (optional)' },
      classification: {
        type: 'string',
        description: 'Rights classification',
        enum: ['fan', 'original', 'licensed'],
      },
    },
    required: ['title', 'mediaUrl', 'mediaType'],
  },
  handler: async (client, args) => {
    return client.mutate('content.create', args);
  },
};

const mintContentNFT: ToolDefinition = {
  name: 'loar_mint_content_nft',
  description: 'Mint gallery content as an NFT (pins to IPFS and creates listing)',
  inputSchema: {
    type: 'object',
    properties: {
      contentId: { type: 'string', description: 'Content item ID from gallery' },
      mintPrice: { type: 'string', description: 'Mint price in wei (default 0)' },
      maxSupply: { type: 'number', description: 'Max editions (0 = unlimited)' },
      royaltyBps: { type: 'number', description: 'Royalty basis points (default 500 = 5%)' },
    },
    required: ['contentId'],
  },
  handler: async (client, args) => {
    return client.mutate('nft.mintContent', args);
  },
};

const createListing: ToolDefinition = {
  name: 'loar_create_listing',
  description: 'Create a marketplace listing for an NFT, merch, subscription, or license',
  inputSchema: {
    type: 'object',
    properties: {
      productType: {
        type: 'string',
        description: 'Product type',
        enum: [
          'EPISODE_NFT',
          'CHARACTER_NFT',
          'ARTIFACT',
          'SUBSCRIPTION_TIER',
          'CANON_LICENSE',
          'MERCH',
          'SPONSORED_SLOT',
          'IP_LICENSE',
        ],
      },
      title: { type: 'string', description: 'Listing title' },
      description: { type: 'string', description: 'Listing description' },
      price: { type: 'string', description: 'Price (in wei for ETH/LOAR)' },
      currency: {
        type: 'string',
        description: 'Currency',
        enum: ['ETH', 'LOAR', 'CREDITS', 'USD'],
      },
      universeId: { type: 'string', description: 'Universe ID (optional)' },
      publishImmediately: { type: 'boolean', description: 'Publish immediately (default false)' },
    },
    required: ['productType', 'title', 'price'],
  },
  handler: async (client, args) => {
    return client.mutate('listings.create', args);
  },
};

const recordEpisode: ToolDefinition = {
  name: 'loar_record_collab_episode',
  description: 'Record an episode produced by a collaboration',
  inputSchema: {
    type: 'object',
    properties: {
      collabId: { type: 'string', description: 'Collaboration ID' },
      episodeTitle: { type: 'string', description: 'Episode title' },
      episodeUrl: { type: 'string', description: 'URL to the episode content' },
      revenueWei: { type: 'string', description: 'Revenue generated in wei' },
    },
    required: ['collabId', 'episodeTitle'],
  },
  handler: async (client, args) => {
    return client.mutate('collabs.recordEpisode', args);
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

// ── Job Control Tools (status polling + cancellation) ──────────────────

const getJobStatus: ToolDefinition = {
  name: 'loar_get_job_status',
  description:
    'Check normalized status of any async generation job (video, image, voice, 3D, or studio pack). Returns { jobId, kind, status, progress, resultUrl, errorCode }. Use once when the user asks "is it done?" — do NOT poll in a loop.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'Job ID returned by any generation tool (generationId, jobId, etc.).',
      },
      kind: {
        type: 'string',
        description: 'Optional hint to skip cross-collection probes',
        enum: ['video', 'image', 'voice', '3d', 'studio'],
      },
    },
    required: ['jobId'],
  },
  handler: async (client, args) => {
    return client.query('jobs.status', args);
  },
};

const cancelGeneration: ToolDefinition = {
  name: 'loar_cancel_generation',
  description:
    'Cancel an in-flight generation job (any kind: video, image, voice, 3D, studio pack) and refund unconsumed credits. Terminal jobs return an idempotent no-op. Use when the user says "cancel that".',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: { type: 'string', description: 'Job ID to cancel' },
      kind: {
        type: 'string',
        description: 'Optional hint to skip cross-collection probes',
        enum: ['video', 'image', 'voice', '3d', 'studio'],
      },
      reason: { type: 'string', description: 'Optional user-provided reason' },
    },
    required: ['jobId'],
  },
  handler: async (client, args) => {
    return client.mutate('jobs.cancel', args);
  },
};

// ── Z.AI (GLM / CogView / CogVideoX) Tools ────────────────────────────

const zaiWorldbuild: ToolDefinition = {
  name: 'loar_zai_worldbuild',
  description:
    'Generate a full LOAR universe bundle (universe + 6–12 entities) from a single prompt using Z.AI GLM-4.6. Auto-creates entities in Firestore unless persist=false.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'High-level concept for the universe' },
      universeAddress: {
        type: 'string',
        description: 'Universe contract address to attach entities to (optional)',
      },
      persist: {
        type: 'string',
        description: 'Set "false" to preview without writing entities. Default true.',
      },
    },
    required: ['prompt'],
  },
  handler: async (client, args) => {
    const persist = args.persist === 'false' ? false : true;
    return client.mutate('zai.worldbuild', { ...args, persist });
  },
};

const zaiSeedFromUrl: ToolDefinition = {
  name: 'loar_zai_seed_from_url',
  description:
    'Fetch a real-world URL via Z.AI Web Reader and turn it into a LOAR universe with entities.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Public URL (Wikipedia, news article, etc.)' },
      universeAddress: { type: 'string', description: 'Universe to attach entities to (optional)' },
    },
    required: ['url'],
  },
  handler: async (client, args) => client.mutate('zai.seedFromUrl', args),
};

const zaiGenerateVideo: ToolDefinition = {
  name: 'loar_zai_generate_video',
  description:
    'Generate a video via Z.AI CogVideoX-3 (text-to-video or image-to-video). Output is rehosted on LOAR storage.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Motion prompt' },
      imageUrl: { type: 'string', description: 'Reference frame for image-to-video (optional)' },
      duration: { type: 'number', description: 'Duration in seconds (2–15)' },
      aspectRatio: { type: 'string', description: '1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 21:9' },
      withAudio: { type: 'string', description: 'Set "true" for inline audio track' },
    },
    required: ['prompt'],
  },
  handler: async (client, args) =>
    client.mutate('zai.generateVideo', {
      ...args,
      withAudio: args.withAudio === 'true' ? true : undefined,
    }),
};

const zaiCanonCheck: ToolDefinition = {
  name: 'loar_zai_canon_check',
  description:
    'Run a vision consistency check on one or more frames against a universe lore summary. Returns 0–100 score + flagged contradictions.',
  inputSchema: {
    type: 'object',
    properties: {
      imageUrls: {
        type: 'string',
        description: 'Comma-separated image URLs to evaluate',
      },
      universeName: { type: 'string', description: 'Universe display name' },
      loreSummary: { type: 'string', description: 'Lore summary to score against' },
    },
    required: ['imageUrls', 'universeName', 'loreSummary'],
  },
  handler: async (client, args) => {
    const urls = String(args.imageUrls ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return client.mutate('zai.canonCheck', { ...args, imageUrls: urls });
  },
};

const zaiGovernanceAgent: ToolDefinition = {
  name: 'loar_zai_governance_agent',
  description:
    'Summarize a DAO proposal against a universe charter and recommend a vote with rationale. Powered by GLM-4.6 with deep-thinking enabled.',
  inputSchema: {
    type: 'object',
    properties: {
      proposalTitle: { type: 'string', description: 'Proposal title' },
      proposalBody: { type: 'string', description: 'Full proposal text' },
      charter: { type: 'string', description: 'Universe charter / mission (optional)' },
    },
    required: ['proposalTitle', 'proposalBody'],
  },
  handler: async (client, args) => client.mutate('zai.governanceAgent', args),
};

// ── Uniswap (DeFi swaps for agents) ────────────────────────────────────
// Lets an AI agent price and execute on-chain swaps through the Uniswap
// Trading API, settled via the user's Circle DCW wallet. Native ETH is the
// zero address 0x0000000000000000000000000000000000000000.

const uniswapQuote: ToolDefinition = {
  name: 'loar_uniswap_quote',
  description:
    'Get a Uniswap price quote + route for swapping one token to another (read-only, no transaction). Use the zero address for native ETH. Returns the expected output amount, gas estimate, and whether an ERC20 approval is required.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenIn: {
        type: 'string',
        description: 'Input token address (0x0000…0000 for native ETH)',
      },
      tokenOut: { type: 'string', description: 'Output token address' },
      amount: {
        type: 'string',
        description: 'Amount of tokenIn in wei (base-10 string), for EXACT_INPUT',
      },
      chainId: {
        type: 'number',
        description: 'Chain id: 11155111 (Sepolia, default) or 1 (Ethereum mainnet)',
      },
    },
    required: ['tokenIn', 'tokenOut', 'amount'],
  },
  handler: async (client, args) => client.query('uniswap.quote', args),
};

const uniswapSwap: ToolDefinition = {
  name: 'loar_uniswap_swap',
  description:
    'Execute a token swap on-chain via Uniswap, signed by the agent owner’s Circle wallet. Use the zero address for native ETH. Returns the on-chain transaction hash. For ERC20 inputs, approval + Permit2 are handled automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenIn: {
        type: 'string',
        description: 'Input token address (0x0000…0000 for native ETH)',
      },
      tokenOut: { type: 'string', description: 'Output token address' },
      amount: { type: 'string', description: 'Amount of tokenIn in wei (base-10 string)' },
      chainId: {
        type: 'number',
        description: 'Chain id: 11155111 (Sepolia, default) or 1 (Ethereum mainnet)',
      },
      slippageTolerance: {
        type: 'string',
        description: 'Optional slippage percent, e.g. "0.5". Omit for auto.',
      },
    },
    required: ['tokenIn', 'tokenOut', 'amount'],
  },
  handler: async (client, args) => client.mutate('uniswap.swap', args),
};

const uniswapSwapToLoar: ToolDefinition = {
  name: 'loar_uniswap_swap_to_loar',
  description:
    'Swap any token (default native ETH) into $LOAR — the LOAR credit/discount currency — via Uniswap, signed by the agent owner’s Circle wallet. The on-ramp for buying platform credits with crypto. Returns the on-chain transaction hash.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenIn: {
        type: 'string',
        description: 'Input token (default 0x0000…0000 = native ETH)',
      },
      amount: { type: 'string', description: 'Amount of tokenIn in wei (base-10 string)' },
      chainId: {
        type: 'number',
        description: 'Chain id where $LOAR is deployed: 11155111 (Sepolia, default)',
      },
      slippageTolerance: {
        type: 'string',
        description: 'Optional slippage percent, e.g. "0.5". Omit for auto.',
      },
    },
    required: ['amount'],
  },
  handler: async (client, args) => client.mutate('uniswap.swapToLoar', args),
};

// ── ENS (agent identity) ───────────────────────────────────────────────

const ensResolve: ToolDefinition = {
  name: 'loar_ens_resolve',
  description:
    'Resolve an ENS name to an address, or reverse-resolve an address to its primary ENS name. Provide exactly one of {name, address}.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'ENS name to resolve to an address' },
      address: { type: 'string', description: '0x address to reverse-resolve to a name' },
    },
  },
  handler: async (client, args) => {
    if (args.address) return client.query('ens.reverse', { address: args.address });
    return client.query('ens.resolve', { name: args.name });
  },
};

const ensAgentCard: ToolDefinition = {
  name: 'loar_ens_agent_card',
  description:
    'Read an ENS name as an AI-agent identity (ENSIP-25/26): its MCP / A2A endpoints, description, and address. Use to discover how to reach an agent by its ENS name.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Agent ENS name' } },
    required: ['name'],
  },
  handler: async (client, args) => client.query('ens.agentCard', args),
};

const ensClaimAgentSubname: ToolDefinition = {
  name: 'loar_ens_claim_agent_subname',
  description:
    'Claim a gasless ENS subname for one of your AI agents (e.g. showrunner.agents.loar.eth). The name resolves to your wallet and advertises ENSIP-26 agent endpoints, making the agent discoverable via ENS.',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Leftmost label, a–z 0–9 hyphen (e.g. "showrunner")' },
      aiAgentId: { type: 'string', description: 'The LOAR AI agent id to attach the name to' },
      description: { type: 'string', description: 'Short agent description (optional)' },
      mcpEndpoint: { type: 'string', description: 'MCP endpoint URL (optional)' },
    },
    required: ['label', 'aiAgentId'],
  },
  handler: async (client, args) => client.mutate('ens.claimAgentSubname', args),
};

// ── Arc (USDC agent-to-agent payments) ─────────────────────────────────

const arcPay: ToolDefinition = {
  name: 'loar_arc_pay',
  description:
    'Pay another agent (or address) in USDC on Arc (Circle’s USDC-native L1). Use for agent-to-agent settlement — paying for a service, render, or data. Returns the on-chain tx hash + explorer URL.',
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient 0x address' },
      amountUsdc: { type: 'string', description: 'USDC amount, up to 6 decimals (e.g. "0.05")' },
      memo: { type: 'string', description: 'Optional memo' },
      toAgentId: { type: 'string', description: 'Optional recipient agent id' },
    },
    required: ['to', 'amountUsdc'],
  },
  handler: async (client, args) => client.mutate('arc.pay', args),
};

const arcBalance: ToolDefinition = {
  name: 'loar_arc_balance',
  description: 'Get the USDC balance of an address on Arc.',
  inputSchema: {
    type: 'object',
    properties: { address: { type: 'string', description: '0x address' } },
    required: ['address'],
  },
  handler: async (client, args) => client.query('arc.balance', args),
};

// ── Agent reputation (ERC-8004 via BigQuery) ───────────────────────────

const agentRank: ToolDefinition = {
  name: 'loar_agent_rank',
  description:
    'Rank on-chain AI agents by ERC-8004 reputation (feedback volume), computed from Ethereum mainnet via BigQuery. Use to discover trustworthy, payable agents.',
  inputSchema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max agents to return (1–100)' } },
  },
  handler: async (client, args) => client.query('agentRegistry.rank', args),
};

const agentReputation: ToolDefinition = {
  name: 'loar_agent_reputation',
  description: 'Get the ERC-8004 reputation summary for a single agent id (on-chain identifier).',
  inputSchema: {
    type: 'object',
    properties: { agentId: { type: 'string', description: 'ERC-8004 agent id (0x-hex)' } },
    required: ['agentId'],
  },
  handler: async (client, args) => client.query('agentRegistry.reputation', args),
};

// ── Export All Tools ───────────────────────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [
  // Z.AI integrations
  zaiWorldbuild,
  zaiSeedFromUrl,
  zaiGenerateVideo,
  zaiCanonCheck,
  zaiGovernanceAgent,
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
  createAIAgent,
  runPipeline,
  updatePipeline,
  getPipelineRun,
  createApiKey,
  // Profiles
  getProfile,
  discoverProfiles,
  // Talent Agents
  discoverTalentAgents,
  // Pipeline Step Tools (for AI agent pipeline execution)
  generateVoice,
  generate3D,
  generateSoundEffect,
  createContent,
  mintContentNFT,
  createListing,
  recordEpisode,
  // Credits
  getCredits,
  // Job control (polling + cancellation)
  getJobStatus,
  cancelGeneration,
  // Uniswap (DeFi swaps + swap-to-buy-credits on-ramp for agents)
  uniswapQuote,
  uniswapSwap,
  uniswapSwapToLoar,
  // ENS (agent identity)
  ensResolve,
  ensAgentCard,
  ensClaimAgentSubname,
  // Arc (USDC agent-to-agent payments)
  arcPay,
  arcBalance,
  // Agent reputation (ERC-8004 via BigQuery)
  agentRank,
  agentReputation,
];
