# Living Worlds — Frontend Integration Guide

This document is for **frontend developers** integrating with the Living Worlds backend. It covers integration order, key flows, and code examples. For full request/response schemas and every endpoint, see [FRONTEND_API.md](./FRONTEND_API.md).

---

## Overview

- **Backend:** Node.js (Express + WebSocket). Real data: SQLite campaign, Gemini (story/vision), NanoBanana/Imagen (images), Vertex Lyria (batch music), Gemini Lyria RealTime (bedtime story music).
- **Base URL:** `http://localhost:4300` (or your deployed origin). Use the same origin for WebSocket and audio to avoid CORS.
- **WebSocket:** `ws://localhost:4300` (or `wss://` in production).

**Two main modes:**

1. **Dungeon Master (core game)** — `POST /api/action` returns narration, scene image, and music URL. Play narration and music via same-origin URLs.
2. **Bedtime story** — Continuous adaptive music over WebSocket. Start session, subscribe to `story_audio`, receive PCM chunks and play with Web Audio API.

---

## 1. On load: health and capability flags

Call **`GET /api/health`** first. Use the response to adapt the UI (e.g. disable music if Lyria is unavailable).

```json
{
  "status": "ok",
  "has_gemini": true,
  "has_vision": true,
  "has_nanobanana": true,
  "has_lyria": true
}
```

- If `has_gemini` is false, story actions will return 503.
- If `has_lyria` is false, `GET /api/music/generate` and Lyria RealTime will fail (502/503).
- Use `has_vision` to show/hide camera character analysis.

---

## 2. Core game loop (Dungeon Master)

1. **Optional:** Capture webcam frame and send **`POST /api/camera/analyze`** (body: `{ frame: "<base64>" }`) so the story can reference character appearances.
2. User submits an action (e.g. “I open the chest”).
3. **`POST /api/action`** with body `{ action: "I open the chest" }` (optional: `diceRoll`, `webcamFrame`, `campaignId`).
4. Show loading state (typically 2–5+ seconds).
5. On 200: display `narration`, set scene image to `image.imageUrl`, play `narrationAudioUrl` then `music.audioUrl` (see [Playing narration and music](#playing-narration-and-music) in FRONTEND_API.md).
6. On 503/502: show the `details` or `error` from the JSON body.

**Important:** First playback must happen inside a **user gesture** (e.g. click); browsers block autoplay otherwise.

---

## 3. Campaign and persistence

- **`GET /api/campaign`** — On load, use this to show “Continue” and recent events/locations/characters.
- **`POST /api/campaign/reset`** — Reset to seed state.
- **`GET /api/campaigns`** / **`POST /api/campaigns`** — List and create campaigns when using multiple campaigns.

---

## 4. Bedtime story mode (Lyria RealTime)

Continuous adaptive music: the server streams **16-bit PCM** over the WebSocket to clients that have subscribed to the `story_audio` channel. You must **subscribe before** calling **`POST /api/story/start`**, or the server will start Lyria with no subscribers and you will not receive audio.

### Order of operations

1. **Connect** WebSocket to `ws://localhost:4300` (or `wss://` in production).
2. **Subscribe** as soon as the socket is open (and again right before start if you reuse an existing connection):
   ```json
   { "type": "subscribe", "channel": "story_audio" }
   ```
3. **Wait** ~500 ms so the server can process the subscribe message.
4. **Start** the session: **`POST /api/story/start`**. Optionally send the **theme from the user’s voice or text** in the body: `{ "themeDescription": "bedtime story in the forest" }`. The server extracts a theme key (e.g. “magical forest”) and uses it for music; camera only drives **emotion/mood/intensity**.
5. **Handle messages:**  
   - `type: "audio_chunk"` — `payload` is base64-encoded PCM; `sampleRate` 48000, `channels` 2.  
   - `type: "music_session_ended"` — session ended (e.g. after stop).

### Playing the PCM stream

- Decode base64 → `ArrayBuffer` → `Int16Array`.
- Use **Web Audio API**: create an `AudioBuffer` (48000 Hz, 2 channels), copy samples (interleaved L/R), schedule with `AudioBufferSourceNode` and a small queue to avoid gaps.

**Minimal decode + schedule (conceptual):**

```javascript
// Decode base64 payload to Int16Array
function decodeBase64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// In your WebSocket message handler:
if (msg.type === 'audio_chunk' && msg.payload) {
  const int16 = new Int16Array(decodeBase64ToArrayBuffer(msg.payload));
  const sampleRate = msg.sampleRate || 48000;
  const channels = msg.channels || 2;
  // Create AudioBuffer, copy int16 (interleaved), schedule with source.start(nextStartTime)
  // nextStartTime += buffer.duration (to queue chunks back-to-back)
}
```

A full working example (including queueing and planar option) is in **`public/test-story-audio.html`**. Open `http://localhost:4300/test-story-audio.html` to test the backend locally.

### Updating music (theme / mood / emotion)

- **Theme** comes from the **user’s description** (voice or text), not from the camera. Send it when starting: **`POST /api/story/start`** with body `{ "themeDescription": "bedtime story in the forest" }`, or later with **`POST /api/story/set-theme`** with `{ "themeDescription": "under the sea" }`. The server uses Gemini to map the phrase to a theme key (e.g. “magical forest”, “under the sea”) and uses it for Lyria.
- **Emotion/mood/intensity** can be driven by the camera via **`POST /api/story/emotion-from-camera`** (or by presets). When both are used, theme = user description, emotion/mood/intensity = from camera.

**Alternative: Overshoot (or any vision) → music without hardcoding**  
If you use **Overshoot** (or another real-time vision API) in the frontend to detect laughs, yawns, etc., send the **raw text result** to **`POST /api/story/vision-event`** with body `{ text: "<result>" }`. The backend maps that text to `emotion`, `mood`, `intensity`, and `detected_events` (e.g. "laugh" → upbeat, "yawn" → lullaby) and updates Lyria when a story session is active. Use a **single generic prompt** in Overshoot, e.g. *"In one word or short phrase, what is the person doing or feeling? Examples: laughing, yawning, scared, happy, sleepy, neutral, excited, sad."* No need to hardcode mood logic in the frontend — the backend owns the mapping.

While the session is active, you can also send **`POST /api/music/update`** with body (all optional):

- `theme` — e.g. `"under the sea"`, `"fairy tale"`
- `mood` — e.g. `"calm"`, `"peaceful"`, `"dreamy"`
- `intensity` — 0–1 number
- `emotion` — e.g. `"sleepy"`, `"curious"`, `"peaceful"`

Updates are throttled (theme/mood change or intensity delta &gt; 0.15). Response: `{ ok: true, updated: true }` or `{ ok: true, skipped: true, reason: "throttled" }`.

### Other story endpoints

- **`POST /api/story/stop`** — End the session; server sends `music_session_ended` to subscribers.
- **`GET /api/story/status`** — `{ "active": true, "userTheme": "magical forest" }` or `{ "active": false, "userTheme": null }`. `userTheme` is the theme extracted from the user’s description (voice/text).
- **`GET /api/story/debug`** — `{ "lyriaChunksReceived": N, "sessionActive": true }` (for debugging no-audio).
- **`POST /api/story/beat`** — Body `{ action: "string" }`. Gemini generates a story beat and optional music update; returns `narration`, `theme`, `mood`, `emotion`, etc.
- **`POST /api/story/emotion-from-camera`** — Send a webcam frame (base64); **Gemini Vision** infers emotion/mood/intensity (theme comes from the user’s description set at start or via set-theme). If `updateMusic: true` and a story session is active, the backend updates Lyria using the session’s theme + camera emotion. Body: `{ frame: "<base64>", updateMusic?: boolean }`. Response: `{ emotion, mood, theme, intensity, musicUpdated }`.
- **`POST /api/story/vision-event`** — Send a **free-text vision result** (e.g. from Overshoot) to drive music without hardcoding. Body: `{ text: "laugh" }` (or "yawn", "scared", "happy", "sleepy", "neutral", etc.). Backend maps text to emotion/mood/detected_events and updates Lyria when a story session is active. Response: `{ emotion, mood, theme, intensity, detected_events, musicUpdated }`.

### Batch music (one-shot WAV)

**`GET /api/music/generate?mood=calm`** returns a WAV stream (e.g. for a “test music” button). On 502, the body is JSON: `{ "error": "...", "details": "..." }`. Use `fetch()` and show `details` to the user if you want to display the failure reason.

---

## 5. WebSocket (general)

- **Connect:** `new WebSocket(WS_URL)`.
- **Subscribe to story audio:** send `{ "type": "subscribe", "channel": "story_audio" }`. The server accepts both string and binary (Buffer) frames; it will parse the JSON and add you to the subscriber list.
- **Story updates (core game):** When any client calls `POST /api/action`, the server can broadcast `type: "story_update"` with the same shape as the action response — useful for multi-screen or real-time UIs.

---

## 6. Frontend checklist

- [ ] Call **`GET /api/health`** on load; use `has_gemini`, `has_lyria`, etc. to enable/disable features or show “Configure API”.
- [ ] **Core game:** Show loading for **`POST /api/action`**; display `narration`, `image.imageUrl`; play `narrationAudioUrl` and `music.audioUrl` inside a user gesture.
- [ ] **Bedtime story:** Connect WebSocket → send **subscribe** → wait ~500 ms → **`POST /api/story/start`**. Decode `audio_chunk.payload` (base64 → Int16, 48 kHz stereo) and play with Web Audio API. Optionally call **`POST /api/music/update`** when theme/mood changes.
- [ ] **Emotion-driven music:** When a story session is active, periodically capture a webcam frame (e.g. every 3–4 s), POST to **`POST /api/story/emotion-from-camera`** with `{ frame: "<base64>", updateMusic: true }` so Gemini Vision infers emotion and the backend updates Lyria to match. Alternatively, use **Overshoot** (or any vision API) with a generic mood prompt and send the result to **`POST /api/story/vision-event`** with `{ text: result.result }` — no hardcoding of moods in the frontend.
- [ ] On load, call **`GET /api/campaign`** (and optionally **`GET /api/camera/profiles`**) to restore state.
- [ ] Handle 400/404/500/502/503 by reading the JSON body and showing `error` or `details` to the user.

---

## 7. Quick reference

| What you need           | Endpoint / action |
|-------------------------|-------------------|
| Capabilities on load    | `GET /api/health` |
| Send action, get story  | `POST /api/action` |
| Campaign state          | `GET /api/campaign` |
| Start bedtime music     | WebSocket subscribe `story_audio` → wait → `POST /api/story/start` (body: `themeDescription` for theme) |
| Set theme (voice/text) | `POST /api/story/set-theme` (body: `themeDescription`) |
| Update story music      | `POST /api/music/update` (theme, mood, intensity, emotion) |
| Stop story session      | `POST /api/story/stop` |
| Emotion from camera → music | `POST /api/story/emotion-from-camera` (frame + updateMusic) |
| Vision text → music (Overshoot, etc.) | `POST /api/story/vision-event` (body: `{ text }`) |
| One-shot music (WAV)    | `GET /api/music/generate?mood=...` |
| Test story + audio      | Open `/test-story-audio.html` |

Full API reference: **[FRONTEND_API.md](./FRONTEND_API.md)**.
