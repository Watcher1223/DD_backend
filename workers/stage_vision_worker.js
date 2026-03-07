// ═══════════════════════════════════════════════
// STAGE VISION WORKER — Process frames from LiveKit (or client-sent) stream
// Runs analyzeStageVision, updates session state, broadcasts stage_vision_tick.
// Invoked by POST /api/livekit/vision-frame or by a future server-side frame pipeline.
// ═══════════════════════════════════════════════

import { analyzeStageVision } from '../vision/stage_vision.js';

/**
 * Process one frame: run stage vision, update session state, broadcast stage_vision_tick.
 * @param {string} frameBase64 - Base64 or data URL from camera/LiveKit
 * @param {object} session - Active story session (mutated: lastSeenPeopleCount, lastSeenLabels, lastSetting)
 * @param {(message: string) => void} broadcast - WebSocket broadcast function
 * @returns {Promise<{ people_count: number, new_entrant: boolean, new_entrant_description?: string, setting?: string }>}
 */
export async function processFrame(frameBase64, session, broadcast) {
  const prevCount = session.lastSeenPeopleCount ?? 0;
  const prevLabels = session.lastSeenLabels ?? new Set();

  const result = await analyzeStageVision(frameBase64, prevCount, prevLabels);

  session.lastSeenPeopleCount = result.people.length;
  session.lastSeenLabels = new Set(result.people.map((p) => p.label).filter(Boolean));
  if (result.setting) session.lastSetting = result.setting;

  if (broadcast) {
    broadcast(
      JSON.stringify({
        type: 'stage_vision_tick',
        people_count: result.people.length,
        new_entrant: result.new_entrant,
        setting: result.setting ?? undefined,
      })
    );
  }

  return {
    people_count: result.people.length,
    new_entrant: result.new_entrant,
    new_entrant_description: result.new_entrant_description,
    setting: result.setting,
  };
}
