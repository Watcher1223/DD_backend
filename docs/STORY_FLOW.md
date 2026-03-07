# End-to-end story flow: judge, theme, video, Swahili

This document describes the intended **bedtime story** experience and how it maps to the backend. Use it to wire the frontend (or LiveKit/agent pipeline) so that:

1. The **judge** speaks the theme (e.g. “forest story”, “city story”) and the setting is generated in real time.
2. The **user’s image** and the **doll as protagonist** are rendered into the story.
3. **Ethan** (the narrator) tells the story while images are generated and presented as a continuous **video** (sequence of narration + scene images).
4. When the **judge walks onto the stage**, their face and clothing are rendered into the story.
5. When the **user speaks in Swahili** (or another language), the story **continues in that language**.

---

## 1. Judge speaks the theme

**Flow:** Judge says something like “forest story” or “city story” → that becomes the setting.

**Backend:**

- **Speech → text:** `POST /api/speech/transcribe` with body `{ audio: "<base64>" }` → returns `{ transcript }`.
- **Theme from text:** Send the transcript to **`POST /api/story/set-theme`** with `{ themeDescription: transcript }`, or include it in **`POST /api/story/start`** as `{ themeDescription: transcript }`. The server uses Gemini to map the phrase to a theme key (e.g. “magical forest”, “city adventure”) and uses it for music and scene prompts.

**Frontend / agent:** Capture judge’s voice → transcribe → set-theme (or start with that theme). The setting is then used for all subsequent beats and Lyria.

---

## 2. Real-time setting + user image + doll as protagonist

**Flow:** As you render, the user’s image and the doll are part of the story; the setting is driven by the theme.

**Backend:**

- **Theme:** From step 1 (set-theme / start).
- **User’s face in images:** Before or when the user is on camera, send a frame to **`POST /api/camera/analyze`**. That stores their face as a **reference** for Imagen subject customization. When a character card or story scene is generated with reference frames, the backend uses that likeness (when Vertex Imagen customization is configured).
- **Doll as protagonist:** Send a frame that shows the doll to **`POST /api/story/detect-object`**; then **`POST /api/story/set-protagonist`** with the returned `protagonist_description`. Alternatively use Overshoot with an object prompt and **`POST /api/story/vision-object`** with the result. After that, every **`POST /api/story/beat`** uses that protagonist in the narration and scene prompts.

**Frontend / agent:** Once the session is started, call camera/analyze with the user’s frame, and either detect-object + set-protagonist or vision-object for the doll. Then request beats; the setting comes from the theme and the protagonist from the session.

---

## 3. Ethan narrates + images as “video”

**Flow:** Ethan (the narrator) tells the story while the agent renders images in real time; the client presents this as a **video** (audio + sequence of images).

**Backend:**

- Each **`POST /api/story/beat`** returns:
  - **`narration`** — next piece of story text.
  - **`narrationAudioUrl`** — same-origin TTS URL for that narration (Ethan’s voice).
  - **`image.imageUrl`** — scene image for that beat.

**Frontend / agent:** For each “frame” of the “video”:

1. Call **`POST /api/story/beat`** with `{ action: "what happens next" }` (or the user’s request).
2. Play **`narrationAudioUrl`** (Ethan narrating).
3. Show **`image.imageUrl`** (and optionally keep the previous image visible until the next one is ready).

To make it feel like a continuous video, request the next beat when the previous narration finishes (or after a short delay), and queue images so they appear in order. The **music** is already streaming via Lyria over WebSocket; the “video” is the stream of (narration audio + scene image) pairs.

---

## 4. Judge walks onto the stage → face and clothing in the story

**Flow:** When the judge enters the stage, their face and clothing are rendered into the story (e.g. as a character card or in a scene).

**Backend:**

- **Store judge’s face:** When the judge is visible, send a frame to **`POST /api/camera/analyze`** so their face (and description) are stored as reference frames for the campaign.
- **Detect new person:** Send frames to **`POST /api/story/stage-vision`** with `generateImage: true`. When the backend detects a **new entrant** (e.g. people count 0 → 1, or a new person), it:
  - Generates a **character-injection beat** (narration + scene_prompt).
  - Generates a **character card image** using **reference frames** (so the judge’s face can appear when Imagen subject customization is configured).
- The same reference is used for **story beat images** when you call **`POST /api/story/beat`** (the backend uses `getReferenceFrames(campaignId)` for scene images).

**Frontend / agent:** Run camera/analyze when the judge is on camera (so their face is in the reference store). Run stage-vision periodically; when the response has `new_entrant: true` and `imageUrl`, show the character card and narration. Subsequent beats can then include that character in scenes.

---

## 5. User speaks in Swahili → story continues in Swahili

**Flow:** The user speaks in Swahili (or another language); the system continues the story in that language.

**Backend:**

- **Option A — Explicit phrase:** User says “continue in Swahili” (or types it). The **action** text is sent to **`POST /api/story/beat`**. The backend **infers language** from the action (e.g. “in Swahili” → `sw`) and uses it for that beat and for TTS; the session language is updated so the next beats stay in Swahili until the user asks for another language.
- **Option B — Speak in Swahili:** User speaks in Swahili. Use **`POST /api/speech/transcribe`** with body `{ audio: "<base64>", detectLanguage: true }` to get **`{ transcript, detectedLanguage }`** (e.g. `detectedLanguage: "sw"`). Then:
  - Call **`POST /api/story/set-language`** with `{ language: detectedLanguage }`.
  - Call **`POST /api/story/beat`** with `{ action: transcript }`. The narration and TTS will be in that language.

**Frontend / agent:** For voice-driven language switch: record user speech → transcribe with language detection → set-language (if detected) → beat with action = transcript.

---

## API quick reference for this flow

| Step | Endpoint | Purpose |
|------|----------|---------|
| Judge theme | `POST /api/speech/transcribe` | Speech → text |
| | `POST /api/story/set-theme` or `POST /api/story/start` | themeDescription from transcript |
| User/doll in story | `POST /api/camera/analyze` | Store face for images |
| | `POST /api/story/detect-object` + `POST /api/story/set-protagonist` | Or `POST /api/story/vision-object` (Overshoot) |
| Narrator + “video” | `POST /api/story/beat` | narration + narrationAudioUrl + image per “frame” |
| Judge on stage | `POST /api/camera/analyze` (when judge visible) | Store judge’s face |
| | `POST /api/story/stage-vision` (generateImage: true) | New entrant → character card with face |
| Swahili / language | `POST /api/speech/transcribe` (body: `{ audio, detectLanguage: true }`) | transcript + detectedLanguage |
| | `POST /api/story/set-language` | Set story language |
| | `POST /api/story/beat` with action (or “continue in Swahili”) | Narration + TTS in that language |

---

## Optional: continuous “video” mode

To make the story feel like one continuous video (Ethan speaking + images updating in real time), the client can:

1. Start the session and set theme (steps 1–2).
2. Request the first beat with a generic action (e.g. “Begin the story”).
3. When narration audio ends (or on a timer), request the next beat with an action like “What happens next?” or use the last narration to derive a follow-up (or let the backend use story memory). Repeat.
4. Display each beat’s image as the “current frame” and queue the next so transitions are smooth.

The backend does not yet provide a single “streaming story” endpoint; the “video” is assembled client-side from the sequence of beat responses (narration + image) plus the continuous Lyria music stream.
