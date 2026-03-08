# Why the AI uses random people instead of my image

Story scene images show **your face** only when **both** of the following are true. Otherwise the backend generates images from text only, so you get generic or “random” people.

---

## 1. Your face was captured and stored **before** the first story beat

The backend needs at least one **reference photo** of you to personalize the image. That happens when the frontend sends a camera frame to **`POST /api/camera/analyze`** (or **`POST /api/camera/remote/:code`** if joining via phone).

**What must happen:**

- **“You: ON”** (or “Show me in the story”) must be **on**.
- The app must **call the camera**, capture a frame, and send it to **`POST /api/camera/analyze`** **before** any **`POST /api/story/beat`** is requested.
- If you start the story and request beats **without** sending a frame first, the backend has **no reference frames** and will always generate text-only images (random people).

**Frontend checklist:**

- When the user turns “You” ON, start the camera and send at least one frame to **`POST /api/camera/analyze`** immediately (or within the first few seconds).
- Do **not** allow the first “Next story beat” (or “Tell”) until after at least one successful camera/analyze for that session/campaign, **or** show a clear message: “Turn on You and show your face so the story uses your image.”
- Prefer **live camera + auto-capture** (see below) so the user never has to click a capture button.

---

## Live camera, auto-capture (no click)

The backend only needs **a frame** (image bytes); it doesn’t care whether that frame came from a “photo” upload or from the **live camera**. So the frontend should use the **live camera** and **automatically** grab a frame and send it — no capture button required.

**Recommended flow:**

1. When “You” is ON, start the camera with `navigator.mediaDevices.getUserMedia({ video: true })` and show the stream in a `<video>` element.
2. As soon as the video stream is ready (e.g. after `video.play()` or on `video.onloadeddata`), **grab one frame** from the video: draw the current video frame to a `<canvas>`, then `canvas.toDataURL('image/jpeg', 0.85)` to get a data URL (or base64).
3. Send that frame to **`POST /api/camera/analyze`** with body `{ frame: dataUrl, campaignId }` (omit `campaignId` to use default). The backend stores it as the reference for face-in-story.
4. **(Optional)** Keep sending a new frame every **5–10 seconds** while the camera is on. That way the reference stays up to date (e.g. if the user moves or lighting changes), and the user never has to click anything.

**Minimal frontend example (no capture button):**

```javascript
let cameraStream = null;
let videoEl = document.querySelector('video');
let canvasEl = document.createElement('canvas');
let sendIntervalId = null;

async function startYouOn() {
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
  videoEl.srcObject = cameraStream;
  await videoEl.play();

  // Send first frame as soon as we have a frame (e.g. after 500ms)
  setTimeout(() => sendFrameOnce(), 500);

  // Optional: keep sending every 5s so reference stays fresh
  sendIntervalId = setInterval(sendFrameOnce, 5000);
}

function sendFrameOnce() {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return;
  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
  canvasEl.getContext('2d').drawImage(videoEl, 0, 0);
  const frame = canvasEl.toDataURL('image/jpeg', 0.85);

  fetch(`${API}/api/camera/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame, campaignId }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.stored > 0) {
        // Reference updated; next story beat can use this face
      }
    })
    .catch((err) => console.warn('Camera analyze failed', err));
}

function stopYou() {
  if (sendIntervalId) clearInterval(sendIntervalId);
  sendIntervalId = null;
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraStream = null;
}
```

**Summary:** Use the **live** `<video>` stream, grab a frame with **canvas** when the stream is ready (and optionally on a timer), and **POST** that frame to **`POST /api/camera/analyze`**. No photo upload and no capture button — the reference is taken from the live camera in real time.

**Backend contract:** **`POST /api/camera/analyze`** accepts:
- **`frame`** (required) — Either a **data URL** (e.g. `canvas.toDataURL('image/jpeg', 0.85)` → `data:image/jpeg;base64,...`) or **raw base64**. The backend parses both via `parseFrame()`.
- **`campaignId`** (optional) — If omitted, the backend uses the default campaign. You can send it in the body when you have a specific campaign (e.g. from an earlier **`POST /api/story/configure`** or session).
- **`generateImage`** (optional) — If a story session is active and a new entrant is detected, set to `true` to request a character card image in the response.

## 2. Vertex Imagen 3 subject customization is configured on the backend

Even with reference frames stored, the backend can only “paste” your face into the image when **Vertex AI Imagen 3 subject customization** is enabled. That requires:

- **`GOOGLE_CLOUD_PROJECT`** (or **`VERTEX_AI_PROJECT`**) set in the backend `.env` to a Google Cloud project that has Vertex AI and Imagen 3 enabled.
- Billing enabled on that project (Imagen 3 is a paid API).

If this is **not** set, the backend skips subject customization and uses **NanoBanana** or **Imagen Fast** with the **text prompt only** — so the model invents a face and you get random people.

**How to check:**

- Call **`GET /api/health`**. If **`has_subject_customization`** is **`false`**, the backend is **not** configured for face-in-image. Images will be generic until the backend is configured (set `GOOGLE_CLOUD_PROJECT` and ensure Imagen 3 is available in that project).

---

## What the backend returns so the frontend can explain

- **`GET /api/health`** → **`has_subject_customization`**: `true` means the backend *can* use your face when reference frames exist; `false` means it will never use your face (backend not configured).
- **`POST /api/story/beat`** response → **`imageUsedYourFace`**: `true` means this scene image was generated with your face (Imagen 3 subject customization); `false` means the image was text-only (generic character).

Use these to show messages such as:

- “Your face was used in this scene” when `imageUsedYourFace === true`.
- “This scene used a generic character. Turn on You and show your face before the first beat, and ensure your admin has enabled face-in-story (Vertex Imagen 3).” when `imageUsedYourFace === false`, and optionally “Face-in-story is not configured on the server” when `has_subject_customization === false`.

---

## Summary

| Cause | What to do |
|-------|------------|
| No reference frames | Frontend: send a camera frame to **`POST /api/camera/analyze`** **before** the first story beat when “You” is ON. |
| Backend not configured | Set **`GOOGLE_CLOUD_PROJECT`** in backend `.env` and enable Vertex AI Imagen 3 (and billing) in that project. |
| “You” was OFF | User must turn “You” ON and show their face before requesting story beats. |

Once both conditions are met, new story beats will use **`imageUsedYourFace: true`** and the generated scene images should show the user’s face instead of random people.
