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

// ── Solana tools ───────────────────────────────────────────────────────
//
// First-class MCP surface so AI agents can mint cNFTs, canonize episodes,
// generate Solana Pay intents, and read on-chain activity directly. The
// auth model matches the rest of the MCP layer (loar_<scope> API key);
// agents acting on behalf of a wallet pass it via X-Loar-End-User-Address
// (set on the LoarClient at construction).

const solanaMintEpisode: ToolDefinition = {
  name: 'loar_solana_mint_episode',
  description:
    'Mint a Bubblegum cNFT episode under a Solana Universe. Composes the Anchor episode record + Bubblegum mint_v1 ix in one Circle-signed tx. Returns the txSignature, episodePda, and (best-effort) cross-chain attestation receipt.',
  inputSchema: {
    type: 'object',
    properties: {
      universeAddress: { type: 'string', description: 'Solana Universe PDA (base58)' },
      contentHashHex: {
        type: 'string',
        description: '32-byte content hash as 0x-prefixed hex (matches EVM bytes32 shape)',
      },
      metadataUri: {
        type: 'string',
        description: 'Off-chain metadata URI (IPFS / Arweave / HTTPS)',
      },
      title: { type: 'string', description: 'Episode title — Bubblegum metadata name (≤32 bytes)' },
      contentId: {
        type: 'string',
        description: 'Optional LOAR content id for cross-chain lineage',
      },
      evmUniverseAddress: {
        type: 'string',
        description:
          'Optional EVM universe 0x address — pinned into the cross-chain attestation receipt',
      },
    },
    required: ['universeAddress', 'contentHashHex', 'metadataUri', 'title'],
  },
  handler: async (client, args) => {
    const lineage: Record<string, unknown> = {};
    if (args.contentId) lineage.contentId = args.contentId;
    if (args.evmUniverseAddress) lineage.evmUniverseAddress = args.evmUniverseAddress;
    return client.rawPost('/api/solana/episode/mint', {
      universeAddress: args.universeAddress,
      contentHashHex: args.contentHashHex,
      metadataUri: args.metadataUri,
      title: args.title,
      ...(Object.keys(lineage).length > 0 ? { lineage } : {}),
    });
  },
};

const solanaCanonizeEpisode: ToolDefinition = {
  name: 'loar_solana_canonize_episode',
  description:
    "Promote an Episode to canon: flips is_canon on the EpisodeRecord PDA and mints a Metaplex Core asset (5% creator royalty) in one atomic tx. The original cNFT stays as historical mint record. Pre-flight rejects if the episode doesn't exist (404) or is already canon (409).",
  inputSchema: {
    type: 'object',
    properties: {
      universeAddress: {
        type: 'string',
        description: 'Solana Universe PDA the episode lives under',
      },
      contentHashHex: { type: 'string', description: '32-byte content hash of the episode' },
      metadataUri: { type: 'string', description: 'Off-chain metadata URI for the Core asset' },
      name: { type: 'string', description: 'Display name of the canon Core asset (≤64 chars)' },
      cnftAssetId: {
        type: 'string',
        description:
          'Optional Bubblegum cNFT asset id — pinned into the Core asset Attributes plugin so wallets can link cNFT ↔ Core',
      },
    },
    required: ['universeAddress', 'contentHashHex', 'metadataUri', 'name'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/episode/canonize', args),
};

const solanaPayIntent: ToolDefinition = {
  name: 'loar_solana_pay_intent',
  description:
    'Create a Solana Pay intent — returns a `solana:` URL the user can scan with Phantom/Solflare and a unique reference key for polling. Supports SOL (default) or any SPL token mint.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: {
        type: 'string',
        description: 'Decimal amount (e.g. "0.05" for 0.05 SOL or 0.05 of an SPL token)',
      },
      splToken: {
        type: 'string',
        description: 'Optional SPL token mint (base58). Omit for native SOL.',
      },
      label: { type: 'string', description: 'Display label shown to the buyer in their wallet UI' },
      memo: {
        type: 'string',
        description: 'Optional on-chain memo (indexed by Helius, useful for AI-gen receipts)',
      },
    },
    required: ['amount'],
  },
  handler: async (client, args) => client.rawPost('/api/solana-pay/intent', args),
};

const solanaPayStatus: ToolDefinition = {
  name: 'loar_solana_pay_status',
  description:
    'Check whether a Solana Pay intent has been settled on-chain. Returns one of pending / paid / expired / invalid. Validates the on-chain tx matches the requested recipient + amount.',
  inputSchema: {
    type: 'object',
    properties: {
      reference: {
        type: 'string',
        description: 'The reference key returned by loar_solana_pay_intent',
      },
    },
    required: ['reference'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana-pay/status', { reference: String(args.reference) }),
};

const solanaActivity: ToolDefinition = {
  name: 'loar_solana_activity',
  description:
    "Read-only snapshot of LOAR's on-chain Solana state: total universes / episodes / canon / cNFT mints, recent activity, treasury balance.",
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (client) => client.rawGet('/api/solana/activity'),
};

const solanaAttestation: ToolDefinition = {
  name: 'loar_solana_get_attestation',
  description:
    'Fetch the cross-chain Ed25519 attestation receipt for a minted episode (proves Solana cNFT ↔ EVM Universe linkage). Verifiable offline with the public key at /api/solana/attestation/key.',
  inputSchema: {
    type: 'object',
    properties: {
      episodePda: { type: 'string', description: 'Solana Episode PDA (base58)' },
    },
    required: ['episodePda'],
  },
  handler: async (client, args) =>
    client.rawGet(`/api/solana/attestation/${String(args.episodePda)}`),
};

// ── Solana ported-program tools ────────────────────────────────────────────
//
// One MCP tool per high-value op across the 10 ported Anchor programs (canon
// vote, license buy, subscribe, stake/unstake, buy credits, bonding-curve
// trade, claim fees, premium action, charge remix fee, route splits) plus
// the read tools that AI agents need to make decisions. Mirrors the EVM
// surface so an agent can drive the full monetization stack on either chain.

const solanaLicenseBuy: ToolDefinition = {
  name: 'loar_solana_license_buy',
  description:
    'Buy permanent access to content via the Solana licensing program. Returns the BuyerDeal PDA — caller can then prove access via loar_solana_license_check_access.',
  inputSchema: {
    type: 'object',
    properties: {
      contentHashHex: {
        type: 'string',
        description:
          '32-byte content hash as 0x-prefixed hex (matches the EVM ContentLicensing bytes32 shape)',
      },
    },
    required: ['contentHashHex'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/licensing/buy', args),
};

const solanaLicenseCheckAccess: ToolDefinition = {
  name: 'loar_solana_license_check_access',
  description:
    'Check whether the caller holds a BuyerDeal for a given content hash on Solana licensing. Returns { hasAccess: boolean, address }.',
  inputSchema: {
    type: 'object',
    properties: {
      contentHashHex: { type: 'string', description: '32-byte content hash as 0x-hex' },
    },
    required: ['contentHashHex'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana/licensing/access', { contentHashHex: String(args.contentHashHex) }),
};

const solanaLicenseReadRegistration: ToolDefinition = {
  name: 'loar_solana_license_read_registration',
  description:
    'Read the Registration PDA for a content hash — returns price, creator, and active state for licensable Solana content. Public read; no auth required.',
  inputSchema: {
    type: 'object',
    properties: {
      contentHashHex: { type: 'string', description: '32-byte content hash as 0x-hex' },
    },
    required: ['contentHashHex'],
  },
  handler: async (client, args) =>
    client.rawGet(`/api/solana/licensing/registration/${String(args.contentHashHex)}`),
};

const solanaCanonVote: ToolDefinition = {
  name: 'loar_solana_canon_vote',
  description:
    'Token-weighted vote on a canon submission. Locks `amount` of the universe token until the voting window closes (lock-during-window model — replaces EVM snapshot voting).',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Solana Universe PDA (base58)' },
      contentHashHex: { type: 'string', description: 'Submission content hash, 0x-hex' },
      support: { type: 'boolean', description: 'true = for, false = against' },
      amount: {
        type: 'string',
        description: 'Token amount to lock (decimal integer string, base units)',
      },
    },
    required: ['universe', 'contentHashHex', 'support', 'amount'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/canon-market/vote', args),
};

const solanaCanonReadSubmission: ToolDefinition = {
  name: 'loar_solana_canon_read_submission',
  description:
    'Read a canon submission — returns state (Active / Accepted / Rejected / Expired), votes for/against, and participation vs quorum. Public read.',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
      contentHashHex: { type: 'string', description: 'Content hash, 0x-hex' },
    },
    required: ['universe', 'contentHashHex'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana/canon-market/submission', {
      universe: String(args.universe),
      contentHashHex: String(args.contentHashHex),
    }),
};

const solanaStake: ToolDefinition = {
  name: 'loar_solana_stake',
  description:
    'Stake $LOAR to climb staking tiers (Bronze → Diamond) on the Solana LaunchpadStaking port. Tier confers launchpad benefits + governance weight.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'string', description: 'Amount in base units (decimal integer string)' },
    },
    required: ['amount'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/staking/stake', args),
};

const solanaUnstake: ToolDefinition = {
  name: 'loar_solana_unstake',
  description:
    'Unstake $LOAR. Early-unstake penalty applies if the lock period has not elapsed; the penalty share is sent to penaltyDestinationAta.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'string', description: 'Amount in base units (decimal integer string)' },
      penaltyDestinationAta: {
        type: 'string',
        description: 'ATA (base58) that receives any early-unstake penalty share',
      },
    },
    required: ['amount', 'penaltyDestinationAta'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/staking/unstake', args),
};

const solanaStakingInfo: ToolDefinition = {
  name: 'loar_solana_staking_info',
  description:
    "Read the caller's stake info — staked amount, tier, lock period, weighted average staked_at.",
  inputSchema: { type: 'object', properties: {} },
  handler: async (client) => client.rawGet('/api/solana/staking/info'),
};

const solanaCreditsBuySol: ToolDefinition = {
  name: 'loar_solana_credits_buy_sol',
  description: 'Buy a credit package with SOL on the Solana credit_manager program.',
  inputSchema: {
    type: 'object',
    properties: {
      packageId: { type: 'string', description: 'Credit package id (decimal integer string)' },
    },
    required: ['packageId'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/credits/purchase-sol', args),
};

const solanaCreditsBuyLoar: ToolDefinition = {
  name: 'loar_solana_credits_buy_loar',
  description: 'Buy a credit package with $LOAR (Token-2022) on the Solana credit_manager program.',
  inputSchema: {
    type: 'object',
    properties: {
      packageId: { type: 'string', description: 'Credit package id (decimal integer string)' },
    },
    required: ['packageId'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/credits/purchase-loar', args),
};

const solanaCreditsBalance: ToolDefinition = {
  name: 'loar_solana_credits_balance',
  description: "Read the caller's Solana credit balance + lifetime spend / earned.",
  inputSchema: { type: 'object', properties: {} },
  handler: async (client) => client.rawGet('/api/solana/credits/balance'),
};

const solanaSubscribe: ToolDefinition = {
  name: 'loar_solana_subscribe',
  description:
    'Subscribe to a universe on Solana. tierId 0=FREE, 1=BASIC, 2=PREMIUM, 3=VIP. SOL flows to the universe creator (split per Config) + platform treasury.',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
      tierId: { type: 'number', description: '0=FREE, 1=BASIC, 2=PREMIUM, 3=VIP' },
      months: { type: 'number', description: 'Number of months (1–60)' },
    },
    required: ['universe', 'tierId', 'months'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/subscription/subscribe', args),
};

const solanaSubscriptionStatus: ToolDefinition = {
  name: 'loar_solana_subscription_status',
  description:
    "Check the caller's subscription status for a universe — returns active flag, remaining seconds, tier, and expiresAt.",
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
    },
    required: ['universe'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana/subscription/status', { universe: String(args.universe) }),
};

const solanaCurveBuy: ToolDefinition = {
  name: 'loar_solana_curve_buy',
  description:
    'Buy universe tokens on a Solana bonding curve. Pays up to solInMaxLamports SOL, receives at least minTokensOut tokens. Reverts past deadlineSecs (default now+120s).',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
      solInMaxLamports: {
        type: 'string',
        description: 'Max SOL to spend, in lamports (decimal integer string)',
      },
      minTokensOut: {
        type: 'string',
        description: 'Slippage floor — min tokens (base units, decimal integer string)',
      },
      deadlineSecs: {
        type: 'string',
        description: 'Optional unix-seconds deadline; default now+120s',
      },
    },
    required: ['universe', 'solInMaxLamports', 'minTokensOut'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/bonding-curve/buy', args),
};

const solanaCurveSell: ToolDefinition = {
  name: 'loar_solana_curve_sell',
  description:
    'Sell universe tokens back to a Solana bonding curve. Receives at least minSolOutLamports (1% sell fee retained in reserve).',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
      tokenAmount: { type: 'string', description: 'Token amount to sell (base units)' },
      minSolOutLamports: { type: 'string', description: 'Slippage floor — min SOL in lamports' },
      deadlineSecs: {
        type: 'string',
        description: 'Optional unix-seconds deadline; default now+120s',
      },
    },
    required: ['universe', 'tokenAmount', 'minSolOutLamports'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/bonding-curve/sell', args),
};

const solanaCurveState: ToolDefinition = {
  name: 'loar_solana_curve_state',
  description:
    'Read a Solana bonding-curve state — price, tokens sold, SOL raised, graduation progress (bps), and graduated/halted flags.',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Universe PDA (base58)' },
    },
    required: ['universe'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana/bonding-curve/state', { universe: String(args.universe) }),
};

const solanaClaimFees: ToolDefinition = {
  name: 'loar_solana_claim_fees',
  description:
    'Pull accrued fees for the caller from the Solana fee_locker for a given SPL mint. Pull pattern — no auto-distribution.',
  inputSchema: {
    type: 'object',
    properties: {
      mint: {
        type: 'string',
        description: 'SPL token mint (base58) — which token balance to claim',
      },
    },
    required: ['mint'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/fee-locker/claim', args),
};

const solanaFeeBalance: ToolDefinition = {
  name: 'loar_solana_fee_balance',
  description:
    "Read the caller's accrued fee balance for a given SPL mint in the Solana fee locker.",
  inputSchema: {
    type: 'object',
    properties: {
      mint: { type: 'string', description: 'SPL token mint (base58)' },
    },
    required: ['mint'],
  },
  handler: async (client, args) =>
    client.rawGet('/api/solana/fee-locker/balance', { mint: String(args.mint) }),
};

const solanaPremiumAction: ToolDefinition = {
  name: 'loar_solana_premium_action',
  description:
    'Pay $LOAR for a premium action (priority_generation, permanent_canon, premium_profile, remix_boost, custom). $LOAR splits between LP + treasury per Config.lpRatioBps. Despite legacy "burner" naming, no supply destruction.',
  inputSchema: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: "Human action label (sha256'd server-side). Use this OR actionHex.",
      },
      actionHex: {
        type: 'string',
        description: 'Pre-hashed 32-byte action name as 0x-hex. Use this OR label.',
      },
    },
  },
  handler: async (client, args) => client.rawPost('/api/solana/premium-actions/execute', args),
};

const solanaChargeRemixFee: ToolDefinition = {
  name: 'loar_solana_charge_remix_fee',
  description:
    'Charge the Solana remix fee for re-using content. 3-way $LOAR split: creator / LP / treasury. Per-universe override falls back to Config.defaultRemixFee.',
  inputSchema: {
    type: 'object',
    properties: {
      universe: { type: 'string', description: 'Source universe PDA (base58)' },
      contentHashHex: { type: 'string', description: 'Remixed content hash, 0x-hex' },
    },
    required: ['universe', 'contentHashHex'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/remix-fees/charge', args),
};

const solanaRouteSplits: ToolDefinition = {
  name: 'loar_solana_route_splits',
  description:
    "Route SOL through an entity's configured splits + platform fee on the Solana split_router. Recipients + their bps come from the on-chain Splits PDA; ordering must match.",
  inputSchema: {
    type: 'object',
    properties: {
      entityHashHex: {
        type: 'string',
        description: '32-byte entity hash as 0x-hex (identifies the splits config)',
      },
      amountLamports: { type: 'string', description: 'Total SOL to route, in lamports' },
      platformFeeBps: {
        type: 'number',
        description: 'Platform fee in basis points (0–5000)',
      },
    },
    required: ['entityHashHex', 'amountLamports', 'platformFeeBps'],
  },
  handler: async (client, args) => client.rawPost('/api/solana/split-router/route', args),
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
  // Solana — first-class cross-chain surface for AI agents
  solanaMintEpisode,
  solanaCanonizeEpisode,
  solanaPayIntent,
  solanaPayStatus,
  solanaActivity,
  solanaAttestation,
  // Solana ported programs — full EVM-feature parity
  solanaLicenseBuy,
  solanaLicenseCheckAccess,
  solanaLicenseReadRegistration,
  solanaCanonVote,
  solanaCanonReadSubmission,
  solanaStake,
  solanaUnstake,
  solanaStakingInfo,
  solanaCreditsBuySol,
  solanaCreditsBuyLoar,
  solanaCreditsBalance,
  solanaSubscribe,
  solanaSubscriptionStatus,
  solanaCurveBuy,
  solanaCurveSell,
  solanaCurveState,
  solanaClaimFees,
  solanaFeeBalance,
  solanaPremiumAction,
  solanaChargeRemixFee,
  solanaRouteSplits,
];
