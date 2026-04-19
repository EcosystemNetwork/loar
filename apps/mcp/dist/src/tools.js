// ── Entity Tools ───────────────────────────────────────────────────────
const createEntity = {
    name: 'loar_create_entity',
    description: 'Create a new entity (character, place, thing, faction, event, lore, etc.) in a universe or as standalone',
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
const listEntities = {
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
const getEntity = {
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
const generateVideo = {
    name: 'loar_generate_video',
    description: 'Generate a video using AI. Supports text-to-video and image-to-video modes with smart model routing.',
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
const generateImage = {
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
const createAssetPack = {
    name: 'loar_create_asset_pack',
    description: 'Generate a complete asset pack for an entity (portrait, voice, 3D model, lore card, etc.)',
    inputSchema: {
        type: 'object',
        properties: {
            entityId: { type: 'string', description: 'Entity to generate assets for' },
            capabilities: {
                type: 'string',
                description: 'Comma-separated list of capabilities: portrait, voice, sound_motif, intro_video, 3d_model, lore_card, hero_image, ambience_sound, establishing_shot, product_shot, sound_effect, keyframe_image, animated_short',
            },
        },
        required: ['entityId'],
    },
    handler: async (client, args) => {
        const capabilities = typeof args.capabilities === 'string'
            ? args.capabilities.split(',').map((s) => s.trim())
            : args.capabilities || ['portrait', 'lore_card'];
        return client.mutate('studio.createEntityPack', { ...args, capabilities });
    },
};
// ── Universe Tools ─────────────────────────────────────────────────────
const listUniverses = {
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
const getUniverse = {
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
const submitToCanon = {
    name: 'loar_submit_to_canon',
    description: "Submit content for inclusion in a universe's canon. Goes through token-weighted community voting.",
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
const getCanon = {
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
const proposeCollab = {
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
const listAIAgents = {
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
const runPipeline = {
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
const getPipelineRun = {
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
const getProfile = {
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
const discoverProfiles = {
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
const discoverTalentAgents = {
    name: 'loar_discover_talent_agents',
    description: 'Browse talent agents on the platform. Filter by specialties and verification status.',
    inputSchema: {
        type: 'object',
        properties: {
            search: { type: 'string', description: 'Search by name or agency' },
            specialties: { type: 'string', description: 'Comma-separated specialties filter' },
            verifiedOnly: { type: 'boolean', description: 'Only show verified agents' },
        },
    },
    handler: async (client, args) => {
        const specialties = typeof args.specialties === 'string'
            ? args.specialties.split(',').map((s) => s.trim())
            : undefined;
        return client.query('talentAgents.discover', { ...args, specialties });
    },
};
// ── Pipeline Step Tools (Internal actions for AI agent pipeline steps) ──
const generateVoice = {
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
const generate3D = {
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
const generateSoundEffect = {
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
const createContent = {
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
const mintContentNFT = {
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
const createListing = {
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
const recordEpisode = {
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
const getCredits = {
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
const getJobStatus = {
    name: 'loar_get_job_status',
    description: 'Check normalized status of any async generation job (video, image, voice, 3D, or studio pack). Returns { jobId, kind, status, progress, resultUrl, errorCode }. Use once when the user asks "is it done?" — do NOT poll in a loop.',
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
const cancelGeneration = {
    name: 'loar_cancel_generation',
    description: 'Cancel an in-flight generation job (any kind: video, image, voice, 3D, studio pack) and refund unconsumed credits. Terminal jobs return an idempotent no-op. Use when the user says "cancel that".',
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
// ── Export All Tools ───────────────────────────────────────────────────
export const ALL_TOOLS = [
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
];
