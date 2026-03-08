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

### How the frontend should send the doll (and is it just from the camera?)

**Yes — the doll is recognized from the camera**, but via a **separate flow** from the one used for people/faces:

- **People/faces** use **`POST /api/camera/analyze`** (and stage-vision). Those frames are used to store faces and detect new entrants as **stage characters**.
- **The doll** uses **`POST /api/story/detect-object`** (or **`POST /api/story/vision-object`** with a text description). The backend does **not** auto-detect the doll from the same analyze frames; the frontend must explicitly send a frame (or a vision result) for the doll and then set the protagonist.

**Two ways to send the doll:**

1. **Same camera, dedicated “doll” flow (recommended)**  
   - Point the camera at the doll (or show the doll in frame).  
   - Capture a frame (e.g. from the same `<video>` as the user’s camera).  
   - **POST** that frame to **`POST /api/story/detect-object`** with body `{ frame: "<data URL or base64>" }`.  
   - Response includes `objects` (list of detected toys) and **`protagonist_description`** (e.g. `"small brown bear with red shirt"`).  
   - Call **`POST /api/story/set-protagonist`** with body `{ protagonist_description: "<that string>" }`.  
   - From then on, every **`POST /api/story/beat`** uses the doll as the story’s **hero** (main character) in narration and scene prompts. You can run detect-object once when the user “selects” the doll, or periodically (e.g. every 5–10 s) and set-protagonist when the description changes.

2. **External vision (e.g. Overshoot)**  
   - Use a vision service with a prompt like “Describe any toy, doll, or stuffed animal in a few words, or say ‘no toy’.”  
   - Send the **text** result to **`POST /api/story/vision-object`** with body `{ text: "small brown bear" }`.  
   - The backend sets the protagonist from that text; if the text is “no toy” / “none”, it clears the protagonist.

**Difference from “characters”:**  
The doll is the **story protagonist** (the hero the story is about), not a **stage character** like people who join. Stage characters (people who enter the frame or join via QR) get a character-injection beat and are added to `stageCharacters`; the doll is a single session field (`protagonist_description`) and is woven into every beat as the main character. So the doll is “added to the story” as the hero; it is not added as an extra character card like a new person.

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

---

### Frontend: making beat-by-beat feel like continuous video

The backend returns **one image per beat**; each beat can take 10–30 seconds (narration + scene image). To avoid the "image by image" stall and make it feel more like a continuous video:

1. **Keep the previous image on screen** — Do not replace the main view with a full-screen "Creating scene..." spinner. Keep the **last scene image** visible until the next one is ready. If you show a loading state, use a small overlay (e.g. "Drawing next scene…") or a subtle indicator so the story doesn't feel frozen.

2. **Prefetch the next beat** — As soon as the current beat's **narration starts playing** (or when "Auto" is on), **request the next beat** in the background with `action: "What happens next?"`. By the time the current narration ends, the next image may already be ready (or close), so the gap between scenes is shorter. Queue responses by beat order so you always show the correct next image.

3. **Play narration as soon as you have it** — When the next beat response arrives, start playing **`narrationAudioUrl`** immediately. Swap in the new **`image.imageUrl`** when it's loaded (or keep showing the previous image until the new one is ready). That way the story keeps moving even if the image loads a bit later.

4. **Auto-continue** — When the current narration **ends**, if you already have the next beat (from prefetch), show its image and play its narration without another wait. If you don't have it yet, show a brief "Next scene…" on top of the current image and then transition when the response arrives.

5. **Avoid blocking the whole UI** — Use a non-blocking loading state (e.g. small spinner or text near the bottom, or a dimmed overlay that still shows the previous frame) instead of "Creating scene... This may take 10-30 seconds" as the only content. Shorter copy like "Drawing next scene…" or "Loading…" helps the wait feel shorter.

With prefetch + keep previous image visible + auto-continue, the flow becomes: scene 1 visible → narration 1 plays → (prefetch beat 2) → narration 2 starts (scene 2 may already be ready or loading) → scene 2 appears → repeat. The backend stays one-image-per-beat; the frontend makes it feel continuous.

---

## Real-time video and new characters: backend behavior and frontend integration

### Does the backend generate video in real time with the user and detect new characters?

**Short answers:**

- **Video:** The backend does **not** stream a single video file. It generates **one image per story beat** (each **`POST /api/story/beat`** returns one `image` + `narration` + `narrationAudioUrl`). “Video” in this app = the frontend showing that sequence (image 1 + play narration 1 → image 2 + play narration 2 → …), optionally with auto-continue so the next beat is requested when the previous narration ends.
- **User in the story:** The user’s face appears in those images only when (1) the frontend has sent at least one frame to **`POST /api/camera/analyze`** before the first beat, and (2) the backend has Vertex Imagen 3 subject customization configured. So the backend uses the **user’s face** for image generation when reference frames exist; it does not “generate video” as a live stream.
- **New characters:** The backend **does** detect when a **new person** enters the frame and **embeds them into the story**. It does this only when the frontend **sends frames** to the backend. When the frontend sends a frame to **`POST /api/camera/analyze`** or **`POST /api/story/stage-vision`** and the backend sees more people than before (e.g. 0 → 1, or 1 → 2), it:
  - Treats that as a **new entrant**,
  - Generates a **character-injection beat** (narration + scene_prompt) for them,
  - Optionally generates a **character card image** (if `generateImage: true`),
  - Adds them to the session’s **stage characters** so **subsequent** **`POST /api/story/beat`** responses include them in narration and scene prompts (and thus in the next scene images).

So: **video** = frontend-driven sequence of beats; **new-character detection and embedding** = backend, but only when the frontend sends frames in real time.

### How can the frontend integrate this?

To get **real-time detection** and **embed new characters into the video/story**, the frontend should do the following.

**1. Send frames from the live camera in real time**

- While the story is running (and optionally while “You” or “Stage” is on), periodically **grab a frame** from the live `<video>` (e.g. draw to canvas, `toDataURL('image/jpeg', 0.85)`).
- Send that frame every **3–5 seconds** to **one** of:
  - **`POST /api/camera/analyze`** with body `{ frame, campaignId? }` — stores faces, runs stage vision when a story session is active, and returns `people`; when there’s a new entrant, the backend broadcasts **`character_injection`** and **`stage_vision_tick`** on the WebSocket.
  - **`POST /api/story/stage-vision`** with body `{ frame, generateImage?: true }` — same new-entrant logic and WebSocket events; use when you already have a story session and want stage-vision–only (no profile storage in that call if you use only stage-vision; for reference storage you still need camera/analyze).

So: **live camera → capture frame every few seconds → POST to camera/analyze (or stage-vision)**. The backend then detects new characters in “real time” relative to the frames it receives.

**2. Subscribe to the WebSocket for new-character and tick events**

- Connect to the app WebSocket and subscribe to the channel used for story/camera (e.g. `story_audio` or your main channel).
- On **`character_injection`**: a new person was detected and added to the story. Payload includes `narration`, `scene_prompt`, optional `imageUrl`, `new_entrant_description`. Use this to show “Someone joined!” and the character card/narration.
- On **`stage_vision_tick`**: optional; payload has `people_count`, `new_entrant`, `setting`. Use it to show “2 people on stage” or to refresh UI state.

**3. Show the “video” (sequence of beats) and optionally auto-continue**

- **Video:** For each beat, show `image.imageUrl` and play `narrationAudioUrl`. When the narration ends (or after a short delay), call **`POST /api/story/beat`** with `action: "What happens next?"` (or the user’s input) to get the next “frame.” Repeat. That’s the “video” (one image per beat, in order).
- **Auto-continue:** To make it feel continuous, when one narration finishes, automatically request the next beat with `"What happens next?"` so the next image + narration appear without the user clicking each time.
- Because the backend has already added new entrants to **stage characters**, the **next** beat (and all following beats) will include them in the narration and scene; the frontend doesn’t need to do anything extra beyond sending frames and requesting beats.

**4. Optional: use camera/analyze for both face reference and new-character detection**

- Sending the same live frames to **`POST /api/camera/analyze`** (with `campaignId`) gives you: (a) reference frames for the user’s face (and anyone else in frame), and (b) new-entrant detection and character injection when a story session is active. So one endpoint can drive both “user in the story” and “new character embedded” as long as the frontend sends frames in real time.

### Summary

| Question | Answer |
|----------|--------|
| Does the backend generate video in real time? | No single video stream. It returns **one image per beat**. The frontend builds “video” by showing each beat’s image + narration in sequence (and optionally auto-requesting the next beat). |
| Does it detect new characters and embed them? | **Yes**, when the frontend sends frames. On new entrant, backend generates character injection, adds them to stage characters, and broadcasts **`character_injection`**. Subsequent beats then include them in the story. |
| How does the frontend integrate? | (1) Send **live camera frames** every 3–5 s to **`POST /api/camera/analyze`** (or **`POST /api/story/stage-vision`**). (2) Subscribe to **WebSocket** and handle **`character_injection`** (and optionally **`stage_vision_tick`**). (3) Show the **video** as the sequence of beat images + narration; optionally **auto-continue** by requesting the next beat when narration ends. |
