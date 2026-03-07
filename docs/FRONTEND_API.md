# Living Worlds — Frontend API Documentation

Backend API and real-data contract for the Living Worlds AI Dungeon Master frontend. The backend uses **real data**: persisted campaign state (SQLite), Gemini (story), NanoBanana 2 or Vertex Imagen (images), and Vertex Lyria 2 or presets (music).

**Frontend integration guide (order of operations, code examples):** see **[FRONTEND.md](./FRONTEND.md)**.

---

## Base URL & environment

- **Default:** `http://localhost:4300` (or set via `VITE_API_URL` / `REACT_APP_API_URL` etc.)
- **CORS:** Enabled for all origins. Use the same origin in production to avoid cross-origin issues for WebSockets and audio.
- **WebSocket:** `ws://localhost:4300` (or `wss://` in production if TLS is used).

---

## Status & health (design for real data)

Before or after loading the app, call the health endpoint to know what’s live and adjust UI (e.g. show “AI story” vs “Demo mode”, or disable image/music if unavailable).

### `GET /api/health`

**Response:**

```json
{
  "status": "ok",
  "service": "living-worlds",
  "campaign_events": 0,
  "has_gemini": true,
  "has_vision": true,
  "has_speech": true,
  "has_nanobanana": true,
  "has_lyria": true,
  "has_semantic_memory": false
}
```

| Field | Type | Meaning |
|-------|------|--------|
| `status` | string | Always `"ok"` when the server is up. |
| `campaign_events` | number | Event count for the default campaign (persisted in DB). |
| `has_gemini` | boolean | `true` = Gemini configured for story. `false` = action will return 503 until GEMINI_API_KEY is set. |
| `has_vision` | boolean | `true` = Camera character analysis available (uses same Gemini key). `false` = camera endpoints will return 503. |
| `has_speech` | boolean | `true` = Speech-to-text available (uses same Gemini key). `false` = transcription endpoint will return 503. |
| `has_nanobanana` | boolean | `true` = NanoBanana or Vertex Imagen available for images. `false` = action will fail for image until configured. |
| `has_lyria` | boolean | `true` = Vertex Lyria 2 available for music. `false` = music will return 502 until GOOGLE_CLOUD_PROJECT + billing. |
| `has_semantic_memory` | boolean | `true` = Chroma semantic memory connected. Story generation uses retrieved character/scene memories for better consistency. `false` = stories use recent history only (still fully functional). |

**Frontend recommendations:**

- If `has_gemini` is false, actions will return 503; show “Configure Gemini API” or disable the action button.
- If `has_nanobanana` is false, scene image may fail (503) until NanoBanana or Imagen is configured.
- If `has_lyria` is false, music URLs will return 502; hide or disable music or show “Music unavailable”.
- If `has_semantic_memory` is true, character appearances and story scenes are indexed for retrieval. Image and narration consistency across beats improves automatically; no frontend changes required.
- Use `campaign_events` to show “Session has N events” or to decide whether to offer “Continue” vs “New game”.

---

## Core game loop

### `POST /api/action`

Main game endpoint: send the player’s action and get narration, scene image, and music. Campaign state is persisted in the database.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | ✓ | Player action (e.g. “I open the chest”). |
| `diceRoll` | number \| null | | d20 value (1–20). Omit to let backend detect from `webcamFrame` or leave null. |
| `webcamFrame` | string | | Base64-encoded image for dice detection. Optional. |
| `campaignId` | number | | Campaign ID. Omit to use the default campaign. |

**Response (200):**

```json
{
  "narration": "Your blade arcs through the torchlight...",
  "narrationAudioUrl": "http://localhost:4300/api/tts?text=...",
  "diceRoll": null,
  "image": {
    "imageUrl": "https://... or data:image/png;base64,...",
    "source": "nanobanana"
  },
  "music": {
    "audioUrl": "http://localhost:4300/api/music/generate?mood=battle",
    "mood": "battle",
    "description": "AI-generated battle music (Lyria 2)",
    "source": "lyria"
  },
  "location": "The Obsidian Depths",
  "music_mood": "battle",
  "elapsed_ms": 3200,
  "event_number": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `narration` | string | Story text (from Gemini when `has_gemini` is true). |
| `narrationAudioUrl` | string | Same-origin URL to **play narration as speech**. Use in `<audio src="...">` or fetch and play. |
| `diceRoll` | number \| null | Resolved d20 roll, or null. |
| `image.imageUrl` | string | URL for the scene image. External (NanoBanana) or data URL (Imagen). |
| `image.source` | string | `"nanobanana"` \| `"imagen"`. |
| `music.audioUrl` | string | Same-origin URL for **background music**. Always use this URL (backend proxies Lyria/presets). |
| `music.mood` | string | Mood key (e.g. `battle`, `calm`, `danger`). |
| `music.source` | string | `"lyria"`. |
| `location` | string | Current location name. |
| `music_mood` | string | Same as `music.mood`. |
| `elapsed_ms` | number | Server-side latency in ms. |
| `event_number` | number | Total events in this campaign (persisted). |

**Errors:**

- `400` — `action` missing: `{ "error": "action is required" }`
- `404` — Invalid or missing campaign: `{ "error": "Campaign not found" }`
- `500` — Pipeline failure: `{ "error": "Story generation failed", "details": "..." }`
- `503` — Story, image, or music requires a real API (Gemini, NanoBanana/Imagen, or Lyria) but it was missing or failed. Response `details` explains what to configure.
- `502` — **Music:** `/api/music/generate` returns 502 if Lyria fails; body has `{ "error": "..." }`. Frontend can show “Music unavailable” or retry later.

**Frontend recommendations for real data:**

1. **Narration:** Display `narration` and, if you want voice, play `narrationAudioUrl` in an `<audio>` (or play narration first, then fade in music).
2. **Scene image:** Use `image.imageUrl` in `<img src={image.imageUrl} />`.
3. **Music:** Set background music to `music.audioUrl` (same-origin; no CORS). When a new action returns, optionally crossfade or replace the track. Lyria can take 10–20s to generate the first time; show loading or keep previous track until the new one is ready.
4. **Loading:** `elapsed_ms` is often 2–5+ seconds (Gemini + image + music). Show a clear loading state (e.g. “The DM is thinking…” or a spinner) until the response is received.
5. **Persistence:** After each action, the campaign is saved. On reload, use `GET /api/campaign` to restore state.

**No mocks:** Story, images, and music all require real APIs (Gemini, NanoBanana or Imagen, Lyria). If any are missing or fail, the backend returns 503/502 with an error message in `details`; fix the config and retry.

---

## Campaign & persistence

Campaign state (characters, locations, events) is stored in the database. There is a default campaign; optional `campaignId` supports multiple campaigns.

### `GET /api/campaign`

Query params (optional): `campaignId` (number).

**Response (200):**

```json
{
  "characters": [
    { "name": "Thorn", "role": "Shadow Ranger", "description": "A hooded figure with silver eyes" }
  ],
  "locations": ["The Rusty Chalice Tavern", "The Obsidian Depths"],
  "eventCount": 2,
  "recentEvents": [
    {
      "action": "I draw my sword",
      "diceRoll": null,
      "narration": "Your blade arcs...",
      "scene_prompt": "...",
      "music_mood": "battle",
      "location": "The Obsidian Depths",
      "timestamp": 1709765432000
    }
  ]
}
```

Use this on load to show “Continue” with the last few events or to display locations/characters.

### `POST /api/campaign/reset`

Body (optional): `{ "campaignId": 1 }`. Resets the campaign to seed state (clears events, resets characters/locations).

**Response (200):** `{ "ok": true, "message": "Campaign reset" }`

### `GET /api/campaigns`

**Response (200):** `{ "campaigns": [ { "id": 1, "name": "Default campaign" } ] }`

### `POST /api/campaigns`

Body (optional): `{ "name": "My campaign" }`. Creates a new campaign.

**Response (201):** `{ "id": 2, "name": "My campaign" }`

---

## Playing narration and music (why you might not hear audio)

The backend always returns `narrationAudioUrl` and `music.audioUrl`. **You only hear them if your frontend actually plays these URLs.** If you don’t call `.play()` (or use an `<audio src="...">` and trigger play), there will be no sound.

### 1. Start playback after a user gesture

Browsers block autoplay until the user has interacted with the page. So the **first** time you play narration or music, it must be inside a **click** (or other user) handler—e.g. when they click “Send” or “Speak”, not on page load.

### 2. Example: play narration then music

After you get the `POST /api/action` response, use the URLs like this:

```javascript
// After receiving response from POST /api/action:
const { narrationAudioUrl, music } = response;

const narrationAudio = new Audio(narrationAudioUrl);
const musicAudio = new Audio(music.audioUrl);

// Play narration first; when it ends, start music
narrationAudio.onended = () => musicAudio.play();
narrationAudio.play().catch(e => console.error('Narration play failed:', e));
musicAudio.play().catch(e => console.error('Music play failed:', e)); // or start after narration
```

### 3. React-style (play after user clicks Send)

```jsx
const handleSubmit = async () => {
  const res = await fetch(`${API_URL}/api/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: userInput }),
  });
  const data = await res.json();
  if (!res.ok) return;

  setNarration(data.narration);

  if (data.narrationAudioUrl && data.music?.audioUrl) {
    const narrationAudio = new Audio(data.narrationAudioUrl);
    const musicAudio = new Audio(data.music.audioUrl);
    narrationAudio.onended = () => musicAudio.play().catch(console.error);
    narrationAudio.play().catch(console.error);
  } else if (data.narrationAudioUrl) {
    new Audio(data.narrationAudioUrl).play().catch(console.error);
  } else if (data.music?.audioUrl) {
    new Audio(data.music.audioUrl).play().catch(console.error);
  }
};
```

### 4. Verify backend audio

Open **http://localhost:4300/test-audio.html** in your browser. Enter an action (e.g. “I'm in the forest”) and click **Send & Play**. You should hear narration then music. If it works there but not in your app, your app is not playing the returned URLs (or not doing it inside a user gesture).

---

## Audio (real data: same-origin URLs)

All audio URLs from the backend are **same-origin** (or data URLs), so playback works without CORS issues.

| Source | Meaning |
|--------|--------|
| `response.narrationAudioUrl` | TTS for the narration (proxied). Play first for “hear the DM” experience. |
| `response.music.audioUrl` | Background music (Lyria 2 or preset, proxied). Use for ambient/mood. |

**Implementation notes:**

- Use `<audio src={narrationAudioUrl} />` or `new Audio(narrationAudioUrl).play()`.
- For music, set `audio.src = music.audioUrl` and call `audio.play()` when the user has interacted (browser autoplay policy). Optionally wait for narration to finish before starting music.
- If Lyria is used, the first request to `music.audioUrl` (e.g. `/api/music/generate?mood=battle`) may take 10–20 seconds; show loading or keep previous track until ready.

---

## Images (real data: source and URL)

| `image.source` | Meaning |
|----------------|--------|
| `nanobanana` | NanoBanana 2 (hackathon). |
| `imagen` | Vertex AI Imagen (Google Cloud). |

`image.imageUrl` is always set: either an external URL or a `data:image/...;base64,...` URL (Imagen). Use it directly in `<img src={image.imageUrl} />`.

---

## Camera & character vision

The camera pipeline lets the frontend capture webcam frames, send them to the backend for Gemini Vision analysis, and store character appearance profiles. These profiles are automatically injected into the story engine's `scene_prompt` so generated images reflect the real people.

### Recommended frontend flow

1. Start camera via `navigator.mediaDevices.getUserMedia({ video: true })`
2. Capture a frame to a canvas and export as base64: `canvas.toDataURL("image/jpeg")`
3. Send to `POST /api/camera/analyze`
4. Display returned character profiles to the user ("Gemini sees: child with brown hair...")
5. Begin story generation via `POST /api/action` — profiles are automatically included

### `POST /api/camera/analyze`

Analyze a webcam frame to identify people and extract appearance descriptions. Results are persisted per campaign so subsequent story beats include the character appearances.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `frame` | string | ✓ | Base64-encoded JPEG/PNG image from the webcam. |
| `campaignId` | number | | Campaign ID. Omit to use the default campaign. |

**Response (200):**

```json
{
  "people": [
    {
      "label": "child",
      "hair": "brown, curly",
      "clothing": "blue pajamas",
      "features": "freckles, smiling",
      "age_range": "5-7"
    },
    {
      "label": "adult",
      "hair": "dark, short",
      "clothing": "gray sweater",
      "features": "glasses, beard",
      "age_range": "30-35"
    }
  ],
  "setting": "bedroom, dim lighting",
  "stored": 2,
  "elapsed_ms": 1200
}
```

| Field | Type | Description |
|-------|------|-------------|
| `people` | array | Detected people with appearance descriptions. |
| `people[].label` | string | Role label: `"child"`, `"adult"`, `"child_1"`, etc. |
| `people[].hair` | string | Hair color, length, and style. |
| `people[].clothing` | string | Visible clothing description. |
| `people[].features` | string | Distinguishing features (glasses, freckles, etc). |
| `people[].age_range` | string | Estimated age range (e.g. `"5-7"`). |
| `setting` | string | Brief description of the visible environment. |
| `stored` | number | How many profiles were saved to the session. |
| `elapsed_ms` | number | Server-side latency in ms. |

**Errors:**

- `400` — `frame` missing: `{ "error": "frame is required (base64 encoded image)" }`
- `404` — Invalid campaign: `{ "error": "Campaign not found" }`
- `500` — Analysis failure: `{ "error": "Character analysis failed", "details": "..." }`
- `503` — Gemini API key not configured.

### `GET /api/camera/profiles`

Return stored character profiles for a campaign.

**Query params (optional):** `campaignId` (number).

**Response (200):**

```json
{
  "profiles": [
    {
      "label": "child",
      "appearance": {
        "label": "child",
        "hair": "brown, curly",
        "clothing": "blue pajamas",
        "features": "freckles, smiling",
        "age_range": "5-7"
      },
      "updated_at": 1709765432000
    }
  ]
}
```

**Frontend recommendations:**

- Call `POST /api/camera/analyze` once before starting the story (or periodically to update appearances).
- You do NOT need to send frames continuously; one frame every few seconds is sufficient.
- Profiles persist across requests — once analyzed, every `POST /api/action` automatically includes character appearances in the scene prompt.
- Use `GET /api/camera/profiles` to restore/display saved profiles on page reload.
- Campaign reset (`POST /api/campaign/reset`) clears profiles along with all other campaign data.

---

## Speech-to-text

Transcribe audio recordings using Gemini multimodal. The transcript can be used as the `action` text in `POST /api/action`, enabling voice input alongside typed text.

### `POST /api/speech/transcribe`

Transcribe a recorded audio clip to text.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio` | string | yes | Base64-encoded audio. Can include the `data:audio/...;base64,` prefix or be raw base64. Supports webm, ogg, mp4, wav. |

**Response (200):**

```json
{
  "transcript": "I open the chest and look inside",
  "elapsed_ms": 850
}
```

| Field | Type | Description |
|-------|------|-------------|
| `transcript` | string | Transcribed text. Empty string if no speech was detected. |
| `elapsed_ms` | number | Server-side latency in ms. |

**Errors:**

- `400` -- Missing `audio`: `{ "error": "audio is required (base64 encoded audio)" }`
- `503` -- No Gemini key or API failure: `{ "error": "Transcription failed", "details": "..." }`
- `500` -- Unexpected error: `{ "error": "Transcription failed", "details": "..." }`

**Latency:** Expect 500-1500ms depending on audio length.

**Frontend recommendations:**

- Use `MediaRecorder` with `audio/webm` MIME type to capture audio from the microphone.
- Convert the recorded blob to base64 before sending.
- Display the returned transcript in the text input field so the user can review/edit before submitting as an action.
- Check `has_speech` from the health endpoint before showing the mic button.

---

## Other endpoints

### `GET /api/moods`

**Response (200):** `{ "moods": ["tavern", "forest", "battle", "mystery", "victory", "danger", "calm", "epic"] }`

### `POST /api/dice`

Body: `{ "webcamFrame": "<base64>" }` (optional). If no frame, returns a simulated roll.

**Response (200):** `{ "detected": true, "value": 14, "simulated": false }`

### `GET /api/audio?url=<encoded_url>`

Proxies external audio. Used internally by the backend for music; the frontend receives the final `music.audioUrl` pointing at this or at `/api/music/generate`.

### `GET /api/tts?text=<encoded_text>`

Returns narration as speech audio. Used for `narrationAudioUrl`; the frontend just uses the URL.

### `GET /api/music/generate?mood=<mood>`

Returns Lyria 2 WAV stream when Lyria is configured. Used for `music.audioUrl` when `music.source === "lyria"`. Frontend can use for a “test music” or one-shot playback.

**Response (200):** Binary WAV body; `Content-Type: audio/wav`.

**Response (502):** JSON body when Lyria fails (e.g. recitation block, config, or billing):

```json
{
  "error": "Music generation failed",
  "details": "Vertex Lyria returned no audio (e.g. recitation block). Set GOOGLE_CLOUD_PROJECT and try a different mood or LYRIA_PROMPT_OVERRIDE."
}
```

Use `fetch()` and parse JSON on non-OK to show `details` to the user.

---

## Bedtime story mode

Bedtime story uses **Lyria RealTime** (Gemini API `lyria-realtime-exp`) for **continuous** adaptive music. **Theme** comes from the **user’s voice or text description** (e.g. “bedtime story in the forest”); the server extracts a theme key and uses it for music. **Emotion/mood/intensity** can come from the camera (Gemini Vision) or from presets. The bedtime path also stores a per-campaign story session with the child’s name, age, learning goals, and wind-down energy. Start a session with `POST /api/story/start`, then receive raw PCM audio over the WebSocket by subscribing to the `story_audio` channel.

### `POST /api/story/configure`

Create or update the bedtime story configuration that powers personalized beats.

**Request body:**

```json
{
  "childName": "Luna",
  "childAge": 6,
  "learningGoals": ["counting to 5", "sharing"],
  "campaignId": 1
}
```

**Response (200):**

```json
{
  "campaignId": 1,
  "childName": "Luna",
  "childAge": 6,
  "learningGoals": ["counting to 5", "sharing"],
  "storyEnergy": 1,
  "createdAt": 1709765432000,
  "updatedAt": 1709765432000
}
```

**Errors:** `400` — Missing/invalid `childName` or `childAge`. `404` — Campaign not found.

### `POST /api/story/start`

Starts a Lyria RealTime session: opens WebSocket to the music model, sets initial lullaby-style prompts, and begins streaming. Audio is sent to all WebSocket clients that have subscribed to `story_audio`.

**Request body (optional):** `{ "themeDescription": "string" }` — User’s voice or text (e.g. “bedtime story in the forest”, “under the sea”). Server uses Gemini to extract a theme key and applies it to music.

**Response (200):** `{ "ok": true, "message": "Bedtime story session started", "userTheme": "magical forest" }` — `userTheme` is present when `themeDescription` was sent and extraction succeeded.

**Errors:** `503` — Lyria RealTime failed (e.g. missing `GEMINI_API_KEY` or quota).

### `POST /api/story/set-theme`

Set the story theme from the user’s voice or text description. If a story session is active, music is updated to match. **Request body:** `{ "themeDescription": "string" }` (required). **Response (200):** `{ "ok": true, "userTheme": "magical forest" }`. **Errors:** `400` — Missing `themeDescription`. `503` — Theme extraction failed.

### `POST /api/music/update`

Updates the music prompts for the active story session (theme/mood/intensity). Call this when the narrative context changes (e.g. every story beat or every 1–2 seconds from a separate pipeline). Updates are throttled: only applied when theme/mood change or intensity delta > 0.15.

**Request body (all optional):** `theme`, `genre`, `mood`, `intensity`, `emotion`.

**Response (200):** `{ "ok": true, "updated": true }` or `{ "ok": true, "skipped": true, "reason": "throttled" }`

**Errors:** `409` — No active story session (call `POST /api/story/start` first).

### `POST /api/story/stop`

Ends the bedtime story session and closes the Lyria RealTime WebSocket. **Response (200):** `{ "ok": true, "message": "Story session stopped" }`

### `GET /api/story/status`

**Response (200):** `{ "active": true, "userTheme": "magical forest" }` or `{ "active": false, "userTheme": null }`. `userTheme` is the theme extracted from the user’s description (set at start or via `POST /api/story/set-theme`).

### `GET /api/story/debug`

Returns Lyria chunk count and session state (for debugging no-audio). **Response (200):** `{ "lyriaChunksReceived": N, "sessionActive": true }` (or `false`).

### `POST /api/story/beat`

Bedtime story beat: Gemini generates narration using the configured child profile, learning goals, stored camera appearances, and current story energy. The backend validates safety, generates an illustration, persists the page, and updates Lyria prompts when a story session is active.

**Request body:** `{ "action": "string", "campaignId": 1 }`

**Response (200):**

```json
{
  "narration": "Luna follows the lantern glow as five sleepy fireflies drift overhead.",
  "scene_prompt": "gentle bedtime illustration ...",
  "image": {
    "imageUrl": "https://... or data:image/png;base64,...",
    "source": "nanobanana"
  },
  "music": {
    "theme": "magical forest",
    "genre": "lullaby",
    "mood": "peaceful",
    "intensity": 0.22,
    "emotion": "sleepy"
  },
  "theme": "magical forest",
  "mood": "peaceful",
  "intensity": 0.22,
  "emotion": "sleepy",
  "learning_moment": "counting to 5",
  "location": "Firefly Path",
  "story_energy": 0.85,
  "event_number": 3
}
```

**Errors:**

- `400` — Missing `action`
- `404` — Campaign not found
- `409` — Story session not configured; call `POST /api/story/configure` first
- `503` — Gemini, image generation, or safety validation failed

### `GET /api/story/export`

Compile persisted bedtime beats into a storybook-friendly payload for frontend rendering.

**Response (200):**

```json
{
  "campaignId": 1,
  "childName": "Luna",
  "learningGoals": ["counting to 5", "sharing"],
  "pages": [
    {
      "narration": "Luna follows the lantern glow...",
      "imageUrl": "https://...",
      "scene_prompt": "gentle bedtime illustration ...",
      "learning_moment": "counting to 5"
    }
  ]
}
```

### `POST /api/story/emotion-from-camera`

Send a webcam frame; **Gemini Vision** infers **emotion, mood, and intensity** from face and posture (theme comes from the user’s description, not the image). When a story session is active and `updateMusic` is true, the backend updates Lyria using the session’s **userTheme** + camera-derived emotion/mood/intensity.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `frame` | string | ✓ | Base64-encoded image (JPEG/PNG) or data URL from webcam. |
| `updateMusic` | boolean | | If `true` and a story session is active, applies session theme + detected emotion/mood/intensity to Lyria (same throttling as `POST /api/music/update`). Default: false. |

**Response (200):**

```json
{
  "emotion": "calm",
  "mood": "peaceful",
  "theme": "magical forest",
  "intensity": 0.3,
  "musicUpdated": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `emotion` | string | One of: sleepy, happy, excited, sad, neutral, calm, scared, curious, peaceful. |
| `mood` | string | One of: calm, peaceful, sleepy, gentle, dreamy, tense, sad, happy. |
| `theme` | string | Session’s user theme (from user description at start or set-theme), or `"bedtime"` if none set. |
| `intensity` | number | 0–1 (from camera). |
| `musicUpdated` | boolean | `true` if Lyria was updated this request (throttling may skip updates). |

**Errors:**

- `400` — Missing `frame`: `{ "error": "frame is required (base64 encoded image)" }`
- `503` — Gemini not configured or vision failed: `{ "error": "Emotion analysis failed", "details": "..." }`

**Frontend flow:** Call `POST /api/story/configure` first to save `childName`, `childAge`, and `learningGoals`. Set theme from user voice/text via `POST /api/story/start` (body: `themeDescription`) or `POST /api/story/set-theme`. Start story session → (optional) get user media → every 3–4 s capture frame → POST to emotion-from-camera with `updateMusic: true` → call `POST /api/story/beat` for each story turn → render `GET /api/story/export` as a storybook gallery at the end.

### WebSocket: story audio

Subscribe by sending **once the socket is open** (and again before start if reusing a connection):

```json
{ "type": "subscribe", "channel": "story_audio" }
```

The server accepts both string and Buffer WebSocket frames. After subscribing, wait ~500 ms then call `POST /api/story/start` so the server has at least one subscriber before starting Lyria.

**Messages from server:**

- **`audio_chunk`** — `{ "type": "audio_chunk", "payload": "<base64 PCM>", "sampleRate": 48000, "channels": 2 }`. Decode payload as 16-bit PCM, 48 kHz stereo; play via Web Audio API (queue chunks to avoid gaps).
- **`music_session_ended`** — `{ "type": "music_session_ended" }` when the session has stopped.

### WebSocket: LiveKit pipeline events

The server broadcasts the following JSON messages to all connected clients when the real-time video pipeline is used (story session + LiveKit). Use them to drive UI (e.g. “Camera live”, “2 people on stage”) and to know when to subscribe to the egress track.

| Type | Payload | When sent |
|------|---------|-----------|
| `livekit_room_ready` | `{ roomName, campaignId }` | After story session starts; client can join room and request token. |
| `livekit_ingest_active` | `{ roomName, hasVideo: true }` | When the server learns a video track was published (client calls `POST /api/livekit/ingest-started` after publishing). |
| `stage_vision_tick` | `{ people_count, new_entrant, setting? }` | Each time the vision worker runs on a frame (throttled). |
| `character_injection` | `{ narration, scene_prompt, imageUrl?, new_entrant_description }` | New person detected (e.g. judge); same as from `POST /api/story/stage-vision`. |
| `v2v_prompt_updated` | `{ prompt }` | V2V scene prompt changed (e.g. after character injection). |
| `livekit_egress_active` | `{ roomName, trackName? }` | Server started publishing the transformed “story” video track. |

---

## WebSocket

Connect to `ws://localhost:4300` (or `wss://` in production).

**Messages from server:**

When any client sends `POST /api/action`, the server broadcasts to all connected WebSocket clients:

```json
{
  "type": "story_update",
  "narration": "...",
  "narrationAudioUrl": "http://localhost:4300/api/tts?text=...",
  "diceRoll": null,
  "image": { "imageUrl": "...", "source": "nanobanana" },
  "music": { "audioUrl": "...", "mood": "battle", "source": "lyria" },
  "location": "...",
  "music_mood": "battle",
  "elapsed_ms": 3200,
  "event_number": 1
}
```

Same shape as the REST `POST /api/action` response. Use this for real-time updates (e.g. second screen or “someone else acted”) without polling.

---

## End-to-end stage flow (demo checklist)

Use this checklist to verify the full affective bedtime story flow locally (Segment H). Ensure WebSocket is subscribed to `story_audio` **before** calling `POST /api/story/start`.

1. **Theme from voice:** Call `POST /api/story/set-theme` with `{ "themeDescription": "bedtime story in the forest" }` (or start with `themeDescription` in `POST /api/story/start`). Confirm response includes a theme (e.g. `magical forest`).
2. **Start session:** Call `POST /api/story/start`. Confirm Lyria PCM chunks arrive on the WebSocket (`audio_chunk` messages) and music plays.
3. **Narration:** Call `POST /api/story/beat` with `{ "action": "The hero finds a cozy cave" }`. Confirm `narration`, `scene_prompt`, and optional `narrationAudioUrl` / `language`.
4. **Yawn to music:** Send a camera frame (or `POST /api/music/update` with `{ "detected_events": ["yawn"] }`). Confirm music softens (lullaby / lower BPM).
5. **Laugh to music:** Send `POST /api/music/update` with `{ "detected_events": ["laugh"] }`. Confirm music becomes brighter.
6. **Doll as protagonist:** Call `POST /api/story/detect-object` with a frame containing a toy; then `POST /api/story/set-protagonist` with the returned `protagonist_description`; then `POST /api/story/beat`. Confirm narration and `scene_prompt` describe the doll as hero.
7. **New person (judge):** Call `POST /api/story/stage-vision` with a frame that has one more person than the previous call. Confirm `new_entrant: true`, `character_beat` with `narration` (and optional `imageUrl`).
8. **Multi-language:** Call `POST /api/story/set-language` with `{ "language": "es" }`; then `POST /api/story/beat`. Confirm `narration` is in Spanish and `narrationAudioUrl` includes `&lang=es`.

**Test scripts (per-segment):** Run `npm run test:gemini` for theme, character-injection, beat+protagonist, beat+language. Vision tests (emotion, stage-vision, object) require a fixture image in `scripts/fixtures/sample.png` or `FIXTURE_IMAGE_BASE64`. If Gemini API quota is exceeded, re-run after the suggested retry window.

---

## Design checklist for real data

- [ ] Call `GET /api/health` on load and use `has_gemini`, `has_vision`, `has_speech`, `has_nanobanana`, `has_lyria`, `has_semantic_memory` to adapt UI (labels, disabled features, or “demo mode”).
- [ ] If `has_vision` is true, offer camera capture for character analysis before starting the story.
- [ ] If `has_speech` is true, show a microphone button for voice input alongside the text field.
- [ ] Show loading state for `POST /api/action` (2–5+ seconds typical).
- [ ] Display `narration` and play `narrationAudioUrl` for voice when desired.
- [ ] Use `image.imageUrl` for the scene image.
- [ ] Use `music.audioUrl` for background music (same-origin); handle Lyria’s first-load delay (e.g. keep previous track or show “Loading music…”).
- [ ] On load, call `GET /api/campaign` to show event count, recent events, locations, and characters (persisted).
- [ ] On load, call `GET /api/camera/profiles` to restore any previously captured character profiles.
- [ ] Support optional `campaignId` in action and campaign endpoints if you add multi-campaign UI.
- [ ] Handle 400/404/500 with user-friendly messages.
- [ ] Optionally connect to the WebSocket and handle `type: "story_update"` for real-time story updates.
- [ ] **Bedtime story:** Subscribe to `story_audio` **before** calling `POST /api/story/start`; decode `audio_chunk.payload` (base64 → Int16, 48 kHz stereo) and play with Web Audio API. See [FRONTEND.md](./FRONTEND.md) for integration steps.
- [ ] **Bedtime personalization:** Save the child profile with `POST /api/story/configure` before the first bedtime beat.
- [ ] **Storybook export:** Use `GET /api/story/export` to render the final page gallery with narration and illustrations.

---

## Quick reference

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/health` | Status and real-data flags |
| POST | `/api/action` | Send action, get narration + image + music |
| POST | `/api/camera/analyze` | Analyze webcam frame for character appearances |
| POST | `/api/camera/pair` | Generate phone camera pairing code |
| GET | `/api/camera/pair/:code` | Validate pairing code |
| POST | `/api/camera/remote/:code` | Phone sends frame via pairing code |
| GET | `/api/camera/profiles` | Get stored character profiles |
| POST | `/api/speech/transcribe` | Transcribe audio to text |
| GET | `/api/campaign` | Get campaign state (persisted) |
| POST | `/api/campaign/reset` | Reset campaign |
| GET | `/api/campaigns` | List campaigns |
| POST | `/api/campaigns` | Create campaign |
| GET | `/api/moods` | List music moods |
| POST | `/api/dice` | Dice detection (optional webcam) |
| GET | `/api/audio?url=...` | Music proxy (used by backend) |
| GET | `/api/tts?text=...` | Narration speech (used by backend) |
| GET | `/api/music/generate?mood=...` | Lyria 2 music stream (used by backend) |
| POST | `/api/story/start` | Start bedtime story Lyria RealTime session |
| POST | `/api/story/configure` | Save child profile + learning goals for bedtime mode |
| POST | `/api/story/stop` | Stop story session |
| GET | `/api/story/status` | Whether story session is active + userTheme |
| GET | `/api/story/debug` | Lyria chunk count + session active (debug) |
| POST | `/api/story/set-theme` | Set theme from user voice/text description |
| POST | `/api/story/emotion-from-camera` | Camera frame → Gemini emotion/mood/intensity; theme from session |
| POST | `/api/music/update` | Update theme/mood for adaptive music (story session) |
| POST | `/api/story/beat` | Bedtime story beat (Gemini + optional music update) |
| GET | `/api/story/export` | Export bedtime beats as storybook pages |
| POST | `/api/livekit/token` | LiveKit JWT for room join (publisher or viewer) |
| GET | `/api/livekit/status` | Whether LiveKit is configured |
| POST | `/api/livekit/ingest-started` | Notify server that client published video (triggers `livekit_ingest_active` broadcast) |
| POST | `/api/livekit/vision-frame` | Send frame from stream; run stage vision, character injection, Lyria + V2V prompt update |
| WS | `/` | Real-time `story_update` broadcasts; subscribe `story_audio` for PCM |
