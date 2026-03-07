# Face Customization — Frontend Handoff

The backend now supports **personalized image generation**: the player's actual face appears as the character in every generated story image. This doc covers exactly what the frontend needs to implement.

---

## TL;DR

1. Check `GET /api/health` for `has_subject_customization: true`
2. Show a "Scan your face" step **before** the story starts
3. Call `POST /api/camera/analyze` with a webcam frame (1-3 times)
4. Proceed to story — all images now use the player's face automatically

**If step 2-3 is skipped, images will show generic characters.** Nothing else changes in the story flow.

---

## How it works (backend)

```
Camera frame (base64)
    │
    ▼
POST /api/camera/analyze
    │
    ├─ Gemini Vision extracts appearance
    │  (hair, skin_tone, features, clothing, character_description)
    │
    ├─ Stores appearance profile in SQLite (for prompt injection)
    │
    └─ Stores raw frame in reference store (up to 4 frames per campaign)
        │
        ▼
POST /api/action  or  POST /api/story/beat
    │
    ├─ Gemini generates narration + scene_prompt
    │  (now instructed to feature the character prominently)
    │
    ├─ Backend checks: reference frames exist?
    │   │
    │   YES → Imagen 3 Subject Customization
    │   │     Uses player's face + face mesh control
    │   │     Returns image.source = "imagen_custom"
    │   │
    │   NO  → Text-only Imagen or NanoBanana
    │         Returns image.source = "imagen" or "nanobanana"
    │         (generic character)
    │
    └─ Returns image in response (same format as before)
```

No changes needed in how you handle the response. The `image.imageUrl` and `image.source` fields work exactly as before — the only new source value is `"imagen_custom"`.

---

## What the frontend needs to do

### 1. Check health for the feature flag

```javascript
const health = await fetch('/api/health').then(r => r.json());

if (health.has_subject_customization) {
  // Show camera scan step before story
} else {
  // Skip camera, proceed directly to story (generic characters)
}
```

### 2. Add a "Scan your face" onboarding step

This must happen **before** the first `POST /api/action` or `POST /api/story/beat`. Show a camera preview and capture 1-3 frames.

```javascript
// Get webcam stream
const stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
});

// Capture a frame
const video = document.querySelector('video');
video.srcObject = stream;
const canvas = document.createElement('canvas');
canvas.width = video.videoWidth;
canvas.height = video.videoHeight;
canvas.getContext('2d').drawImage(video, 0, 0);
const frame = canvas.toDataURL('image/jpeg', 0.8);

// Send to backend
const result = await fetch('/api/camera/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ frame })
}).then(r => r.json());

// Show confirmation to user
// result.people[0] has: label, fantasy_name, character_description, hair, clothing, features, skin_tone, age_range
console.log(`Detected: ${result.people[0]?.character_description}`);
// e.g. "A warm-eyed young man with tousled dark hair and an easy smile"
```

### 3. Best practices for frame capture

| Tip | Why |
|-----|-----|
| Face should be **front-facing** and **well-lit** | Side profiles and shadows reduce likeness accuracy |
| Send **2-3 frames** from slightly different angles | More reference images = better likeness matching |
| Capture at **640x480** or higher | Too small = blurry face = poor results |
| Use **JPEG** with quality 0.8 | Keeps payload reasonable (~50-100KB per frame) |
| Stop the camera stream after capture | Don't waste battery/resources during the story |

### 4. No changes to story flow

After the camera scan, the story endpoints work exactly as before:

```javascript
// D&D mode — no changes needed
const beat = await fetch('/api/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'I enter the tavern' })
}).then(r => r.json());

// Bedtime mode — no changes needed
const storyBeat = await fetch('/api/story/beat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'The hero finds a cozy cave', campaignId: 1 })
}).then(r => r.json());

// Image works the same — just check source if you want to show a badge
beat.image.imageUrl;   // data:image/png;base64,... (same as before)
beat.image.source;     // "imagen_custom" | "imagen" | "nanobanana"
```

---

## Camera analyze response (updated fields)

```json
{
  "people": [
    {
      "label": "adult",
      "fantasy_name": "Thornwood",
      "character_description": "A warm-eyed young man with tousled dark hair and an easy smile",
      "hair": "dark brown, medium length, styled with volume on top",
      "clothing": "dark grey hooded sweatshirt with 'LEARN SWIM' text",
      "features": "white wireless earbud in right ear",
      "skin_tone": "medium",
      "age_range": "20-25"
    }
  ],
  "setting": "bedroom, dim lighting",
  "stored": 1,
  "elapsed_ms": 1200
}
```

New fields (compared to before):
- `fantasy_name` — storybook character name (used in narration)
- `character_description` — rich one-sentence description (used for image generation subject description)
- `skin_tone` — skin tone (improves likeness matching)

---

## Image source values

| `image.source` | What it means | Character quality |
|----------------|---------------|-------------------|
| `imagen_custom` | Imagen 3 Subject Customization with face mesh | Player's actual face |
| `nanobanana` | NanoBanana text-only | Generic character |
| `imagen` | Vertex Imagen text-only | Generic character |

You can optionally show a small badge like "Personalized" when `source === "imagen_custom"`.

---

## Recommended UI flow

```
┌─────────────────────────────────┐
│         App Launch              │
│  GET /api/health                │
│  has_subject_customization?     │
└──────────┬──────────────────────┘
           │
     ┌─────┴─────┐
     │   true     │   false
     ▼            ▼
┌──────────┐  ┌──────────────┐
│ Face Scan │  │ Skip to      │
│ Screen    │  │ Story Setup  │
│           │  └──────────────┘
│ "Let's   │
│  see who │
│  our hero│
│  is!"    │
│           │
│ [Camera]  │
│           │
│ Capture   │
│ 1-3 frames│
│ POST each │
│ to /api/  │
│ camera/   │
│ analyze   │
│           │
│ Show:     │
│ "We see   │
│ Thornwood,│
│ a warm-   │
│ eyed..."  │
│           │
│ [Continue]│
└─────┬─────┘
      │
      ▼
┌──────────────┐
│ Story Setup  │
│ (configure,  │
│  set theme,  │
│  start)      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Story Beats  │
│ Images now   │
│ show player's│
│ face as the  │
│ character    │
└──────────────┘
```

---

## Campaign reset

When the campaign is reset (`POST /api/campaign/reset`), reference frames are cleared along with everything else. The user will need to scan again for the next session.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Images show generic characters | No camera scan was done before the story beat | Call `POST /api/camera/analyze` before the first beat |
| `image.source` is `"imagen"` not `"imagen_custom"` | Reference frames missing or customization failed | Check that camera/analyze was called and returned `stored >= 1` |
| `has_subject_customization` is `false` | `GOOGLE_CLOUD_PROJECT` not set in backend `.env` | Backend team needs to configure Vertex AI project |
| Camera analyze returns empty `people` array | No face detected in frame | Ensure face is visible, well-lit, and front-facing |
| Image looks like a different person | Reference frame was low quality (blurry, side-profile, dark) | Re-scan with better lighting and a front-facing pose |

---

## What you DON'T need to change

- Response format for `POST /api/action` and `POST /api/story/beat` — same as before
- How you display `image.imageUrl` — same as before
- How you play narration audio — same as before
- How you handle music — same as before
- WebSocket events — same as before

The only frontend change is adding the camera scan step before the story starts.
