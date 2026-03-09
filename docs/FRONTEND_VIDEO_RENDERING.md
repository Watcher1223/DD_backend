# Frontend: How to Implement Video Rendering (Beat-by-Beat)

This doc tells the frontend **how to render the bedtime story so it feels like a continuous video** even though the backend returns **one image per beat**. It covers the API contract, UX rules, and a step-by-step implementation.

**Related:** [STORY_FLOW.md](./STORY_FLOW.md) (end-to-end flow), [FRONTEND_API.md](./FRONTEND_API.md) (beat endpoint details).

---

## 1. Backend contract: no single video stream

The backend **does not** stream one video file. It works **beat-by-beat**:

- Each **`POST /api/story/beat`** returns **one** scene image + **one** narration + **one** narration audio URL.
- Generating a beat (Gemini + image) often takes **10–30 seconds**.
- The “video” is the **sequence** of these beats: image 1 + narration 1 → image 2 + narration 2 → …

So the frontend must:

1. Request beats (one at a time, or prefetch the next).
2. Display each beat’s **image** and play its **narration audio** in order.
3. Avoid making the user feel a long “Creating scene…” stall between beats.

---

## 2. Target UX: continuous-feeling “video”

The story should feel like **one continuous video**, not “image, long wait, image, long wait”:

- **Never** replace the whole screen with a full-screen “Creating scene... This may take 10-30 seconds” spinner.
- **Keep the last scene image visible** until the next one is ready.
- **Prefetch** the next beat while the current narration is playing so the gap between scenes is short (or zero).
- **Play narration as soon as you have it**; show the new image when it loads (or keep the previous image until then).
- Use a **small, non-blocking** loading state (e.g. “Drawing next scene…” overlay or corner spinner) so the current scene stays visible.

---

## 3. API: `POST /api/story/beat`

**Request:**

- **`action`** (string, required) — e.g. `"What happens next?"` or `"Begin the story"` for the first beat. For auto-continue, use `"What happens next?"`.
- **`campaignId`** (optional) — Omit to use default campaign.

**Response (200):**

| Field | Type | Use |
|-------|------|-----|
| `narration` | string | Story text for this beat. |
| `narrationAudioUrl` | string | Same-origin URL to play TTS for this narration. **Play this as soon as you have the response.** |
| `image` | `{ imageUrl, source }` | `imageUrl` = URL of the scene image. Display when loaded; keep previous image visible until then. |
| `imageUsedYourFace` | boolean | `true` if the scene used the user’s face (Imagen customization). Use for “Your face in the story” UI. |
| `videoClip` | `{ videoUrl, durationSeconds, source, beatIndex }` \| undefined | When **Veo** is enabled and a clip for this beat is ready, play **`videoUrl`** in a `<video>` for real motion (e.g. character walking in the forest). See [§ 3.1](#31-showing-motion-video-clips-vs-static-image) below. |
| `beatIndex` | number | Zero-based index of this beat. Use it to match incoming **`story_video_clip`** WebSocket messages to the correct beat. |
| `scene_prompt` | string | Backend’s scene description (for debugging or captions). |
| `scene_prompt_motion` | string | Optional one-sentence motion cue (e.g. “The child reaches up to catch a firefly”). Used by Veo for video generation. |
| `theme`, `mood`, `location`, etc. | various | Optional for UI (e.g. “Magical forest • Peaceful”). |

**Important:** Each beat is **independent**. There is no “stream”; you build the sequence by requesting beat 1, then beat 2, then beat 3, etc. Order is determined by **when you send the request** and **how you queue responses** (see below).

---

### 3.1 Showing motion (video clips vs static image)

Right now the frontend only shows the **generated static image** per beat. To get a **“live video”** feel — e.g. the character (with their face) **walking in the forest, touching something** — you have two options.

#### Option A: Use video clips when the backend has Veo enabled

When the backend is run with **`VEO_ENABLED=true`** (and Veo is configured), it generates **short video clips** (e.g. 5 seconds) per beat with real motion (character walking, reaching, etc.). The clip is produced **asynchronously** after the beat; when it’s ready, the backend sends it over the WebSocket.

**Frontend implementation:**

1. **Subscribe to the `story_video` channel** so you receive video clip events:
   ```json
   { "type": "subscribe", "channel": "story_video" }
   ```
2. **On each beat response:** Show the static **`image.imageUrl`** immediately. If the response includes **`videoClip`** (e.g. from a previously completed clip for this beat), **play `videoClip.videoUrl`** in a `<video>` element instead of (or on top of) the image so the user sees actual motion.
3. **On WebSocket message `type: 'story_video_clip'`:** The payload includes `beatIndex`, `videoUrl`, `durationSeconds`. If this `beatIndex` is the one you’re currently showing, **switch** to playing **`videoUrl`** in a `<video>` (or store it and play when you reach that beat). When the clip ends, you can transition to the next beat or loop until narration ends.
4. **Display:** Use one main area for the “scene”. Prefer **video** when you have a clip for the current beat (`videoUrl` from the beat response or from a past `story_video_clip` for that `beatIndex`). Otherwise show the **image**. That way the user sees the character walking in the forest (or whatever motion) when clips are available.

**Beat response when a clip is ready:**  
`videoClip: { videoUrl, durationSeconds, source: 'veo', beatIndex, campaignId, completedAt }`

**WebSocket message when a clip finishes generating:**  
`{ type: 'story_video_clip', beatIndex, videoUrl, durationSeconds, source: 'veo', campaignId, completedAt }`

**Note:** Veo clips take time to generate (often minutes). So for beat N you’ll usually show the static image first; the clip for beat N may arrive later via WebSocket. When it arrives, switch that beat’s view to the video if the user is still on that beat, or store it and play it when they reach that beat in the sequence.

#### Option B: No Veo — use the static image and add frontend motion

When Veo is **not** enabled, the backend only returns a **single image** per beat. That image is a **full scene** (after the backend fix): e.g. the character in the forest with their face visible, touching a tree or doing an action. It’s one frame, not a video.

To make it feel more “live” without real video:

1. **Show the full scene image** — Don’t crop or zoom into the face only. The backend now generates “A scene featuring [person] …” with the full setting (forest, props, action); display the whole image so the user sees the character in the environment.
2. **Add subtle motion** — Apply a **Ken Burns–style** effect: slow pan and/or zoom on the image (e.g. CSS `animation` or a small transform change over 5–10 seconds). That gives a sense of movement even though the image is static.
3. **Optional:** Use **`scene_prompt_motion`** from the beat (e.g. “The child reaches up to catch a firefly”) as a short caption or subtitle so the user’s imagination fills in the motion.

So: **with Veo** → show real video clips when you get `videoClip` or `story_video_clip`; **without Veo** → show the full scene image and add frontend motion (e.g. Ken Burns) so it doesn’t feel like a single frozen frame.

---

## 4. Implementation: step-by-step

### 4.1 State you need

- **Current beat index** (e.g. `beatIndex = 0` for first beat).
- **Current scene image URL** — the image to show right now (from the latest completed beat).
- **Current narration audio** — the audio element or URL for the current beat (so you can detect when it ends).
- **Prefetched next beat** (optional) — `{ narration, narrationAudioUrl, image }` for the next beat, if you already requested it.
- **Pending request** — whether a beat request is in flight (so you don’t double-request).

### 4.2 Requesting the first beat

1. Call **`POST /api/story/beat`** with `{ action: "Begin the story" }` (or your first-action string).
2. When the response arrives:
   - Set **current scene image** = `response.image.imageUrl` (or show a placeholder until the image loads).
   - Start playing **`response.narrationAudioUrl`**.
   - Display **`response.narration`** text if you show subtitles/captions.
3. **Prefetch:** Right after you start playing narration, call **`POST /api/story/beat`** again with `{ action: "What happens next?" }` in the **background**. Store the response as “prefetched next beat” (do not display it yet).

### 4.3 When the current narration ends (auto-continue)

1. If you have a **prefetched next beat**:
   - Set **current scene image** = prefetched beat’s `image.imageUrl` (or keep showing the previous image until the new one loads).
   - Start playing **prefetched beat’s `narrationAudioUrl`**.
   - Display prefetched beat’s **narration** text.
   - Clear the prefetched beat; **request the next beat** in the background again (`action: "What happens next?"`) and store as the new prefetched beat.
2. If you **don’t** have a prefetched beat yet (e.g. first beat or prefetch failed):
   - **Keep showing the current scene image** (do not blank the screen).
   - Show a **small** loading state (e.g. “Drawing next scene…” or a spinner in the corner).
   - When the response arrives, set image, play narration, then prefetch the next beat as above.

### 4.4 Loading state (non-blocking)

- **Do not** show a full-screen “Creating scene... This may take 10-30 seconds” as the only content.
- **Do** keep the **last scene image** visible and overlay a small indicator (e.g. “Drawing next scene…”, “Loading…”, or a corner spinner).
- Optionally dim the image slightly or show a thin progress bar so the user knows something is loading, but the story never “disappears.”

### 4.5 Ordering and race conditions

- Beats are ordered by **when the backend processes them**. If you send “What happens next?” once per narration end, order is correct.
- If you prefetch, **only use the prefetched beat when the current narration ends**. Don’t show beat N+1 before beat N’s narration has finished.
- If the user taps “Pause” or “Stop,” cancel or ignore any in-flight prefetch and don’t start new requests until they resume.

---

## 5. Minimal flow summary

```
1. Request beat 1 (action: "Begin the story").
2. On response: show image 1, play narrationAudioUrl 1, show narration 1.
3. Immediately prefetch beat 2 (action: "What happens next?").
4. When narration 1 ends:
   - If beat 2 ready: show image 2, play narration 2; prefetch beat 3.
   - If not ready: keep image 1 visible, show small “Drawing next scene…”; when beat 2 arrives, show image 2, play narration 2; prefetch beat 3.
5. Repeat from step 4 for beat 3, 4, …
```

Always **keep the previous image on screen** until the next image is ready. Always **prefetch the next beat** as soon as the current narration starts (or when the user enables “Auto”). That way the gap between scenes is minimal and the story feels continuous.

---

## 6. Optional: show narration before image loads

When you receive a new beat:

- **Play `narrationAudioUrl`** as soon as the response arrives.
- **Swap in `image.imageUrl`** when the image has loaded (or keep the previous image until the new one is ready).

So the story “keeps talking” even if the image is a bit slower to load.

---

## 7. References

- **Beat endpoint:** [FRONTEND_API.md — Story beat](./FRONTEND_API.md) (`POST /api/story/beat`).
- **End-to-end flow (theme, user face, doll, judge, language):** [STORY_FLOW.md](./STORY_FLOW.md).
- **Making beat-by-beat feel continuous (summary):** [STORY_FLOW.md — Frontend: making beat-by-beat feel like continuous video](./STORY_FLOW.md).
- **Why images show “random people” or only your face:** [WHY_RANDOM_PEOPLE.md](./WHY_RANDOM_PEOPLE.md).
