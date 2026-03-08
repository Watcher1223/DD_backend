// ═══════════════════════════════════════════════
// V2V PIPELINE — Continuous V2V frame processing
// Keeps only the latest frame in memory.
// Targets ~2-5 FPS through Overshoot WS.
// ═══════════════════════════════════════════════

import { transformFrame, isV2VConfigured } from './v2v.js';

const V2V_FRAME_INTERVAL_MS = parseInt(process.env.V2V_FRAME_INTERVAL_MS || '300', 10);

/** Per-campaign pipeline state */
const pipelines = new Map();

/**
 * Start a continuous V2V processing loop for a campaign.
 * Reads the latest camera frame, transforms it via Overshoot, and broadcasts the result.
 * @param {number} campaignId
 * @param {function} broadcastVideoFrame - (frameBase64: string, metadata: object) => void
 * @param {function} getLatestPrompt - () => string — returns current scene prompt
 */
export function startV2VPipeline(campaignId, broadcastVideoFrame, getLatestPrompt) {
  if (!isV2VConfigured()) {
    console.log('[V2V-PIPE] V2V not configured, skipping pipeline start');
    return;
  }

  // Stop existing pipeline if running
  stopV2VPipeline(campaignId);

  const state = {
    running: true,
    latestFrame: null,
    latestPrompt: '',
    broadcastVideoFrame,
    getLatestPrompt,
    frameCount: 0,
  };
  pipelines.set(campaignId, state);

  console.log(`[V2V-PIPE] Started pipeline for campaign ${campaignId}`);

  // Start the processing loop
  processLoop(campaignId);
}

/**
 * Stop the V2V pipeline for a campaign.
 * @param {number} campaignId
 */
export function stopV2VPipeline(campaignId) {
  const state = pipelines.get(campaignId);
  if (state) {
    state.running = false;
    pipelines.delete(campaignId);
    console.log(`[V2V-PIPE] Stopped pipeline for campaign ${campaignId}`);
  }
}

/**
 * Update the latest camera frame for V2V processing.
 * Only the most recent frame is kept (no queue buildup).
 * @param {number} campaignId
 * @param {string} frameBase64 - Base64-encoded JPEG frame
 */
export function updateV2VFrame(campaignId, frameBase64) {
  const state = pipelines.get(campaignId);
  if (state) {
    state.latestFrame = frameBase64;
  }
}

/**
 * Update the current scene prompt for V2V stylization.
 * @param {number} campaignId
 * @param {string} prompt
 */
export function updateV2VPrompt(campaignId, prompt) {
  const state = pipelines.get(campaignId);
  if (state) {
    state.latestPrompt = prompt;
  }
}

/**
 * Internal processing loop. Runs until pipeline is stopped.
 * @param {number} campaignId
 */
async function processLoop(campaignId) {
  const state = pipelines.get(campaignId);
  if (!state || !state.running) return;

  try {
    const frame = state.latestFrame;
    if (frame) {
      // Clear the frame so we don't re-process it
      state.latestFrame = null;

      const prompt = state.latestPrompt || state.getLatestPrompt();

      // Convert base64 data URI to buffer
      const raw = frame.includes(',') ? frame.split(',')[1] : frame;
      const frameBuffer = Buffer.from(raw, 'base64');

      const startTime = Date.now();
      const result = await transformFrame(frameBuffer, prompt);
      const latency = Date.now() - startTime;

      if (result && result.length > 0) {
        const resultBase64 = result.toString('base64');
        state.frameCount++;

        state.broadcastVideoFrame(resultBase64, {
          campaignId,
          frameNumber: state.frameCount,
          latencyMs: latency,
        });
      }
    }
  } catch (err) {
    // Don't crash the loop on individual frame errors
    if (state.frameCount === 0) {
      console.warn(`[V2V-PIPE] Frame error: ${err.message}`);
    }
  }

  // Schedule next iteration
  const currentState = pipelines.get(campaignId);
  if (currentState?.running) {
    setTimeout(() => processLoop(campaignId), V2V_FRAME_INTERVAL_MS);
  }
}
