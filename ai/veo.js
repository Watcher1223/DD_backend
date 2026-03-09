// ═══════════════════════════════════════════════
// VEO 2 — Video generation via @google/genai SDK
// Generates short video clips from scene prompts
// for background playback in the story pipeline.
// ═══════════════════════════════════════════════

import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const VEO_MODEL = process.env.VEO_MODEL || 'veo-2.0-generate-001';
const VEO_DURATION_SECONDS = parseInt(process.env.VEO_DURATION_SECONDS || '5', 10);
const VEO_POLL_INTERVAL_MS = parseInt(process.env.VEO_POLL_INTERVAL_MS || '5000', 10);
const VEO_MAX_WAIT_MS = parseInt(process.env.VEO_MAX_WAIT_MS || '180000', 10);

let client = null;

function getClient() {
  if (!client && GEMINI_API_KEY) {
    client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return client;
}

/**
 * Whether Veo video generation is configured and enabled.
 * Opt-in only: set VEO_ENABLED=true (Veo API can return 400 "Unsupported request" depending on region/model).
 * @returns {boolean}
 */
export function isVeoConfigured() {
  if (process.env.VEO_ENABLED !== 'true') return false;
  return !!GEMINI_API_KEY;
}

/**
 * Generate a short video clip from a scene prompt using Veo 2.
 * @param {string} scenePrompt - Descriptive scene prompt with motion cues
 * @param {string} [referenceImageBase64] - Optional reference image (base64 data URI or raw base64)
 * @param {{ durationSeconds?: number, aspectRatio?: string }} [options]
 * @returns {Promise<{ videoUrl: string, durationSeconds: number, source: 'veo' }>}
 */
export async function generateVideoClip(scenePrompt, referenceImageBase64, options = {}) {
  const ai = getClient();
  if (!ai) {
    throw new Error('Veo not configured: GEMINI_API_KEY is required');
  }

  const durationSeconds = options.durationSeconds || VEO_DURATION_SECONDS;
  const aspectRatio = options.aspectRatio || '16:9';

  console.log(`[VEO] Generating ${durationSeconds}s clip: ${scenePrompt.slice(0, 100)}...`);

  const generateConfig = {
    model: VEO_MODEL,
    contents: scenePrompt,
    config: {
      numberOfVideos: 1,
      durationSeconds,
      aspectRatio,
      personGeneration: 'allow_all',
    },
  };

  // Add reference image if provided
  if (referenceImageBase64) {
    const raw = referenceImageBase64.includes(',')
      ? referenceImageBase64.split(',')[1]
      : referenceImageBase64;
    generateConfig.config.referenceImages = [{
      referenceImage: {
        imageBytes: raw,
        mimeType: 'image/jpeg',
      },
      referenceType: 'STYLE',
    }];
  }

  const operation = await ai.models.generateVideos(generateConfig);

  // Poll until done
  const result = await pollVideoGeneration(operation);
  return result;
}

/**
 * Poll a Veo video generation operation until complete.
 * @param {object} operation - The operation object from generateVideos
 * @returns {Promise<{ videoUrl: string, durationSeconds: number, source: 'veo' }>}
 */
export async function pollVideoGeneration(operation) {
  const ai = getClient();
  if (!ai) throw new Error('Veo client not available');

  const startTime = Date.now();

  while (Date.now() - startTime < VEO_MAX_WAIT_MS) {
    // Check if operation already has results
    if (operation.done) {
      const videos = operation.response?.generatedVideos || operation.generatedVideos || [];
      if (videos.length > 0) {
        const video = videos[0];
        const videoUrl = video.video?.uri || video.uri || '';
        console.log(`[VEO] Video ready: ${videoUrl.slice(0, 80)}`);
        return {
          videoUrl,
          durationSeconds: VEO_DURATION_SECONDS,
          source: 'veo',
        };
      }
      throw new Error('Veo generation completed but no videos returned');
    }

    await sleep(VEO_POLL_INTERVAL_MS);

    // Poll for updated status
    try {
      const updated = await ai.operations.get({ operation: operation.name });
      if (updated.done) {
        operation = updated;
        continue; // Re-enter loop to extract result
      }
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[VEO] Polling... ${elapsed}s elapsed`);
    } catch (err) {
      console.warn(`[VEO] Poll error: ${err.message}`);
    }
  }

  throw new Error(`Veo generation timed out after ${VEO_MAX_WAIT_MS / 1000}s`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
