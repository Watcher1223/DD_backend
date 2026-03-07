// ═══════════════════════════════════════════════
// STORY ROUTES — Bedtime story mode: Lyria RealTime + theme updates
// POST /api/story/start, POST /api/music/update, POST /api/story/stop
// ═══════════════════════════════════════════════

import { Router } from 'express';
import { createLyriaRealtimeSession } from '../ai/lyria_realtime.js';
import { generateBedtimeStoryBeat, extractThemeFromDescription, generateCharacterInjectionBeat } from '../ai/gemini.js';
import { generateSafeBedtimeStoryBeat } from '../ai/safety.js';
import {
  generateMusicPrompts,
  shouldUpdatePrompts,
  markPromptsApplied,
  resetThrottle,
  DEFAULT_WEIGHTED_PROMPTS,
} from '../ai/music_engine.js';
import { analyzeEmotionFromFrame } from '../vision/emotion_analysis.js';
import { analyzeStageVision } from '../vision/stage_vision.js';
import { generateSceneImage } from '../ai/nanobanana.js';
import { detectToyInFrame } from '../vision/object_detection.js';
import { retrieveMemoryContext, upsertStoryMemory } from '../memory/chroma.js';
import {
  getCampaign,
  getEventCount,
  getSessionProfiles,
  createStorySession,
  getStorySession,
  getStoryPages,
  saveStoryBeat,
} from '../db/index.js';
import { resolveCampaignId } from './resolve_campaign.js';

const router = Router();

/** In-memory active bedtime story session: { handle, campaignId, userTheme } or null */
let activeStorySession = null;

/**
 * POST /api/story/start
 * Start a bedtime story session: wait for at least one subscriber, then open Lyria RealTime and start play.
 * Body: { themeDescription?: string } — user's voice/text (e.g. "bedtime story in the forest"); theme is extracted and used for music.
 */
router.post('/story/start', async (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  if (activeStorySession) {
    return res.status(200).json({ ok: true, message: 'Session already active' });
  }

  const broadcastStoryAudio = req.app.locals.broadcastStoryAudio;
  const getStoryAudioSubscriberCount = req.app.locals.getStoryAudioSubscriberCount;
  if (!broadcastStoryAudio) {
    return res.status(500).json({ error: 'Story audio broadcast not configured' });
  }

  try {
    // Wait for at least one client to subscribe so we don't broadcast to nobody
    const deadline = Date.now() + 5000;
    while (getStoryAudioSubscriberCount() < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (getStoryAudioSubscriberCount() < 1) {
      console.warn('[STORY] Starting Lyria with no subscribers — client should send subscribe before calling /story/start');
    } else {
      console.log('[STORY] Subscriber(s) ready, starting Lyria RealTime');
    }

    const handle = await createLyriaRealtimeSession({
      onAudioChunk(buf) {
        if (!req.app.locals._lyriaChunkCount) req.app.locals._lyriaChunkCount = 0;
        req.app.locals._lyriaChunkCount++;
        if (req.app.locals._lyriaChunkCount <= 3 || req.app.locals._lyriaChunkCount % 20 === 0) {
          console.log('[STORY] Lyria audio chunk #' + req.app.locals._lyriaChunkCount + ', size=' + buf.length);
        }
        broadcastStoryAudio(buf);
      },
      onClose() {
        if (activeStorySession?.handle === handle) {
          activeStorySession = null;
          resetThrottle();
          req.app.locals.broadcastStoryAudioEnd?.();
        }
      },
      onError(err) {
        console.error('[STORY] Lyria RealTime error:', err);
      },
    });

    await handle.updatePrompts(DEFAULT_WEIGHTED_PROMPTS);
    handle.setMusicGenerationConfig({ bpm: 70, density: 0.5 });
    handle.play();

    let userTheme = null;
    const themeDescription = req.body?.themeDescription;
    if (themeDescription && typeof themeDescription === 'string') {
      userTheme = await extractThemeFromDescription(themeDescription);
      const scene = { theme: userTheme, mood: 'calm', intensity: 0.3, emotion: 'neutral' };
      const { weightedPrompts, theme, mood, intensity } = generateMusicPrompts(scene);
      await handle.updatePrompts(weightedPrompts);
      markPromptsApplied({ theme, mood, intensity });
    }

    activeStorySession = { handle, userTheme, campaignId, lastSeenPeopleCount: 0, lastSeenLabels: new Set(), language: req.body?.language || null };
    resetThrottle();
    req.app.locals._lyriaChunkCount = 0;

    res.json({ ok: true, message: 'Bedtime story session started', userTheme: userTheme ?? undefined });
  } catch (err) {
    console.error('[STORY] Start failed:', err.message);
    res.status(503).json({
      error: 'Failed to start story session',
      details: err.message,
    });
  }
});

/**
 * POST /api/music/update
 * Body: { theme?, genre?, mood?, intensity?, emotion?, detected_events? }
 * Updates Lyria RealTime prompts when session is active (with throttling).
 * When detected_events includes yawn/laugh/scared, stage-event overrides apply (lullaby/upbeat/tense).
 */
router.post('/music/update', (req, res) => {
  if (!activeStorySession) {
    return res.status(409).json({
      error: 'No active story session',
      message: 'Call POST /api/story/start first.',
    });
  }

  const storySession = getStorySession(activeStorySession.campaignId);
  const scene = {
    theme: req.body?.theme ?? 'bedtime',
    genre: req.body?.genre,
    mood: req.body?.mood ?? 'calm',
    intensity: req.body?.intensity,
    emotion: req.body?.emotion ?? 'neutral',
    storyEnergy: req.body?.storyEnergy ?? req.body?.story_energy ?? storySession?.story_energy,
    detected_events: req.body?.detected_events,
  };

  const result = generateMusicPrompts(scene);
  const { weightedPrompts, theme, mood, intensity, stageEventConfig } = result;

  if (!shouldUpdatePrompts({ theme, mood, intensity })) {
    return res.status(200).json({ ok: true, skipped: true, reason: 'throttled' });
  }

  const handle = activeStorySession.handle;
  handle
    .updatePrompts(weightedPrompts)
    .then(() => {
      if (stageEventConfig) {
        return handle.setMusicGenerationConfig(stageEventConfig);
      }
    })
    .then(() => {
      markPromptsApplied({ theme, mood, intensity });
      res.json({ ok: true, updated: true });
    })
    .catch((err) => {
      console.error('[STORY] Music update failed:', err.message);
      res.status(503).json({ error: 'Failed to update music prompts', details: err.message });
    });
});

/**
 * POST /api/story/emotion-from-camera
 * Send a webcam frame; Gemini Vision infers emotion/mood/intensity (theme comes from user description via start or set-theme).
 * If updateMusic is true and a story session is active, updates Lyria using session's userTheme + camera emotion.
 * Body: { frame: string (base64), updateMusic?: boolean }
 */
router.post('/story/emotion-from-camera', async (req, res) => {
  const { frame, updateMusic } = req.body || {};
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }

  try {
    const signals = await analyzeEmotionFromFrame(frame);
    const theme = activeStorySession?.userTheme || 'bedtime';
    let musicUpdated = false;

    if (updateMusic && activeStorySession) {
      const storySession = getStorySession(activeStorySession.campaignId);
      const scene = {
        theme,
        mood: signals.mood,
        intensity: signals.intensity,
        emotion: signals.emotion,
        detected_events: signals.detected_events || [],
        storyEnergy: storySession?.story_energy,
      };
      const result = generateMusicPrompts(scene);
      const { weightedPrompts, theme: t, mood, intensity, stageEventConfig } = result;
      if (shouldUpdatePrompts({ theme: t, mood, intensity })) {
        await activeStorySession.handle.updatePrompts(weightedPrompts);
        if (stageEventConfig) {
          activeStorySession.handle.setMusicGenerationConfig(stageEventConfig);
        }
        markPromptsApplied({ theme: t, mood, intensity });
        musicUpdated = true;
      }
    }

    res.json({
      emotion: signals.emotion,
      mood: signals.mood,
      theme,
      intensity: signals.intensity,
      detected_events: signals.detected_events || [],
      musicUpdated,
    });
  } catch (err) {
    console.error('[STORY] Emotion-from-camera failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('Gemini') ? 503 : 500;
    res.status(status).json({
      error: 'Emotion analysis failed',
      details: err.message,
    });
  }
});

/**
 * POST /api/story/set-theme
 * Set the story theme from the user's voice or text description (e.g. "under the sea", "story in the forest").
 * If a story session is active, music is updated to match. Body: { themeDescription: string }
 */
router.post('/story/set-theme', async (req, res) => {
  const themeDescription = req.body?.themeDescription;
  if (!themeDescription || typeof themeDescription !== 'string') {
    return res.status(400).json({ error: 'themeDescription is required' });
  }

  try {
    const userTheme = await extractThemeFromDescription(themeDescription);
    if (activeStorySession) {
      activeStorySession.userTheme = userTheme;
      const scene = { theme: userTheme, mood: 'calm', intensity: 0.3, emotion: 'neutral' };
      const { weightedPrompts, theme, mood, intensity } = generateMusicPrompts(scene);
      await activeStorySession.handle.updatePrompts(weightedPrompts);
      markPromptsApplied({ theme, mood, intensity });
    }
    res.json({ ok: true, userTheme });
  } catch (err) {
    console.error('[STORY] Set-theme failed:', err.message);
    res.status(503).json({ error: 'Failed to set theme', details: err.message });
  }
});

/**
 * POST /api/story/stage-vision
 * Send a webcam frame; detect if a new person entered (e.g. judge). If so, generate a character-injection beat and optionally a character card image.
 * Body: { frame: string (base64), generateImage?: boolean }
 */
router.post('/story/stage-vision', async (req, res) => {
  const { frame, generateImage } = req.body || {};
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }
  if (!activeStorySession) {
    return res.status(409).json({ error: 'No active story session', message: 'Call POST /api/story/start first.' });
  }

  try {
    const prevCount = activeStorySession.lastSeenPeopleCount ?? 0;
    const prevLabels = activeStorySession.lastSeenLabels ?? new Set();
    const result = await analyzeStageVision(frame, prevCount, prevLabels);

    activeStorySession.lastSeenPeopleCount = result.people.length;
    activeStorySession.lastSeenLabels = new Set(result.people.map((p) => p.label).filter(Boolean));
    if (result.setting) activeStorySession.lastSetting = result.setting;

    let character_beat = null;
    let imageUrl = null;

    if (result.new_entrant && result.new_entrant_description) {
      const context = activeStorySession.lastSetting || '';
      character_beat = await generateCharacterInjectionBeat(result.new_entrant_description, context);
      if (generateImage && character_beat.scene_prompt) {
        try {
          const imgResult = await generateSceneImage(character_beat.scene_prompt);
          if (imgResult?.imageUrl) imageUrl = imgResult.imageUrl;
        } catch (imgErr) {
          console.warn('[STORY] Character card image failed:', imgErr.message);
        }
      }
      const broadcast = req.app.locals.broadcast;
      if (broadcast && character_beat) {
        broadcast(JSON.stringify({
          type: 'character_injection',
          narration: character_beat.narration,
          scene_prompt: character_beat.scene_prompt,
          imageUrl: imageUrl || undefined,
        }));
      }
    }

    res.json({
      new_entrant: result.new_entrant,
      people_count: result.people.length,
      character_beat: character_beat || undefined,
      imageUrl: imageUrl || undefined,
    });
  } catch (err) {
    console.error('[STORY] Stage-vision failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('Gemini') ? 503 : 500;
    res.status(status).json({ error: 'Stage vision failed', details: err.message });
  }
});

/**
 * POST /api/story/detect-object
 * Detect toy/doll in frame for use as protagonist. Body: { frame: string (base64) }
 */
router.post('/story/detect-object', async (req, res) => {
  const { frame } = req.body || {};
  if (!frame || typeof frame !== 'string') {
    return res.status(400).json({ error: 'frame is required (base64 encoded image)' });
  }

  try {
    const result = await detectToyInFrame(frame);
    res.json({
      objects: result.objects,
      protagonist_description: result.protagonist_description ?? undefined,
    });
  } catch (err) {
    console.error('[STORY] Detect-object failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('Gemini') ? 503 : 500;
    res.status(status).json({ error: 'Object detection failed', details: err.message });
  }
});

/**
 * POST /api/story/set-protagonist
 * Set the story protagonist from a description (e.g. from detect-object). Body: { protagonist_description: string }
 */
router.post('/story/set-protagonist', (req, res) => {
  const protagonist_description = req.body?.protagonist_description;
  if (protagonist_description !== undefined && typeof protagonist_description !== 'string') {
    return res.status(400).json({ error: 'protagonist_description must be a string or omit to clear' });
  }
  if (activeStorySession) {
    activeStorySession.protagonist_description = protagonist_description && protagonist_description.trim() ? protagonist_description.trim() : null;
  }
  res.json({
    ok: true,
    protagonist_description: activeStorySession?.protagonist_description ?? null,
  });
});

/**
 * POST /api/story/set-language
 * Set narration language for the active story session. Body: { language: string } (e.g. 'es', 'fr', 'en')
 */
router.post('/story/set-language', (req, res) => {
  const language = req.body?.language;
  if (language !== undefined && (typeof language !== 'string' || !language.trim())) {
    return res.status(400).json({ error: 'language must be a non-empty string (e.g. es, fr, en)' });
  }
  if (activeStorySession) {
    activeStorySession.language = language && language.trim() ? language.trim().toLowerCase() : null;
  }
  res.json({
    ok: true,
    language: activeStorySession?.language ?? null,
  });
});

/**
 * POST /api/story/stop
 * End the bedtime story session and close Lyria RealTime.
 */
router.post('/story/stop', (req, res) => {
  if (!activeStorySession) {
    return res.status(200).json({ ok: true, message: 'No active session' });
  }

  try {
    activeStorySession.handle.close();
    activeStorySession = null;
    resetThrottle();
    res.json({ ok: true, message: 'Story session stopped' });
  } catch (err) {
    console.error('[STORY] Stop failed:', err.message);
    activeStorySession = null;
    resetThrottle();
    res.status(500).json({ error: 'Failed to stop session', details: err.message });
  }
});

/**
 * GET /api/story/status
 * Return whether a story session is active and the current user-set theme (from voice/text description).
 */
router.get('/story/status', (req, res) => {
  res.json({
    active: !!activeStorySession,
    userTheme: activeStorySession?.userTheme ?? null,
    language: activeStorySession?.language ?? null,
  });
});

/**
 * GET /api/story/debug
 * Return chunk count from Lyria (for debugging no-audio issues).
 */
router.get('/story/debug', (req, res) => {
  const count = req.app.locals._lyriaChunkCount ?? 0;
  res.json({ lyriaChunksReceived: count, sessionActive: !!activeStorySession });
});

/**
 * POST /api/story/configure
 * Create or update bedtime story session configuration.
 * Body: { childName, childAge, learningGoals?: string[], campaignId? }
 */
router.post('/story/configure', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const input = readStoryConfigureInput(req.body);
  if (!input.ok) {
    return res.status(400).json({ error: input.error });
  }

  const storySession = createStorySession(campaignId, input.value);
  res.json({
    campaignId,
    childName: storySession.child_name,
    childAge: storySession.child_age,
    learningGoals: storySession.learning_goals,
    storyEnergy: storySession.story_energy,
    createdAt: storySession.created_at,
    updatedAt: storySession.updated_at,
  });
});

/**
 * POST /api/story/beat
 * Bedtime story beat: Gemini generates narration + theme; optionally updates music and persists.
 * Body: { action, campaignId? }
 */
router.post('/story/beat', async (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }
  const action = req.body?.action;
  if (!action || typeof action !== 'string') {
    return res.status(400).json({ error: 'action is required' });
  }

  try {
    const campaign = getCampaign(campaignId);
    const storySession = getStorySession(campaignId);
    if (!storySession) {
      return res.status(409).json({
        error: 'Story session not configured',
        message: 'Call POST /api/story/configure first.',
      });
    }

    const sessionProfiles = getSessionProfiles(campaignId);
    const memoryContext = await retrieveMemoryContext(campaignId, action);
    const protagonist_description = activeStorySession?.protagonist_description;
    const language = activeStorySession?.language || req.body?.language || 'en';
    const beat = await generateSafeBedtimeStoryBeat(action, campaign, storySession, sessionProfiles, memoryContext, { protagonist_description, language });
    const image = await generateSceneImage(beat.scene_prompt);

    const event = {
      action,
      diceRoll: null,
      narration: beat.narration,
      scene_prompt: beat.scene_prompt,
      music_mood: beat.theme || beat.mood || 'calm',
      location: beat.location || 'Unknown',
      timestamp: Date.now(),
      imageUrl: image.imageUrl,
      imageSource: image.source,
      learningMoment: beat.learning_moment,
      theme: beat.theme,
      mood: beat.mood,
      intensity: beat.intensity,
      emotion: beat.emotion,
      eventKind: 'story',
    };
    saveStoryBeat(campaignId, event, beat.story_energy);
    upsertStoryMemory(campaignId, event).catch(() => {});

    if (activeStorySession?.campaignId === campaignId) {
      const scene = {
        theme: beat.theme,
        genre: beat.genre,
        mood: beat.mood,
        intensity: beat.intensity,
        emotion: beat.emotion,
        storyEnergy: beat.story_energy,
      };
      const { weightedPrompts, theme, mood, intensity } = generateMusicPrompts(scene);
      if (shouldUpdatePrompts({ theme, mood, intensity })) {
        await activeStorySession.handle.updatePrompts(weightedPrompts);
        markPromptsApplied({ theme, mood, intensity });
      }
    }

    const eventNumber = getEventCount(campaignId);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const langParam = language && language !== 'en' ? `&lang=${encodeURIComponent(language)}` : '';
    const narrationAudioUrl = `${baseUrl}/api/tts?text=${encodeURIComponent(beat.narration)}${langParam}`;

    res.json({
      narration: beat.narration,
      scene_prompt: beat.scene_prompt,
      image,
      music: {
        theme: beat.theme,
        genre: beat.genre,
        mood: beat.mood,
        intensity: beat.intensity,
        emotion: beat.emotion,
      },
      theme: beat.theme,
      mood: beat.mood,
      intensity: beat.intensity,
      emotion: beat.emotion,
      learning_moment: beat.learning_moment,
      location: beat.location,
      story_energy: beat.story_energy,
      event_number: eventNumber,
      language,
      narrationAudioUrl,
    });
  } catch (err) {
    console.error('[STORY] Beat failed:', err.message);
    const status = err.message?.includes('required') || err.message?.includes('failed') ? 503 : 500;
    res.status(status).json({ error: 'Story beat failed', details: err.message });
  }
});

/**
 * GET /api/story/export
 * Export bedtime story beats as storybook pages.
 */
router.get('/story/export', (req, res) => {
  const campaignId = resolveCampaignId(req);
  if (campaignId === null) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  const storySession = getStorySession(campaignId);
  const pages = getStoryPages(campaignId).map((page) => ({
    narration: page.narration,
    imageUrl: page.imageUrl,
    scene_prompt: page.scene_prompt,
    learning_moment: page.learningMoment,
  }));

  res.json({
    campaignId,
    childName: storySession?.child_name ?? null,
    learningGoals: storySession?.learning_goals ?? [],
    pages,
  });
});

export default router;

/**
 * Validate bedtime story configuration payload.
 * @param {any} body
 * @returns {{ ok: true, value: { childName: string, childAge: number, learningGoals: string[] } } | { ok: false, error: string }}
 */
function readStoryConfigureInput(body) {
  const childName = String(body?.childName || '').trim();
  if (!childName) {
    return { ok: false, error: 'childName is required' };
  }

  const childAge = Number(body?.childAge);
  if (!Number.isInteger(childAge) || childAge < 1 || childAge > 18) {
    return { ok: false, error: 'childAge must be an integer between 1 and 18' };
  }

  return {
    ok: true,
    value: {
      childName,
      childAge,
      learningGoals: normalizeLearningGoals(body?.learningGoals),
    },
  };
}

/**
 * Normalize configure payload learning goals.
 * @param {unknown} learningGoals
 * @returns {string[]}
 */
function normalizeLearningGoals(learningGoals) {
  if (!Array.isArray(learningGoals)) return [];
  return learningGoals
    .map((goal) => String(goal || '').trim())
    .filter(Boolean);
}
