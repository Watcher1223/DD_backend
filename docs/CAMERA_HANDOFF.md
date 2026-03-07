# Multimodal Pipeline — Frontend Handoff

Backend is complete. This doc covers everything needed to integrate the camera (vision) and microphone (speech-to-text) systems on the frontend.

---

## What the backend does

**Camera (vision):**
1. Accepts a base64-encoded webcam frame
2. Sends it to Gemini 2.5 Flash (multimodal)
3. Returns structured character appearance descriptions (hair, clothing, features, age range)
4. Persists profiles in SQLite, keyed by campaign + label (e.g. "child", "adult")
5. Automatically injects stored profiles into the story engine prompt and `scene_prompt` on every `POST /api/action` call

**Microphone (speech-to-text):**
1. Accepts a base64-encoded audio recording
2. Sends it to Gemini 2.5 Flash (multimodal)
3. Returns plain text transcript
4. Frontend uses transcript as typed action text (via `POST /api/action`)

Both use the same Gemini API key and model (`GEMINI_VISION_MODEL`, defaults to `gemini-2.5-flash`). The frontend is responsible for camera/microphone access, capture, and deciding when to send data.

---

## Quick reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Check `has_vision` and `has_speech` before showing UI |
| `/api/camera/analyze` | POST | Send webcam frame, get character descriptions, stores profiles |
| `/api/camera/pair` | POST | Generate a 6-char pairing code (links phone to campaign) |
| `/api/camera/pair/:code` | GET | Validate a pairing code (phone calls this on load) |
| `/api/camera/remote/:code` | POST | Phone sends a frame via pairing code (no campaignId needed) |
| `/api/camera/profiles` | GET | Retrieve stored profiles (restore on reload) |
| `/api/speech/transcribe` | POST | Send audio recording, get text transcript |
| `/api/action` | POST | Send action text (typed or from transcript), profiles auto-injected |

---

## Backend files involved

```
vision/character_analysis.js   — Gemini Vision call, returns structured JSON
ai/transcribe.js               — Gemini audio transcription, returns plain text
utils/media.js                 — Shared MIME type detection for image + audio data URLs
utils/pairing.js               — In-memory pairing code store (phone ↔ campaign link)
ai/parse_json.js               — Shared Gemini JSON response parser
ai/gemini.js                   — Story engine (buildAppearanceContext injects profiles)
routes/camera.js               — Camera endpoints: analyze, pair, remote, profiles
routes/speech.js               — POST /api/speech/transcribe
routes/resolve_campaign.js     — Shared campaign ID resolution
db/index.js                    — session_profiles table, upsert/get/clear helpers
public/phone-camera.html       — Self-contained phone camera capture page
```

---

## Endpoints

### `POST /api/camera/analyze`

Analyze a webcam frame. Stores results and returns them.

**Request:**

```json
{
  "frame": "<base64 string or data URL>",
  "campaignId": 1
}
```

- `frame` (required) — base64-encoded JPEG or PNG. Can include the `data:image/...;base64,` prefix or be raw base64. The backend detects the MIME type automatically.
- `campaignId` (optional) — omit to use the default campaign.

**Response (200):**

```json
{
  "people": [
    {
      "label": "adult",
      "hair": "dark brown, short",
      "clothing": "black hoodie",
      "features": "glasses, beard",
      "age_range": "25-30"
    },
    {
      "label": "child",
      "hair": "blonde, shoulder length",
      "clothing": "red t-shirt",
      "features": "freckles",
      "age_range": "6-8"
    }
  ],
  "setting": "living room, warm lighting, couch visible",
  "stored": 2,
  "elapsed_ms": 1100
}
```

**Errors:**

| Status | Condition | Body |
|--------|-----------|------|
| 400 | Missing `frame` | `{ "error": "frame is required (base64 encoded image)" }` |
| 404 | Invalid `campaignId` | `{ "error": "Campaign not found" }` |
| 503 | No GEMINI_API_KEY or Gemini API failure | `{ "error": "Character analysis failed", "details": "..." }` |
| 500 | Unexpected error | `{ "error": "Character analysis failed", "details": "..." }` |

**Latency:** Expect 500–1500ms per call.

---

### `GET /api/camera/profiles`

Retrieve stored profiles without re-analyzing.

**Query params:** `campaignId` (optional)

**Response (200):**

```json
{
  "profiles": [
    {
      "label": "adult",
      "appearance": {
        "label": "adult",
        "hair": "dark brown, short",
        "clothing": "black hoodie",
        "features": "glasses, beard",
        "age_range": "25-30"
      },
      "updated_at": 1709765432000
    }
  ]
}
```

Returns an empty array if no frames have been analyzed yet: `{ "profiles": [] }`

---

### `GET /api/health`

Check capabilities before showing camera/mic UI.

```json
{
  "has_vision": true,
  "has_speech": true
}
```

Both are true when `GEMINI_API_KEY` is set. If false, hide the respective UI.

---

## How profiles flow into story generation

This happens automatically. No frontend work needed beyond the initial capture.

```
POST /api/camera/analyze        — profiles stored in DB
        ↓
POST /api/action                — backend loads profiles from DB
        ↓
ai/gemini.js generateStoryBeat — appends to prompt:
        |
        |   CHARACTER APPEARANCES (from camera):
        |   - adult, hair: dark brown short, clothing: black hoodie, features: glasses beard, age: 25-30
        |   - child, hair: blonde shoulder length, clothing: red t-shirt, features: freckles, age: 6-8
        |   Include these appearance details in the scene_prompt so generated images match the real people.
        |
        ↓
Gemini includes descriptions in scene_prompt
        ↓
scene_prompt sent to NanoBanana/Imagen for image generation
```

---

## Frontend implementation guide

### Step 1: Check capability

```javascript
const health = await fetch('/api/health').then(r => r.json());
if (!health.has_vision) {
  // Hide camera UI, vision is not available
}
```

### Step 2: Access camera

```javascript
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: 1280, height: 720 },
});
const video = document.createElement('video');
video.srcObject = stream;
video.playsInline = true;
await video.play();
```

### Step 3: Capture a frame

```javascript
function captureFrame(video) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.8);
}
```

The `0.8` quality keeps the payload under ~200KB for a 720p frame, well within the 10MB body limit.

### Step 4: Send to backend

```javascript
async function analyzeFrame(frame, campaignId) {
  const res = await fetch('/api/camera/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame, campaignId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.details || err.error);
  }
  return res.json();
}
```

### Step 5: Display results

The response `people` array is what Gemini saw. Show it to the user so they can confirm before starting the game.

```javascript
const result = await analyzeFrame(captureFrame(video));
// result.people = [{ label: "adult", hair: "...", clothing: "...", ... }]
// result.setting = "living room, warm lighting"
```

### Step 6: Stop camera when done

```javascript
stream.getTracks().forEach(track => track.stop());
```

After this, all subsequent `POST /api/action` calls automatically include the stored profiles. No further camera work needed.

### Step 7: Restore profiles on reload

```javascript
const { profiles } = await fetch('/api/camera/profiles').then(r => r.json());
if (profiles.length > 0) {
  // Show "We remember you" UI with stored appearance data
  // profiles[0].appearance.hair, etc.
}
```

---

## Profile persistence behavior

- Profiles persist in SQLite across server restarts.
- Re-analyzing a frame **overwrites** the profile for the same label (e.g. sending a new frame updates "adult" in place).
- Multiple people with the same role get numbered labels: `child_1`, `child_2`.
- `POST /api/campaign/reset` clears all profiles for that campaign.
- Profiles are scoped to a campaign. Different campaigns have independent profiles.

---

## Recommended UX flow

```
App loads
  → GET /api/health (check has_vision, has_speech)
  → GET /api/camera/profiles (check for existing profiles)
  ↓
If no profiles:
  → Show "Enable camera to personalize your adventure" prompt
  → Two options:
      a) "Use this device's camera" → getUserMedia, show preview
      b) "Use phone camera" → POST /api/camera/pair → show QR code / code
  → Option (a): User clicks "Analyze" → POST /api/camera/analyze
  → Option (b): Phone scans QR → opens phone-camera.html → captures
                 Desktop listens on WS for profiles_updated event
  → Show detected characters for confirmation
  → User clicks "Start adventure"
  ↓
If profiles exist:
  → Show "Welcome back" with stored appearance summary
  → Option to "Re-capture" or "Continue"
  ↓
Game begins
  → Text input field + mic button (if has_speech)
  → User types OR clicks mic → records → POST /api/speech/transcribe → transcript fills text field
  → User confirms/edits → POST /api/action (profiles injected automatically)
```

---

## Testing with curl

Quick test without any frontend:

```bash
# Encode any JPEG to base64
FRAME=$(base64 -i test-photo.jpg)

# Analyze
curl -s http://localhost:4300/api/camera/analyze \
  -H "Content-Type: application/json" \
  -d "{\"frame\": \"$FRAME\"}" | python3 -m json.tool

# Check stored profiles
curl -s http://localhost:4300/api/camera/profiles | python3 -m json.tool
```

---

## Gotchas

1. **Browser permissions** — `getUserMedia` requires HTTPS in production (localhost is exempt). Show a clear permission prompt before calling it.
2. **First frame may be dark** — webcam auto-exposure needs ~500ms. Wait for the video to be playing before capturing, or add a short delay.
3. **Large payloads** — a raw PNG data URL for 1080p can be 3–5MB. Use JPEG at 0.8 quality and 720p to keep it under 200KB.
4. **One capture is enough** — you don't need continuous streaming. A single good frame establishes profiles for the entire session.
5. **Gemini may see things differently each time** — if you re-analyze, the labels or descriptions may shift slightly. The upsert-by-label design handles this, but the UI should let the user confirm.
6. **Empty room** — if no people are visible, `people` will be an empty array and nothing gets stored. Handle this in the UI.
7. **Phone camera requires same network** — the phone must reach the backend server. During local dev, the phone and desktop need to be on the same Wi-Fi network, and the server should listen on `0.0.0.0` (default with Express). Use the machine's LAN IP in the pairing URL, not `localhost`.
8. **Pairing codes expire** — codes are valid for 30 minutes. If the phone page shows "expired", the desktop should generate a new code.
9. **HTTPS on phone** — mobile browsers require HTTPS for `getUserMedia`. During local dev, you can use a tunneling tool (ngrok, Cloudflare Tunnel) or add a self-signed cert. The built-in phone page handles this gracefully by showing an error if camera access fails.

---

## Remote phone camera

The backend supports using a phone as a remote camera when the player is on a desktop. This is useful because desktops may lack a camera, or the phone's camera may be more convenient for capturing the table/players.

### How it works

```
Desktop                          Backend                           Phone
  │                                │                                 │
  │ POST /api/camera/pair          │                                 │
  │ { campaignId: 1 }             │                                 │
  │ ──────────────────────────────>│                                 │
  │ { code: "A7KR3P",             │                                 │
  │   phoneUrl: "http://…" }      │                                 │
  │ <──────────────────────────────│                                 │
  │                                │                                 │
  │  Show code / QR code           │   Phone opens phoneUrl          │
  │                                │ <─────────────────────────────── │
  │                                │  GET /api/camera/pair/A7KR3P    │
  │                                │  → { valid: true }              │
  │                                │ ──────────────────────────────> │
  │                                │                                 │
  │                                │  POST /api/camera/remote/A7KR3P │
  │                                │  { frame: "..." }               │
  │                                │ <─────────────────────────────── │
  │                                │  → analyzes + stores profiles    │
  │                                │  → { people, setting, stored }   │
  │                                │ ──────────────────────────────> │
  │                                │                                 │
  │  WS: { type: "profiles_updated",                                │
  │         source: "phone", ... } │                                 │
  │ <──────────────────────────────│                                 │
  │  Desktop refreshes profiles    │                                 │
```

### `POST /api/camera/pair` — Generate a pairing code

**Request:** `{ "campaignId": 1 }` (optional, defaults to default campaign)

**Response (200):**

```json
{
  "code": "A7KR3P",
  "phoneUrl": "http://192.168.1.5:4300/phone-camera.html?code=A7KR3P",
  "expiresAt": 1709767232000
}
```

The `phoneUrl` is a ready-to-use URL. Display the code for manual entry or encode `phoneUrl` as a QR code for one-tap pairing.

Codes are 6 characters (letters + digits, no ambiguous chars like I/O/0/1). They expire after 30 minutes. Requesting a new code for the same campaign while one is still valid returns the same code.

### `GET /api/camera/pair/:code` — Validate code

The phone page calls this on load to verify the code is valid.

**Response (200):** `{ "valid": true, "campaignId": 1 }`

**Response (404):** `{ "error": "Invalid or expired pairing code" }`

### `POST /api/camera/remote/:code` — Phone sends a frame

Identical to `/api/camera/analyze` but uses the pairing code instead of `campaignId`.

**Request:** `{ "frame": "<base64 or data URL>" }`

**Response (200):** Same as `/api/camera/analyze`.

### Built-in phone camera page

The backend serves a ready-made phone camera page at:

```
/phone-camera.html?code=A7KR3P
```

This page is fully self-contained (no build step, no dependencies). It:

- Validates the pairing code on load
- Opens the rear camera by default
- Has a "Switch Camera" button (front/rear)
- Shows a large capture button
- Sends the frame via `POST /api/camera/remote/:code`
- Displays detected characters on the phone screen
- Works on iOS Safari and Android Chrome

The desktop frontend can use this as-is, or build a custom phone experience — the API endpoints work independently of the built-in page.

### Desktop: generating a QR code

Display the `phoneUrl` as a QR code so users can scan it with their phone camera. Example using `qrcode` npm package (frontend):

```javascript
import QRCode from 'qrcode';

const { code, phoneUrl } = await fetch('/api/camera/pair', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ campaignId }),
}).then(r => r.json());

const qrDataUrl = await QRCode.toDataURL(phoneUrl);
// Render <img src={qrDataUrl} /> and show the code "A7KR3P" as fallback text
```

### Desktop: listening for phone captures via WebSocket

When the phone sends a frame and analysis succeeds, the backend broadcasts a WebSocket message to all connected clients:

```json
{
  "type": "profiles_updated",
  "campaignId": 1,
  "source": "phone",
  "people": [ { "label": "adult", "hair": "...", ... } ],
  "setting": "...",
  "stored": 2
}
```

The `source` field is `"phone"` for remote captures and `"local"` for browser webcam captures.

```javascript
const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'profiles_updated') {
    // Refresh the profile display
    // msg.people has the latest detected characters
    // msg.source tells you where the capture came from
  }
};
```

### Testing with curl

```bash
# 1. Generate a pairing code
curl -s http://localhost:4300/api/camera/pair \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

# 2. Validate it (replace A7KR3P with the actual code)
curl -s http://localhost:4300/api/camera/pair/A7KR3P | python3 -m json.tool

# 3. Send a frame via the code
FRAME=$(base64 -i test-photo.jpg)
curl -s http://localhost:4300/api/camera/remote/A7KR3P \
  -H "Content-Type: application/json" \
  -d "{\"frame\": \"$FRAME\"}" | python3 -m json.tool
```

---

## Speech-to-text (same multimodal system)

The backend also provides speech transcription via Gemini, using the same API key and multimodal pattern as the camera pipeline. This enables voice input alongside typed actions.

### Endpoint: `POST /api/speech/transcribe`

**Request:** `{ "audio": "<base64 string or data URL>" }`

**Response:** `{ "transcript": "I open the chest", "elapsed_ms": 850 }`

Supports `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/wav`. The MIME type is auto-detected from the data URL prefix, defaulting to `audio/webm` for raw base64.

### Frontend recording pattern

```javascript
// 1. Get microphone access
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// 2. Set up MediaRecorder
const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
const chunks = [];

mediaRecorder.ondataavailable = (e) => {
  if (e.data.size > 0) chunks.push(e.data);
};

// 3. When recording stops, send to backend
mediaRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: 'audio/webm' });
  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64 = reader.result; // includes data:audio/webm;base64, prefix
    const res = await fetch('/api/speech/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64 }),
    });
    const { transcript } = await res.json();
    // Display transcript in the action text field
  };
  reader.readAsDataURL(blob);
};

// 4. Start/stop recording
mediaRecorder.start();
// ... user clicks stop ...
mediaRecorder.stop();

// 5. Clean up when done
stream.getTracks().forEach(track => track.stop());
```

### Integration with the action flow

The transcript is just text. Submit it as the `action` field to `POST /api/action`:

```javascript
const { transcript } = await transcribeAudio(audioBase64);
// Optionally show in text field for user to edit
// Then submit:
await fetch('/api/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: transcript }),
});
```

### Health check

```javascript
const health = await fetch('/api/health').then(r => r.json());
if (health.has_speech) {
  // Show microphone button
}
```

### Testing with curl

```bash
# Record a short WAV (macOS)
# or use any audio file you have
AUDIO=$(base64 -i test-audio.wav)

curl -s http://localhost:4300/api/speech/transcribe \
  -H "Content-Type: application/json" \
  -d "{\"audio\": \"$AUDIO\"}" | python3 -m json.tool
```
