import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { validateUploadUrl } from '../lib/url-validator';
import { redactSecrets } from '../lib/redact-secrets';
import { recordProviderCost, assertProviderAllowed } from './cost-tracker';
import { routeLlmModel, dispatchLlmWithFallback } from './llm-models';

/**
 * Sanitize user-supplied text before interpolating into AI prompts.
 * Strips common prompt injection patterns while preserving legitimate content.
 */
function sanitizeForPrompt(text: string, maxLen = 5000): string {
  return (
    text
      .replace(/\n{3,}/g, '\n\n')
      // Strip role-prefix injection attempts (case-insensitive)
      .replace(/(^|\n)\s*(system|assistant|user|human)\s*:/gim, '$1[filtered]:')
      // Strip common injection phrases
      .replace(
        /\b(ignore|forget|disregard|override)\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|context|rules?)\b/gi,
        '[filtered]'
      )
      // Strip HTML/XML tags
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .slice(0, maxLen)
  );
}

// Initialize Gemini — fail fast if key missing
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.warn(
    '⚠️  GOOGLE_API_KEY not set — Gemini features (wiki generation, character analysis) will be unavailable'
  );
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY || 'missing');
const fileManager = new GoogleAIFileManager(GOOGLE_API_KEY || 'missing');

function ensureGeminiKey() {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY environment variable is required for Gemini features');
  }
}

async function ensureGeminiAllowed() {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY environment variable is required for Gemini features');
  }
  // Cost-tracker admin controls: kill-switch + daily caps.
  await assertProviderAllowed({ provider: 'gemini' });
}

function safeJsonParse<T>(text: string, label: string): T {
  let jsonText = text.trim();
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.split('```json')[1].split('```')[0].trim();
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.split('```')[1].split('```')[0].trim();
  }
  try {
    return JSON.parse(jsonText) as T;
  } catch (err) {
    throw new Error(`Failed to parse Gemini ${label} response as JSON: ${(err as Error).message}`);
  }
}

const FILE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface WikiData {
  title: string;
  summary: string;
  videoAnalysis: {
    setting: string;
    visualStyle: string;
    subjects: string;
    action: string;
  };
  plot: string;
  elements: Array<{
    name: string;
    description: string;
    actions: string[];
    characterId?: string; // Optional character ID for linking to character images
  }>;
  keyMoments: string[];
  duration?: string;
  visualDetails?: string[];
}

export interface VideoAnalysisResult {
  wikiData: WikiData;
  metadata: {
    tokensUsed: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    generatedBy: string;
  };
}

/**
 * Generate wiki entry from video using Gemini 2.5 Pro
 */
export async function generateWikiFromVideo(
  videoUrl: string,
  eventData: {
    eventId: string;
    title: string;
    description: string;
    characterIds?: string[];
    characters?: Array<{
      name: string;
      userDescription: string;
      visualDescription?: string;
    }>;
    previousEvents?: Array<{ title: string; description: string }>;
  }
): Promise<VideoAnalysisResult> {
  await ensureGeminiAllowed();
  console.log(`🎬 Generating wiki for event ${eventData.eventId}`);
  console.log(`📝 Characters provided: ${eventData.characters?.length || 0}`);
  if (eventData.characters && eventData.characters.length > 0) {
    console.log(`👥 Character names: ${eventData.characters.map((c) => c.name).join(', ')}`);
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  // Build context from characters
  let characterContext = '';
  const characterNames: string[] = [];
  if (eventData.characters && eventData.characters.length > 0) {
    characterContext = '\n\nCHARACTERS IN THIS SCENE:\n';
    eventData.characters.forEach((char) => {
      characterNames.push(char.name);
      characterContext += `- **${sanitizeForPrompt(char.name)}**: ${sanitizeForPrompt(char.userDescription)}`;
      if (char.visualDescription) {
        characterContext += `\n  Visual appearance: ${sanitizeForPrompt(char.visualDescription)}`;
      }
      characterContext += '\n';
    });
  }

  // Build context from previous events
  let context = '';
  if (eventData.previousEvents && eventData.previousEvents.length > 0) {
    context = '\n\nPREVIOUS EVENTS IN THIS TIMELINE:\n';
    eventData.previousEvents.forEach((evt, idx) => {
      context += `${idx + 1}. ${sanitizeForPrompt(evt.title)}: ${sanitizeForPrompt(evt.description)}\n`;
    });
  }

  // Create prompt focused on factual observation
  const prompt = `You are analyzing a video to extract factual information for a story wiki.

EVENT CONTEXT:
Event ID: ${eventData.eventId}
User Description: ${sanitizeForPrompt(eventData.description)}
${characterContext}${context}

YOUR TASK:
1. Watch the video carefully
2. Identify what is actually visible and happening
3. Extract key elements (people, objects, actions, setting)
4. Describe events factually without adding fictional details
${eventData.characters && eventData.characters.length > 0 ? `5. Use the provided character names and descriptions to identify characters in the video` : ''}

CRITICAL RULES:
- Describe ONLY what you see in the video
- Do NOT invent objects, dialogue, or actions not visible
- Do NOT add dramatic interpretations unless clearly shown
${
  eventData.characters && eventData.characters.length > 0
    ? `- **IMPORTANT**: The following characters are in this scene: ${characterNames.join(', ')}. When you recognize these characters in the video based on their descriptions, you MUST use their exact names (e.g., "${eventData.characters[0]?.name}"). Do NOT use generic terms like "elf", "wizard", "man", "woman" - always use the specific character names provided.`
    : '- Identify characters/subjects based on what\'s visible (e.g., "person in red shirt", "eagle", "car")'
}
- Focus on observable actions and events
${eventData.characters && eventData.characters.length > 0 ? '- In the "elements" array, the "name" field should use the provided character names when describing those characters' : ''}

Generate a JSON response:
{
  "title": "Descriptive title based on main action",
  "summary": "1-2 sentence factual summary of video content",
  "videoAnalysis": {
    "setting": "Visible environment (terrain, location, time of day, weather)",
    "visualStyle": "Camera work (handheld, aerial, static, etc.) and video quality",
    "subjects": "Who/what appears in the video",
    "action": "What happens in the video, chronologically"
  },
  "plot": "2-3 paragraphs describing the sequence of events visible in the video. Use present tense. Be factual.",
  "elements": [
    {
      "name": "Subject name (person, animal, object)",
      "description": "Observable characteristics",
      "actions": ["visible action 1", "visible action 2"]
    }
  ],
  "keyMoments": [
    "Moment 1: specific visible event",
    "Moment 2: specific visible event",
    "Moment 3: specific visible event"
  ],
  "duration": "Approximate video length",
  "visualDetails": ["notable visual detail 1", "notable visual detail 2"]
}

Output valid JSON only. Be precise and factual.`;

  try {
    // SSRF validation before downloading external URL
    await validateUploadUrl(videoUrl);
    // Download video to buffer first (required for uploadFile)
    console.log(`📤 Downloading video: ${videoUrl}`);
    const videoController = new AbortController();
    const videoTimeoutId = setTimeout(() => videoController.abort(), 60_000);
    let videoResponse: Response;
    try {
      videoResponse = await fetch(videoUrl, {
        signal: videoController.signal,
        redirect: 'error',
      });
    } finally {
      clearTimeout(videoTimeoutId);
    }
    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.statusText}`);
    }
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    console.log(`✅ Downloaded ${videoBuffer.length} bytes`);

    // Upload video file to Gemini
    console.log(`📤 Uploading video to Gemini...`);
    const uploadResult = await fileManager.uploadFile(videoBuffer, {
      mimeType: 'video/mp4',
      displayName: `event-${eventData.eventId}.mp4`,
    });

    // Wait for video to be processed (with timeout)
    let file = uploadResult.file;
    const processingDeadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
    while (file.state === 'PROCESSING') {
      if (Date.now() > processingDeadline) {
        throw new Error('Video processing timed out after 5 minutes');
      }
      console.log('⏳ Video processing...');
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(file.name);
    }

    if (file.state === 'FAILED') {
      throw new Error('Video processing failed');
    }

    console.log('✅ Video ready, analyzing...');

    // Generate content
    const result = await model.generateContent([
      {
        fileData: {
          mimeType: file.mimeType,
          fileUri: file.uri,
        },
      },
      { text: prompt },
    ]);

    const response = result.response;
    const text = response.text();

    const wikiData = safeJsonParse<WikiData>(text, 'wiki');

    // Map character IDs to elements by matching character names (case-insensitive)
    if (eventData.characters && eventData.characterIds && eventData.characters.length > 0) {
      console.log('🔍 Matching elements to characters:');
      console.log(`   Elements found: ${wikiData.elements.map((e) => e.name).join(', ')}`);
      console.log(`   Characters available: ${eventData.characters.map((c) => c.name).join(', ')}`);

      wikiData.elements = wikiData.elements.map((element) => {
        // Find matching character by name (case-insensitive)
        const characterIndex = eventData.characters!.findIndex(
          (char) => char.name.toLowerCase().trim() === element.name.toLowerCase().trim()
        );

        if (characterIndex !== -1 && eventData.characterIds![characterIndex]) {
          console.log(
            `   ✅ Matched "${element.name}" to character ID: ${eventData.characterIds![characterIndex]}`
          );
          return {
            ...element,
            characterId: eventData.characterIds![characterIndex],
          };
        } else {
          console.log(`   ❌ No match for "${element.name}"`);
        }

        return element;
      });

      console.log(
        `🔗 Mapped character IDs to ${wikiData.elements.filter((e) => e.characterId).length} elements`
      );
    }

    // Calculate costs
    const usage = response.usageMetadata;
    if (!usage) {
      throw new Error('No usage metadata returned');
    }

    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const tokensUsed = usage.totalTokenCount || inputTokens + outputTokens;

    // Gemini 2.5 Pro pricing: $1.25/1M input, $10/1M output
    const inputCost = (inputTokens / 1_000_000) * 1.25;
    const outputCost = (outputTokens / 1_000_000) * 10.0;
    const costUsd = inputCost + outputCost;

    console.log(`✅ Wiki generated!`);
    console.log(`📊 Tokens: ${tokensUsed} (in: ${inputTokens}, out: ${outputTokens})`);
    console.log(`💰 Cost: $${costUsd.toFixed(6)}`);

    await recordProviderCost({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      kind: 'vlm',
      costUsd,
      inputTokens,
      outputTokens,
      tokensUsed,
      extra: { label: 'wiki-from-video', eventId: eventData.eventId },
    });

    return {
      wikiData,
      metadata: {
        tokensUsed,
        inputTokens,
        outputTokens,
        costUsd,
        generatedBy: 'gemini-2.5-pro',
      },
    };
  } catch (error) {
    console.error('❌ Wiki generation failed:', error);
    throw error;
  }
}

/**
 * Analyze character image to generate detailed visual description
 */
export async function analyzeCharacterImage(
  imageUrl: string,
  userDescription: string,
  characterName: string
): Promise<string> {
  await ensureGeminiAllowed();
  console.log(`🎨 Analyzing character image for: ${characterName}`);

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `You are analyzing a character image to create a detailed visual description for narrative consistency.

CHARACTER NAME: ${sanitizeForPrompt(characterName)}
USER DESCRIPTION: ${sanitizeForPrompt(userDescription)}

YOUR TASK:
Analyze this character image and provide a detailed visual description that will help maintain consistency when this character appears in different scenes.

FOCUS ON:
1. Physical appearance (hair color/style, eye color, facial features, skin tone, body type)
2. Clothing and accessories (colors, style, distinctive items)
3. Distinctive features or markings (scars, tattoos, jewelry, props)
4. Pose and expression in this image
5. Art style characteristics (realistic, anime, stylized, etc.)

CRITICAL RULES:
- Be specific and precise (e.g., "shoulder-length brown hair" not "dark hair")
- Focus on visual details that are consistent across scenes
- Include colors, patterns, and textures
- Describe distinctive features that make this character recognizable
- Keep it concise but informative (3-5 sentences)
- Use present tense
- No dramatic interpretation, just visual facts

Generate a detailed visual description in plain text (no JSON, no formatting).`;

  try {
    // SSRF validation before downloading external URL
    await validateUploadUrl(imageUrl);
    // Download image with timeout
    const imgController = new AbortController();
    const imgTimeoutId = setTimeout(() => imgController.abort(), 60_000);
    let imageBase64: string;
    try {
      const imgResponse = await fetch(imageUrl, {
        signal: imgController.signal,
        redirect: 'error',
      });
      imageBase64 = Buffer.from(await imgResponse.arrayBuffer()).toString('base64');
    } finally {
      clearTimeout(imgTimeoutId);
    }
    // Generate content with image
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'image/png',
          data: imageBase64,
        },
      },
      { text: prompt },
    ]);

    const response = result.response;
    const description = response.text().trim();

    // Calculate costs
    const usage = response.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    const outputTokens = usage?.candidatesTokenCount || 0;
    const costUsd = (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 10.0;

    console.log(`✅ Character analysis complete!`);
    console.log(
      `📊 Tokens: ${inputTokens + outputTokens} (in: ${inputTokens}, out: ${outputTokens})`
    );
    console.log(`💰 Cost: $${costUsd.toFixed(6)}`);

    await recordProviderCost({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      kind: 'vlm',
      costUsd,
      inputTokens,
      outputTokens,
      extra: { label: 'character-image-analysis', characterName },
    });

    return description;
  } catch (error) {
    console.error('❌ Character analysis failed:', error);
    throw error;
  }
}

/**
 * Improve image prompt with detailed visual description
 */
export async function improveImagePrompt(
  userPrompt: string,
  characterContext?: Array<{ name: string; description: string }>
): Promise<string> {
  // Pure-text prompt rewriting — route to cheapest standard-tier chat model
  // (dispatchLlm handles cost tracking + admin kill-switch). Big win vs
  // legacy Gemini Pro path (~$1.25/Mtok in → ~$0.05/Mtok in).
  console.log(`🎨 Improving image prompt via router...`);

  let characterInfo = '';
  if (characterContext && characterContext.length > 0) {
    characterInfo = '\n\nCHARACTERS IN THIS SCENE:\n';
    characterContext.forEach((char) => {
      characterInfo += `- ${sanitizeForPrompt(char.name, 200)}: ${sanitizeForPrompt(char.description, 2000)}\n`;
    });
  }

  const prompt = `You are a professional visual artist and image generation expert. Your task is to take a simple image description and transform it into a detailed, single-frame visual description perfect for image generation.

USER'S BASIC IDEA:
${sanitizeForPrompt(userPrompt)}
${characterInfo}

YOUR TASK:
Transform this into a detailed single-frame description. Include:
- Camera angle and framing (e.g., "medium shot", "close-up", "wide shot", "aerial view")
- Character positions, poses, and expressions
- Lighting (e.g., "soft golden hour light", "dramatic side lighting", "moonlight")
- Setting and environment details
- Mood and atmosphere
- Colors and visual style
- Specific details that make the scene vivid

EXAMPLE:
Medium shot of a king standing on an ancient stone bridge, looking down pensively at the sparkling water below. Golden hour sunlight casts warm amber tones across the weathered stones. In the water, a queen wearing an elegant royal swimming suit with a golden crown relaxes on a pink inflatable swan, her face lit with a joyful smile as she waves up at him. The scene has a whimsical, dreamlike quality with rich colors and soft focus in the background.

RULES:
- Describe a SINGLE moment, not a sequence
- Be specific about composition and framing
- Include atmospheric and lighting details
- Use vivid, descriptive language
- Mention colors, textures, and mood
${characterContext ? '- Use the provided character names and descriptions' : ''}
- Keep it as one cohesive paragraph (2-4 sentences)
- Output ONLY the description, no explanations or extra text
- Do NOT use markdown formatting or code blocks

Generate the improved image prompt now:`;

  try {
    const decision = routeLlmModel({
      requires: { chat: true },
      qualityTarget: 'standard',
      costBudget: 'low',
    });
    const r = await dispatchLlmWithFallback({
      primaryModelId: decision.chosenModelId,
      fallbackModelIds: decision.fallbackModelIds.slice(0, 3),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1500,
    });
    let cleanPrompt = r.text.trim();
    if (cleanPrompt.startsWith('```')) {
      cleanPrompt = cleanPrompt.split('```')[1]?.trim() ?? cleanPrompt;
    }
    return cleanPrompt;
  } catch (error) {
    console.error('❌ Image prompt improvement failed:', error);
    throw error;
  }
}

/**
 * Improve video prompt with cinematic cuts and shot descriptions
 */
export async function improveVideoPrompt(
  userPrompt: string,
  characterContext?: Array<{ name: string; description: string }>,
  previousEventContext?: {
    title: string;
    summary: string;
    plot?: string;
  }
): Promise<string> {
  // Pure-text shot-list rewriting — route to cheapest standard-tier chat
  // model (dispatchLlm handles cost + kill-switch).
  console.log(`🎬 Improving video prompt via router...`);

  let characterInfo = '';
  if (characterContext && characterContext.length > 0) {
    characterInfo = '\n\nCHARACTERS IN THIS SCENE:\n';
    characterContext.forEach((char) => {
      characterInfo += `- ${sanitizeForPrompt(char.name, 200)}: ${sanitizeForPrompt(char.description, 2000)}\n`;
    });
  }

  let previousEventInfo = '';
  if (previousEventContext) {
    previousEventInfo = `\n\nPREVIOUS EVENT CONTEXT:\n`;
    previousEventInfo += `Title: ${sanitizeForPrompt(previousEventContext.title, 500)}\n`;
    previousEventInfo += `Summary: ${sanitizeForPrompt(previousEventContext.summary, 2000)}\n`;
    if (previousEventContext.plot) {
      previousEventInfo += `What happened: ${sanitizeForPrompt(previousEventContext.plot, 2000)}\n`;
    }
    previousEventInfo += `\nNote: This new scene should continue naturally from the previous event.\n`;
  }

  const prompt = `You are a professional cinematographer and video director. Your task is to take a simple video description and transform it into a detailed shot-by-shot sequence with professional camera angles and cuts.

USER'S BASIC IDEA:
${sanitizeForPrompt(userPrompt)}
${characterInfo}${previousEventInfo}

YOUR TASK:
Transform this into a cinematic sequence with multiple shots/cuts. Use the format:
- Each shot on a new line
- Use [cut] to separate different shots
- Include camera angles (e.g., "close up", "wide shot", "over the shoulder", "aerial view", "POV")
- Be specific about what's happening in each shot
- Keep it concise but descriptive
- Use 3-6 shots total
- Make it feel like a professional video sequence

EXAMPLE FORMAT:
Wide shot - a king standing on a stone bridge, looking down at the water below

[cut] Over the shoulder shot - from behind the king - a queen in a royal swimming suit with a golden crown is relaxing on a pink inflatable swan in the sparkling water

[cut] Close up shot of the queen's smiling face as she waves enthusiastically at the king

[cut] Medium shot - the king takes a deep breath and leaps off the bridge into the water with a splash

RULES:
- Use cinematic language (wide shot, close up, medium shot, tracking shot, etc.)
- Create visual flow between shots
- Build narrative tension or emotion
- Be specific about actions and details
${characterContext ? '- Use the provided character names and descriptions' : ''}
- Output ONLY the shot sequence, no explanations or extra text
- Do NOT use markdown formatting or code blocks

Generate the improved prompt now:`;

  try {
    const decision = routeLlmModel({
      requires: { chat: true },
      qualityTarget: 'standard',
      costBudget: 'low',
    });
    const r = await dispatchLlmWithFallback({
      primaryModelId: decision.chosenModelId,
      fallbackModelIds: decision.fallbackModelIds.slice(0, 3),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
    });
    let cleanPrompt = r.text.trim();
    if (cleanPrompt.startsWith('```')) {
      cleanPrompt = cleanPrompt.split('```')[1]?.trim() ?? cleanPrompt;
    }
    return cleanPrompt;
  } catch (error) {
    console.error('❌ Prompt improvement failed:', error);
    throw error;
  }
}

/**
 * Generate a lore / wiki card for any entity type.
 * Used by the Studio orchestrator for the lore_card capability.
 */
export async function generateEntityLore(
  entityName: string,
  entityKind: string,
  description: string
): Promise<string> {
  await ensureGeminiAllowed();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are a worldbuilding writer creating a concise wiki/lore card entry.

ENTITY NAME: ${sanitizeForPrompt(entityName)}
ENTITY KIND: ${sanitizeForPrompt(entityKind)}
DESCRIPTION: ${sanitizeForPrompt(description)}

Write a compelling 2–4 paragraph wiki entry for this ${entityKind}. Include:
- What it is / who they are
- Key traits, abilities, or notable characteristics
- Role in the world / narrative significance
- One memorable detail or hook

Write in a neutral encyclopedic tone. No headers, no lists — flowing paragraphs only.`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text();
  if (!text) throw new Error('Gemini returned empty lore card');
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
  await recordProviderCost({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    kind: 'llm',
    costUsd,
    inputTokens,
    outputTokens,
    extra: { label: 'entity-lore-card', entityKind },
  });
  return text;
}

/** Metadata field definitions per entity kind — mirrors the frontend create form. */
const METADATA_FIELDS_BY_KIND: Record<string, string[]> = {
  person: ['role', 'appearance', 'motivations', 'abilities', 'homePlace', 'affiliations'],
  place: ['placeType', 'atmosphere', 'rulesAndDangers', 'inhabitants', 'governingFaction'],
  thing: ['thingType', 'origin', 'powersAndUse', 'rarity', 'currentOwner'],
  faction: ['mission', 'ideology', 'leader', 'rivals', 'hq', 'resources'],
  event: ['era', 'participants', 'location', 'causes', 'outcome', 'canonStatus'],
  lore: ['loreType', 'article', 'relatedConcepts', 'canonWeight'],
  species: ['biologicalType', 'traits', 'homeworld', 'culture', 'abilities'],
  vehicle: ['vehicleType', 'crew', 'capabilities', 'origin', 'currentStatus'],
  technology: ['techType', 'inventor', 'howItWorks', 'limitations', 'users'],
  organization: ['orgType', 'purpose', 'structure', 'members', 'influence'],
};

/**
 * Generate a full entity profile: description + kind-specific metadata fields.
 * Returns structured JSON that can be directly applied to an entity.
 */
export async function generateEntityProfile(
  entityName: string,
  entityKind: string,
  userHint: string
): Promise<{ description: string; metadata: Record<string, string> }> {
  await ensureGeminiAllowed();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const fields = METADATA_FIELDS_BY_KIND[entityKind] ?? [];

  const fieldsInstruction =
    fields.length > 0
      ? `\nFill in the following metadata fields (use short, punchy text — 1-3 sentences max per field):\n${fields.map((f) => `- "${f}"`).join('\n')}`
      : '';

  const prompt = `You are a worldbuilding AI creating a detailed profile for a fictional ${entityKind}.

ENTITY NAME: ${sanitizeForPrompt(entityName, 200)}
USER HINT: ${sanitizeForPrompt(userHint || '(no additional context)', 1000)}

YOUR TASK:
1. Write a compelling 2–4 paragraph "description" for this ${entityKind}. Encyclopedic tone, no headers, no lists — flowing paragraphs only.
2. ${fieldsInstruction || 'No additional metadata fields needed.'}

Respond with a JSON object:
{
  "description": "...",
  "metadata": {
    ${fields.map((f) => `"${f}": "..."`).join(',\n    ')}
  }
}

RULES:
- Be creative but grounded — make the entity feel like it belongs in a rich universe.
- Each metadata field should be concise (1-3 sentences) but evocative.
- The description should be longer (2-4 paragraphs) and read like a wiki entry.
- Output valid JSON only. No markdown fences.`;

  const result = await model.generateContent(prompt);
  const response = result.response;
  const text = response.text().trim();
  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const costUsd = (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.3;
  await recordProviderCost({
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    kind: 'llm',
    costUsd,
    inputTokens,
    outputTokens,
    extra: { label: 'entity-profile', entityKind },
  });

  const parsed = safeJsonParse<{ description?: string; metadata?: Record<string, any> }>(
    text,
    'entity profile'
  );
  if (!parsed.description || typeof parsed.description !== 'string') {
    throw new Error('AI returned invalid profile — missing description');
  }

  return {
    description: parsed.description,
    metadata: parsed.metadata ?? {},
  };
}

// ── Raw-fetch BYOK adapters (generic chat / Veo video / Lyria music) ───
//
// The SDK-bound helpers above bake the env key at module init, which is
// fine for the wiki / lore generators. For the model-matrix dispatchers
// we need per-call BYOK — the surfaces below speak the REST API directly
// so a caller can pass any user-supplied key.

const GEMINI_REST = 'https://generativelanguage.googleapis.com/v1beta';

function resolveGeminiKey(apiKey?: string): string {
  const key = apiKey ?? GOOGLE_API_KEY;
  if (!key) {
    throw new Error('Google API key missing — set GOOGLE_API_KEY or pass apiKey for BYOK');
  }
  return key;
}

export interface GeminiChatPart {
  type: 'text' | 'image_url';
  text?: string;
  imageUrl?: string;
}

export interface GeminiChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain text or parts (text + inline image URLs). */
  content: string | GeminiChatPart[];
}

export interface GeminiChatOptions {
  apiKey?: string;
  /** Gemini API model parameter, e.g. 'gemini-3.1-pro-preview'. */
  model: string;
  messages: GeminiChatMessage[];
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  /** Force JSON-only output. */
  jsonMode?: boolean;
  /** Structured response schema (Gemini-flavoured JSON Schema). */
  responseSchema?: Record<string, unknown>;
}

export interface GeminiChatResult {
  text: string;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
}

function extractGeminiText(parts: GeminiChatPart[]): string {
  return parts
    .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Generic chat completion via Gemini API. Maps OpenAI-style messages to
 * Gemini's `contents` shape (with `system_instruction` extracted).
 */
export async function geminiChat(opts: GeminiChatOptions): Promise<GeminiChatResult> {
  const apiKey = resolveGeminiKey(opts.apiKey);

  type GeminiPart = { text?: string; inline_data?: { mime_type: string; data: string } };
  type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const m of opts.messages) {
    if (m.role === 'system') {
      systemTexts.push(typeof m.content === 'string' ? m.content : extractGeminiText(m.content));
      continue;
    }
    const role: GeminiContent['role'] = m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      contents.push({ role, parts: [{ text: m.content }] });
      continue;
    }
    const parts: GeminiPart[] = [];
    for (const p of m.content) {
      if (p.type === 'text' && p.text) parts.push({ text: p.text });
      if (p.type === 'image_url' && p.imageUrl) {
        // SSRF guard: reject internal/private/blocked hosts before fetching.
        await validateUploadUrl(p.imageUrl);
        const fetched = await fetch(p.imageUrl, { signal: AbortSignal.timeout(20_000) });
        if (!fetched.ok) throw new Error(`Failed to fetch image: ${fetched.status}`);
        const mime = fetched.headers.get('content-type') ?? 'image/png';
        const buf = Buffer.from(await fetched.arrayBuffer());
        parts.push({ inline_data: { mime_type: mime, data: buf.toString('base64') } });
      }
    }
    if (parts.length > 0) contents.push({ role, parts });
  }

  const body: Record<string, unknown> = { contents };
  if (systemTexts.length > 0) {
    body.system_instruction = { parts: [{ text: systemTexts.join('\n\n') }] };
  }
  const generationConfig: Record<string, unknown> = {};
  if (opts.temperature != null) generationConfig.temperature = opts.temperature;
  if (opts.topP != null) generationConfig.topP = opts.topP;
  if (opts.maxOutputTokens != null) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.jsonMode) generationConfig.responseMimeType = 'application/json';
  if (opts.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = opts.responseSchema;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  const res = await fetch(
    `${GEMINI_REST}/models/${encodeURIComponent(opts.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini chat ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
  }
  interface GeminiResp {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: {
      blockReason?: string;
      safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
    };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }
  const data = (await res.json()) as GeminiResp;
  // Gemini frequently returns HTTP 200 with promptFeedback.blockReason and
  // no candidates (safety / recitation / PII filters). Surface as an actionable
  // error rather than letting the caller see an empty `text` and assume success.
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  }
  const finishReason = data.candidates?.[0]?.finishReason;
  if (
    finishReason &&
    finishReason !== 'STOP' &&
    finishReason !== 'MAX_TOKENS' &&
    finishReason !== 'TOOL_CALLS' &&
    finishReason !== 'FINISH_REASON_STOP'
  ) {
    throw new Error(
      `Gemini returned no usable text (finishReason=${finishReason}) — safety, recitation, or another non-completion stop.`
    );
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  return {
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
      totalTokens: data.usageMetadata?.totalTokenCount,
    },
    finishReason,
  };
}

// ── Veo (video) — predictLongRunning + polling ──────────────────────────

export interface VeoGenerateOptions {
  apiKey?: string;
  /** e.g. 'veo-3.1-generate-preview', 'veo-3.0-generate-001'. */
  model: string;
  prompt: string;
  /** For image-to-video: a public URL the API will fetch. */
  imageUrl?: string;
  /** 4–8 seconds (Veo cap). */
  durationSec?: number;
  /** '720p' | '1080p' | '4k'. 4K is preview-only, only for 8s clips. */
  resolution?: '720p' | '1080p' | '4k';
  aspectRatio?: '16:9' | '9:16';
  /** Generate native audio (3.x only). */
  withAudio?: boolean;
  /** Optional cancellation — propagates to both the create fetch and poll loop. */
  signal?: AbortSignal;
}

export interface VeoTask {
  /** Operation name from the LRO endpoint (`operations/...`). */
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
  model: string;
}

export async function veoCreate(opts: VeoGenerateOptions): Promise<VeoTask> {
  const apiKey = resolveGeminiKey(opts.apiKey);
  const instance: Record<string, unknown> = { prompt: opts.prompt };
  // Veo on the Gemini API surface (generativelanguage.googleapis.com) only
  // reliably accepts `bytesBase64Encoded`; the `gcsUri` variant is Vertex-only
  // and 400s on AI-Studio-allow-listed keys. Convert https:// URLs to b64.
  if (opts.imageUrl) {
    if (opts.imageUrl.startsWith('gs://')) {
      instance.image = { gcsUri: opts.imageUrl };
    } else {
      // SSRF guard: validate before server-side fetch.
      await validateUploadUrl(opts.imageUrl);
      const fetched = await fetch(opts.imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!fetched.ok) {
        throw new Error(`Veo: failed to fetch source image (${fetched.status})`);
      }
      const mime = fetched.headers.get('content-type') ?? 'image/png';
      const buf = Buffer.from(await fetched.arrayBuffer());
      instance.image = { bytesBase64Encoded: buf.toString('base64'), mimeType: mime };
    }
  }
  const parameters: Record<string, unknown> = {
    durationSeconds: opts.durationSec ?? 8,
    aspectRatio: opts.aspectRatio ?? '16:9',
    resolution: opts.resolution ?? '720p',
  };
  if (opts.withAudio != null) parameters.generateAudio = opts.withAudio;

  const body = { instances: [instance], parameters };
  const res = await fetch(
    `${GEMINI_REST}/models/${encodeURIComponent(opts.model)}:predictLongRunning`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Veo create ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
  }
  interface VeoCreateResp {
    name: string;
    done?: boolean;
    error?: { message?: string };
  }
  const data = (await res.json()) as VeoCreateResp;
  return {
    name: data.name,
    status: data.done ? 'completed' : 'in_progress',
    error: data.error?.message,
    model: opts.model,
  };
}

export async function veoPoll(
  operationName: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<VeoTask> {
  const key = resolveGeminiKey(apiKey);
  // Compose caller-supplied signal with our per-call 30s timeout so a
  // cancelled tRPC request aborts the in-flight poll fetch immediately.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Veo poll timeout')), 30_000);
  const onCallerAbort = () => ac.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }
  let res: Response;
  try {
    res = await fetch(`${GEMINI_REST}/${operationName}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': key },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Veo poll ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
  }
  interface VeoPollResp {
    name: string;
    done?: boolean;
    error?: { message?: string };
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string } }>;
      };
    };
  }
  const data = (await res.json()) as VeoPollResp;
  if (data.error) {
    return {
      name: data.name,
      status: 'failed',
      error: data.error.message,
      model: '',
    };
  }
  if (data.done) {
    const videoUrl = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    return {
      name: data.name,
      status: 'completed',
      videoUrl,
      model: '',
    };
  }
  return { name: data.name, status: 'in_progress', model: '' };
}

/** Convenience: create + poll up to ~10 minutes. */
export async function veoGenerate(
  opts: VeoGenerateOptions
): Promise<{ status: string; videoUrl?: string; error?: string; name?: string }> {
  const task = await veoCreate(opts);
  if (task.status === 'failed' || task.status === 'completed') {
    return { status: task.status, videoUrl: task.videoUrl, error: task.error, name: task.name };
  }
  const { abortableSleep } = await import('../lib/abortable-sleep');
  const maxAttempts = 60;
  const intervalMs = 10_000;
  let current = task;
  for (let i = 0; i < maxAttempts; i++) {
    if (current.status === 'completed' || current.status === 'failed') break;
    await abortableSleep(intervalMs, opts.signal);
    current = await veoPoll(task.name, opts.apiKey, opts.signal);
  }
  // If still in-progress after the wall budget, treat as failed so callers
  // don't persist an empty videoUrl as "completed".
  if (current.status !== 'completed' && current.status !== 'failed') {
    return {
      status: 'failed',
      videoUrl: undefined,
      error: `Veo polling timed out after ${(maxAttempts * intervalMs) / 1000}s`,
      name: current.name,
    };
  }
  return {
    status: current.status,
    videoUrl: current.videoUrl,
    error: current.error,
    name: current.name,
  };
}

// ── Lyria (music) — predict endpoint ────────────────────────────────────

export interface LyriaGenerateOptions {
  apiKey?: string;
  /** 'lyria-3-clip-preview' (30s clip) or 'lyria-3-pro-preview' (~2-min song). */
  model: string;
  prompt: string;
  /** Optional negative-style prompt. */
  negativePrompt?: string;
  /** Generation seed. */
  seed?: number;
}

export interface LyriaResult {
  audioBuffer: Buffer;
  contentType: string;
  model: string;
}

export async function lyriaGenerate(opts: LyriaGenerateOptions): Promise<LyriaResult> {
  const apiKey = resolveGeminiKey(opts.apiKey);
  const instance: Record<string, unknown> = { prompt: opts.prompt };
  if (opts.negativePrompt) instance.negative_prompt = opts.negativePrompt;
  if (opts.seed != null) instance.seed = opts.seed;
  const body = { instances: [instance] };
  const res = await fetch(`${GEMINI_REST}/models/${encodeURIComponent(opts.model)}:predict`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Lyria predict ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
  }
  // Lyria's documented response field is `audioContent` (base64), not
  // `bytesBase64Encoded`. Some preview versions also return the older
  // name — accept either.
  interface LyriaResp {
    predictions?: Array<{
      audioContent?: string;
      bytesBase64Encoded?: string;
      mimeType?: string;
    }>;
  }
  const data = (await res.json()) as LyriaResp;
  const pred = data.predictions?.[0];
  const audioB64 = pred?.audioContent ?? pred?.bytesBase64Encoded;
  if (!audioB64) {
    throw new Error('Lyria returned no audio payload');
  }
  return {
    audioBuffer: Buffer.from(audioB64, 'base64'),
    // Lyria typically returns 48 kHz WAV — default to wav when unset.
    contentType: pred?.mimeType ?? 'audio/wav',
    model: opts.model,
  };
}

// ── Ad Reference Decomposition ───────────────────────────────────────
//
// Takes a viral-ad video URL and returns a structured "recipe" — hook,
// shot list, style cues, pacing — that the Marketing Studio Ad Reference
// recreator uses to remix the ad with the caller's own product/IP.

export interface AdDecompositionBeat {
  /** What happens in this shot (factual, observed). */
  description: string;
  /** Approximate seconds the beat occupies. */
  durationEstimateSec: number;
  /** Camera move observed (free-form — we don't try to force preset IDs). */
  cameraMove: string;
  /** Framing observed (CU / MS / WS / OTS / POV…). */
  framing: string;
}

export interface AdDecomposition {
  /** First 1–2 seconds — the scroll-stop moment. */
  hookDescription: string;
  /** Ordered shot list. */
  beats: AdDecompositionBeat[];
  /** Style / lighting / color descriptors. */
  styleCues: string[];
  /** Dominant palette as free-form color names. */
  palette: string[];
  /** '9:16' | '1:1' | '16:9' | '4:5' inferred from the source. */
  aspectRatio: string;
  /** 'fast' | 'medium' | 'slow' pacing assessment. */
  pacing: string;
  /** One-line mood/vibe summary. */
  mood: string;
  /** Total runtime in seconds (clipped to 30s ceiling for context economy). */
  totalDurationSec: number;
}

export async function decomposeAdVideo(videoUrl: string): Promise<AdDecomposition> {
  await ensureGeminiAllowed();
  await validateUploadUrl(videoUrl);

  // Download video bytes — same pattern as generateWikiFromVideo above.
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), 60_000);
  let videoResponse: Response;
  try {
    videoResponse = await fetch(videoUrl, { signal: ctl.signal, redirect: 'error' });
  } finally {
    clearTimeout(tid);
  }
  if (!videoResponse.ok) {
    throw new Error(`Failed to download reference video: ${videoResponse.statusText}`);
  }
  const buffer = Buffer.from(await videoResponse.arrayBuffer());

  // Gemini's free-tier file limit is 2GB, but ads are <10MB. Guardrail.
  if (buffer.length > 50 * 1024 * 1024) {
    throw new Error(`Reference video too large (${buffer.length} bytes; max 50MB)`);
  }

  const uploaded = await fileManager.uploadFile(buffer, {
    mimeType: 'video/mp4',
    displayName: `ad-ref-${Date.now()}.mp4`,
  });

  // Wait for Gemini to finish processing the file.
  let file = uploaded.file;
  const deadline = Date.now() + FILE_PROCESSING_TIMEOUT_MS;
  while (file.state === 'PROCESSING') {
    if (Date.now() > deadline) throw new Error('Reference video processing timed out');
    await new Promise((r) => setTimeout(r, 2000));
    file = await fileManager.getFile(file.name);
  }
  if (file.state === 'FAILED') throw new Error('Reference video processing failed');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `You are reverse-engineering a viral advertising video so it can be RECREATED with a different product. Watch the video carefully and produce a structured shot list.

CRITICAL RULES:
- Describe ONLY what you observe. No invented details.
- Identify each visual beat as a distinct shot if the framing or camera move changes.
- Camera move = free-form ("slow push", "whip pan left", "static handheld"). Don't try to use preset names.
- Framing = standard cinematography labels (ECU, CU, MCU, MS, WS, EWS, OTS, POV, low angle, high angle, bird's eye).
- Pacing must be one of: "fast" | "medium" | "slow".
- Aspect ratio must be one of: "9:16" | "1:1" | "16:9" | "4:5".

Return strict JSON with this exact shape (no markdown fences, no commentary):
{
  "hookDescription": "what the viewer sees in the first 1-2 seconds — the scroll-stop moment",
  "beats": [
    { "description": "factual shot description", "durationEstimateSec": 2, "cameraMove": "slow push", "framing": "MCU" }
  ],
  "styleCues": ["warm tungsten lighting", "shallow depth of field", "anamorphic flare"],
  "palette": ["amber", "deep teal", "ivory"],
  "aspectRatio": "9:16",
  "pacing": "medium",
  "mood": "premium quiet luxury",
  "totalDurationSec": 8
}`;

  const result = await model.generateContent([
    { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
    { text: prompt },
  ]);
  const text = result.response.text();

  let parsed: AdDecomposition;
  try {
    // Strip any accidental code fences.
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    parsed = JSON.parse(cleaned) as AdDecomposition;
  } catch (err) {
    throw new Error(`Gemini returned non-JSON for ad decomposition: ${text.slice(0, 200)}`);
  }

  // Defensive: ensure the required arrays exist so downstream UI doesn't crash.
  parsed.beats = Array.isArray(parsed.beats) ? parsed.beats : [];
  parsed.styleCues = Array.isArray(parsed.styleCues) ? parsed.styleCues : [];
  parsed.palette = Array.isArray(parsed.palette) ? parsed.palette : [];

  // Clean up the uploaded file — best-effort.
  fileManager.deleteFile(file.name).catch(() => {});

  return parsed;
}

export const geminiService = {
  generateWikiFromVideo,
  analyzeCharacterImage,
  improveImagePrompt,
  improveVideoPrompt,
  generateEntityLore,
  generateEntityProfile,
  decomposeAdVideo,
  chat: geminiChat,
  veoCreate,
  veoPoll,
  veoGenerate,
  lyriaGenerate,
};
