// ═══════════════════════════════════════════════
// VIDEO QUEUE — Background Veo generation queue
// One job at a time per campaign (Veo rate limits).
// Broadcasts story_video_clip on completion.
// ═══════════════════════════════════════════════

import { generateVideoClip, isVeoConfigured } from '../ai/veo.js';

/** Per-campaign queue state: { pending: Map<beatIndex, job>, completed: Map<beatIndex, clip>, failed: Map<beatIndex, error>, processing: boolean } */
const queues = new Map();

function getQueue(campaignId) {
  if (!queues.has(campaignId)) {
    queues.set(campaignId, {
      pending: new Map(),
      completed: new Map(),
      failed: new Map(),
      processing: false,
    });
  }
  return queues.get(campaignId);
}

/**
 * Enqueue a Veo video generation job for a beat.
 * Runs async — broadcasts story_video_clip via the provided broadcast function on completion.
 * @param {number} campaignId
 * @param {number} beatIndex
 * @param {string} scenePrompt
 * @param {string} [refImage] - Reference image base64
 * @param {function} [broadcast] - Function to broadcast result to WS clients
 */
export function enqueueVideoGeneration(campaignId, beatIndex, scenePrompt, refImage, broadcast) {
  if (!isVeoConfigured()) return;

  const queue = getQueue(campaignId);

  // Skip if already queued or completed for this beat
  if (queue.pending.has(beatIndex) || queue.completed.has(beatIndex)) {
    return;
  }

  const job = { campaignId, beatIndex, scenePrompt, refImage, broadcast, enqueuedAt: Date.now() };
  queue.pending.set(beatIndex, job);
  console.log(`[VEO] Enqueued clip for campaign ${campaignId} beat ${beatIndex}`);

  processQueue(campaignId);
}

/**
 * Process the next job in the queue (one at a time per campaign).
 * @param {number} campaignId
 */
async function processQueue(campaignId) {
  const queue = getQueue(campaignId);
  if (queue.processing) return;

  const nextEntry = queue.pending.entries().next();
  if (nextEntry.done) return;

  const [beatIndex, job] = nextEntry.value;
  queue.pending.delete(beatIndex);
  queue.processing = true;

  try {
    console.log(`[VEO] Processing clip for beat ${beatIndex}...`);
    const clip = await generateVideoClip(job.scenePrompt, job.refImage);

    const clipData = {
      campaignId: job.campaignId,
      beatIndex: job.beatIndex,
      videoUrl: clip.videoUrl,
      durationSeconds: clip.durationSeconds,
      source: clip.source,
      completedAt: Date.now(),
    };

    queue.completed.set(beatIndex, clipData);
    console.log(`[VEO] Clip ready for beat ${beatIndex}: ${clip.videoUrl.slice(0, 80)}`);

    // Broadcast to WS subscribers
    if (job.broadcast) {
      try {
        job.broadcast(clipData);
      } catch (err) {
        console.warn('[VEO] Broadcast failed:', err.message);
      }
    }
  } catch (err) {
    console.error(`[VEO] Failed for beat ${beatIndex}:`, err.message);
    queue.failed.set(beatIndex, { error: err.message, failedAt: Date.now() });
  } finally {
    queue.processing = false;
    // Process next job if any
    if (queue.pending.size > 0) {
      processQueue(campaignId);
    }
  }
}

/**
 * Get a completed video clip for a specific beat, if ready.
 * @param {number} campaignId
 * @param {number} beatIndex
 * @returns {{ videoUrl: string, durationSeconds: number, source: string, completedAt: number } | null}
 */
export function getVideoForBeat(campaignId, beatIndex) {
  const queue = queues.get(campaignId);
  if (!queue) return null;
  return queue.completed.get(beatIndex) || null;
}

/**
 * Get queue status for a campaign.
 * @param {number} campaignId
 * @returns {{ pending: number, completed: number, failed: number }}
 */
export function getQueueStatus(campaignId) {
  const queue = queues.get(campaignId);
  if (!queue) return { pending: 0, completed: 0, failed: 0 };
  return {
    pending: queue.pending.size,
    completed: queue.completed.size,
    failed: queue.failed.size,
  };
}

/**
 * Clear all queue state for a campaign (on session stop).
 * @param {number} campaignId
 */
export function clearQueue(campaignId) {
  queues.delete(campaignId);
  console.log(`[VEO] Cleared queue for campaign ${campaignId}`);
}
