# Living Worlds — Frontend API Documentation

Backend API and real-data contract for the Living Worlds AI Dungeon Master frontend. The backend uses **real data**: persisted campaign state (SQLite), Gemini (story), NanoBanana 2 or Vertex Imagen (images), and Vertex Lyria 2 or presets (music).

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
  "has_nanobanana": true,
  "has_lyria": true
}
```

| Field | Type | Meaning |
|-------|------|--------|
| `status` | string | Always `"ok"` when the server is up. |
| `campaign_events` | number | Event count for the default campaign (persisted in DB). |
| `has_gemini` | boolean | `true` = Gemini configured for story. `false` = action will return 503 until GEMINI_API_KEY is set. |
| `has_vision` | boolean | `true` = Camera character analysis available (uses same Gemini key). `false` = camera endpoints will return 503. |
| `has_nanobanana` | boolean | `true` = NanoBanana or Vertex Imagen available for images. `false` = action will fail for image until configured. |
| `has_lyria` | boolean | `true` = Vertex Lyria 2 available for music. `false` = music will return 502 until GOOGLE_CLOUD_PROJECT + billing. |

**Frontend recommendations:**

- If `has_gemini` is false, actions will return 503; show “Configure Gemini API” or disable the action button.
- If `has_nanobanana` is false, scene image may fail (503) until NanoBanana or Imagen is configured.
- If `has_lyria` is false, music URLs will return 502; hide or disable music or show “Music unavailable”.
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

Returns Lyria 2 WAV stream when Lyria is configured. Used for `music.audioUrl` when `music.source === "lyria"`.

---

## Bedtime story mode

Bedtime story uses **Lyria RealTime** (Gemini API `lyria-realtime-exp`) for **continuous** adaptive music. Music never stops; it only changes when theme/mood/intensity signals are sent via `POST /api/music/update`. Start a session with `POST /api/story/start`, then receive raw PCM audio over the WebSocket by subscribing to the `story_audio` channel.

### `POST /api/story/start`

Starts a Lyria RealTime session: opens WebSocket to the music model, sets initial lullaby-style prompts, and begins streaming. Audio is sent to all WebSocket clients that have subscribed to `story_audio`.

**Response (200):** `{ "ok": true, "message": "Bedtime story session started" }`

**Errors:** `503` — Lyria RealTime failed (e.g. missing `GEMINI_API_KEY` or quota).

### `POST /api/music/update`

Updates the music prompts for the active story session (theme/mood/intensity). Call this when the narrative context changes (e.g. every story beat or every 1–2 seconds from a separate pipeline). Updates are throttled: only applied when theme/mood change or intensity delta > 0.15.

**Request body (all optional):** `theme`, `genre`, `mood`, `intensity`, `emotion`.

**Response (200):** `{ "ok": true, "updated": true }` or `{ "ok": true, "skipped": true, "reason": "throttled" }`

**Errors:** `409` — No active story session (call `POST /api/story/start` first).

### `POST /api/story/stop`

Ends the bedtime story session and closes the Lyria RealTime WebSocket. **Response (200):** `{ "ok": true, "message": "Story session stopped" }`

### `GET /api/story/status`

**Response (200):** `{ "active": true }` or `{ "active": false }`

### `POST /api/story/beat`

Bedtime story beat: Gemini generates narration + theme/mood/emotion; state is persisted; if a story session is active, music prompts are updated. **Body:** `{ "action": "string" }` (required), optional `campaignId`. **Response:** `narration`, `scene_prompt`, `theme`, `mood`, `intensity`, `emotion`, `location`, `event_number`.

### WebSocket: story audio

Subscribe by sending `{ "type": "subscribe", "channel": "story_audio" }`. Server sends `{ "type": "audio_chunk", "payload": "<base64 PCM>", "sampleRate": 48000, "channels": 2 }` and optionally `{ "type": "music_session_ended" }`. Decode payload as 16-bit PCM, 48 kHz stereo; play via Web Audio API.

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

## Design checklist for real data

- [ ] Call `GET /api/health` on load and use `has_gemini`, `has_vision`, `has_nanobanana`, `has_lyria` to adapt UI (labels, disabled features, or “demo mode”).
- [ ] If `has_vision` is true, offer camera capture for character analysis before starting the story.
- [ ] Show loading state for `POST /api/action` (2–5+ seconds typical).
- [ ] Display `narration` and play `narrationAudioUrl` for voice when desired.
- [ ] Use `image.imageUrl` for the scene image.
- [ ] Use `music.audioUrl` for background music (same-origin); handle Lyria’s first-load delay (e.g. keep previous track or show “Loading music…”).
- [ ] On load, call `GET /api/campaign` to show event count, recent events, locations, and characters (persisted).
- [ ] On load, call `GET /api/camera/profiles` to restore any previously captured character profiles.
- [ ] Support optional `campaignId` in action and campaign endpoints if you add multi-campaign UI.
- [ ] Handle 400/404/500 with user-friendly messages.
- [ ] Optionally connect to the WebSocket and handle `type: "story_update"` for real-time story updates.

---

## Quick reference

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/health` | Status and real-data flags |
| POST | `/api/action` | Send action, get narration + image + music |
| POST | `/api/camera/analyze` | Analyze webcam frame for character appearances |
| GET | `/api/camera/profiles` | Get stored character profiles |
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
| POST | `/api/story/stop` | Stop story session |
| GET | `/api/story/status` | Whether story session is active |
| POST | `/api/music/update` | Update theme/mood for adaptive music (story session) |
| POST | `/api/story/beat` | Bedtime story beat (Gemini + optional music update) |
| WS | `/` | Real-time `story_update` broadcasts; subscribe `story_audio` for PCM |
