# Hackathon submission: Living Worlds — AI Bedtime Story

Use this for the **project description**, **link**, and **track-specific** blurbs.

---

## Share a link and a brief description of your project

**Link (replace with your repo or demo URL):**  
`https://github.com/YOUR_ORG/DD_backend`  
*(or your deployed backend URL, e.g. `https://your-app.fly.dev`)*

**Brief description:**

**Living Worlds** is an AI-powered bedtime story backend that turns the listener and their room into part of the story. A parent or child sets a theme (e.g. “magical forest”), points a camera at a stuffed toy (the “hero”), and starts a session. **Lyria RealTime** streams adaptive music; **Gemini** generates gentle narration and scene prompts; **Imagen** (or NanoBanana) generates scene images. When someone new steps into the frame—or joins by scanning a QR code on their phone—the system detects them, generates a character for them, and weaves them into the next story beats. The story can continue in multiple languages (e.g. Swahili, Russian) from a single phrase. **Chroma** stores semantic memory so returning characters keep the same “skin”; **LiveKit** supports real-time video rooms so a second device can publish the stage camera or subscribe as a viewer. **Overshoot** can drive mood-based music and doll detection via free-text vision results (vision-event, vision-object) and optional video-to-video stylization (V2V). The stack is Node/Express, SQLite, WebSockets, and the above APIs; the repo includes a test page, pairing flow for phone-as-camera, and docs for frontend integration.

---

## Which tracks would you like your project to be considered for?

### AfterQuery
*We do not currently use AfterQuery in the backend. If you add it:* AfterQuery could sit in front of our REST/WebSocket API to cache, log, or transform story beats, health checks, and campaign queries (e.g. `GET /api/campaign`, `POST /api/story/beat`). We’d consider it for the **AfterQuery** track if we integrate it as the query/observability layer for the Living Worlds API.

*(Optional: remove this track if you are not integrating AfterQuery.)*

---

### Browserbase
*We do not currently use Browserbase in the backend.* Our test UI is a static HTML page (`test-story-audio.html`) and a phone camera page (`phone-camera.html`). Browserbase could be used by a separate frontend or E2E tests to drive a real browser session (start story, scan QR, trigger beats) for demos or automated testing. We’d consider it for the **Browserbase** track if we add browser-automated demos or tests using Browserbase.

*(Optional: remove this track if you are not integrating Browserbase.)*

---

### Chroma
**Chroma** is our **semantic memory layer** for character and story consistency. We use the Chroma JS client (Chroma Cloud or self-hosted) with three collections: **appearance** (canonical descriptions of people seen on camera), **story** (recent story beats for retrieval-augmented generation), and **stage_identity** (descriptions of people who have “joined” the story—e.g. judge, guest). When a new person enters the frame, we query Chroma by description; if they were seen before (distance below `CHROMA_REID_DISTANCE_THRESHOLD`), we reuse their stored character beat so the same person keeps the same “character skin” when they leave and re-enter. Story beat generation calls `retrieveMemoryContext(campaignId, action)` to pull relevant memories into the Gemini prompt. Chroma is optional: if it’s down or disabled, the app still runs with SQLite and in-memory state, but character re-identification and long-term semantic recall are disabled.

**Relevant code:** `memory/chroma.js`, `routes/camera.js`, `routes/story.js` (retrieveMemoryContext, upsertStoryMemory, queryStageIdentityByDescription, upsertStageIdentity).

---

### DeepMind
We use **Lyria** (DeepMind/Google) in two ways: (1) **Lyria RealTime** (Gemini API, `models/lyria-realtime-exp`) for continuous, adaptive background music during the bedtime story—theme and mood are updated from the user’s theme description and from camera-driven emotion (e.g. yawn → lullaby, laugh → brighter). (2) **Lyria 2** (Vertex AI) for batch-generated music (e.g. test WAV, fallback tracks). Scene images use **NanoBanana 2** (YC x DeepMind hackathon, nananobanana.com) when configured, with Vertex Imagen as fallback. So the **DeepMind** track is covered by Lyria RealTime + Lyria 2 + NanoBanana for music and images.

**Relevant code:** `ai/lyria_realtime.js`, `ai/lyria.js`, `ai/music_engine.js`, `ai/nanobanana.js`, `routes/story.js`, `routes/audio.js`.

---

### Overshoot
**Overshoot** is integrated in three ways: (1) **Mood → music:** We accept free-text vision results (e.g. from an Overshoot prompt like “In one word or short phrase, what is the person doing or feeling?”) via **`POST /api/story/vision-event`** with `{ text }`. The backend maps that text to emotion, mood, intensity, and detected_events (e.g. “laugh”, “yawn”, “scared”) and updates Lyria when a story session is active—no hardcoded mood logic in the frontend. (2) **Object → protagonist:** Overshoot can describe what it sees (e.g. “show me what you see” or “describe any toy/doll”). The client sends the result to **`POST /api/story/vision-object`** with `{ text }`; we set or clear the story protagonist so the next beats are about that object. (3) **Video-to-video:** We have a V2V service client (`services/v2v.js`) that connects to an Overshoot WebSocket, sends camera frames and a scene prompt, and receives stylized frames for optional “story style” video output. So Overshoot drives **emotion-based music**, **doll-as-hero**, and **V2V stylization**.

**Relevant code:** `vision/emotion_analysis.js` (mapVisionTextToScene), `routes/story.js` (vision-event, vision-object), `services/v2v.js`, `services/v2v_pipeline.js`, `docs/FRONTEND.md`.

---

### LiveKit
**LiveKit** powers our **real-time video pipeline** for the bedtime story stage. We expose **`POST /api/livekit/token`** (publisher or viewer) so a client can join a room (e.g. `story-{campaignId}`) and publish the stage camera or subscribe as a viewer. After publishing, the client calls **`POST /api/livekit/ingest-started`** with `{ roomName }`; we broadcast **`livekit_ingest_active`** and **`livekit_egress_active`** so other clients know the camera is live and can subscribe to the “story” track. Frames from the stream can be sent to **`POST /api/livekit/vision-frame`** (which delegates to our unified camera pipeline), so we run stage vision, character injection, and Lyria updates on the same pipeline whether the frame comes from a local webcam or from a LiveKit publisher. When a story session starts, we broadcast **`livekit_room_ready`** with `roomName` and `campaignId` so the frontend can show a “Join with LiveKit” option. This enables a **two-device** demo: one device publishes the camera, another subscribes as viewer, with one shared WebRTC stream.

**Relevant code:** `routes/livekit.js`, `docs/LIVEKIT_VIDEO.md`, `server.js` (livekit routes), `routes/story.js` (livekit_room_ready).

---

## One-paragraph summary (for forms with tight character limits)

Living Worlds is an AI bedtime story backend that uses **Lyria RealTime** for adaptive music, **Gemini** for narration, and **Imagen/NanoBanana** for scene images. The listener’s face and a stuffed toy become part of the story; when someone new joins (in frame or via **QR code** on their phone), they’re detected and added as a character. **Chroma** stores semantic memory for character re-identification and story recall. **LiveKit** provides real-time video rooms (publish stage camera, subscribe as viewer). **Overshoot** drives mood-based music and doll detection via vision-event/vision-object and optional V2V stylization. Multi-language beats (e.g. Swahili) are supported. Built with Node, Express, SQLite, and WebSockets.
