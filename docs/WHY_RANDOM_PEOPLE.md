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

---

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
