# Camera-to-Gemini Vision Pipeline — Frontend Handoff

Backend is complete. This doc covers everything needed to integrate the camera system on the frontend.

---

## What the backend does

1. Accepts a base64-encoded webcam frame
2. Sends it to Gemini Vision (gemini-2.0-flash multimodal)
3. Returns structured character appearance descriptions (hair, clothing, features, age range)
4. Persists profiles in SQLite, keyed by campaign + label (e.g. "child", "adult")
5. Automatically injects stored profiles into the story engine prompt and `scene_prompt` on every `POST /api/action` call

The frontend is responsible for camera access, frame capture, and deciding when to send frames.

---

## Backend files involved

```
vision/character_analysis.js   — Gemini Vision call, returns structured JSON
vision/frame_utils.js          — Shared MIME type detection for base64 frames
ai/parse_json.js               — Shared Gemini JSON response parser
ai/gemini.js                   — Story engine (buildAppearanceContext injects profiles)
routes/camera.js               — POST /api/camera/analyze, GET /api/camera/profiles
routes/resolve_campaign.js     — Shared campaign ID resolution
db/index.js                    — session_profiles table, upsert/get/clear helpers
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

Check if vision is available before showing camera UI.

```json
{
  "has_vision": true
}
```

`has_vision` is true when `GEMINI_API_KEY` is set. If false, don't show the camera capture flow.

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
  → GET /api/health (check has_vision)
  → GET /api/camera/profiles (check for existing profiles)
  ↓
If no profiles:
  → Show "Enable camera to personalize your adventure" prompt
  → User clicks "Capture"
  → getUserMedia, show preview
  → User clicks "Analyze" (or auto-capture after 2 sec)
  → POST /api/camera/analyze
  → Show detected characters for confirmation
  → User clicks "Start adventure"
  ↓
If profiles exist:
  → Show "Welcome back" with stored appearance summary
  → Option to "Re-capture" or "Continue"
  ↓
Game begins
  → POST /api/action (profiles injected automatically)
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
