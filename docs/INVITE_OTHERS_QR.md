# Invite others to join the story (QR code)

This document describes how **other people can join the frame and be embedded into the bedtime story** by scanning a QR code. The backend already supports this; the frontend needs to expose it.

---

## Overview

1. **Host** (person running the story) starts a story session and wants to let someone else join (e.g. a parent, sibling, or friend).
2. **Host’s app** generates a pairing code and shows a **QR code** (or a link/code to type).
3. **Guest** scans the QR code with their phone → opens the **phone camera page** (`/phone-camera.html?code=XXXXXX`).
4. **Guest** allows camera access and **taps capture**. Their frame is sent to the backend.
5. Backend **analyzes the frame** (Gemini Vision), stores the guest’s appearance, and if a **story session is active**, runs **stage vision**. If the guest is a **new entrant** (e.g. first time someone joins from that phone, or a new person in the frame), the backend:
   - Generates a **character-injection beat** (narration + scene) for them,
   - Optionally generates a **character card image** (with their face if Vertex Imagen subject customization is configured),
   - Adds them to the story’s **stage characters** so later beats can include them,
   - Broadcasts **`character_injection`** and **`profiles_updated`** on the WebSocket.
6. **Host’s app** (and any viewers) can show “Someone joined!” and the new character’s narration/card, and subsequent story beats can include that person in the story.

So: **yes, other people can join the frame/story by scanning the QR code; they are embedded into the story** as new characters when they capture from the phone. The backend does this today; the missing piece is the **frontend** showing the QR code and “Invite others” flow.

---

## Why the QR code didn’t open on your phone (localhost)

The QR code does **not** need to be “from” the backend in the sense of the backend serving the QR image — the **frontend** generates the QR from the `phoneUrl` returned by **`POST /api/camera/pair`**. The backend only provides that URL.

**Problem:** When you use the app at **`http://localhost:4300`**, the backend builds `phoneUrl` from the request’s host, so it returns something like `http://localhost:4300/phone-camera.html?code=XXXXXX`. When someone **scans that QR on their phone**, the phone tries to open **localhost** — but on the phone, “localhost” means the **phone itself**, not your computer. So the page never loads.

**Solutions (pick one):**

1. **Backend (recommended for local dev):** Set **`PUBLIC_BASE_URL`** in `.env` to your machine’s **LAN IP** (same Wi‑Fi as the phone), e.g. `http://192.168.1.5:4300`. Restart the server. Then **`POST /api/camera/pair`** will return a `phoneUrl` with that host, and the QR code will open on the phone. (Find your LAN IP: Mac/Linux `ifconfig` or System Preferences → Network; Windows `ipconfig`.)
2. **Frontend:** After calling **`POST /api/camera/pair`**, replace the host in `phoneUrl` with a configurable base URL (e.g. from env like `VITE_PHONE_BASE_URL` or a “Server URL” setting) before generating the QR. Use the same LAN IP so the phone can reach the server.
3. **Quick test:** Open the **host app** in the browser using the LAN IP (e.g. `http://192.168.1.5:4300`) instead of localhost. Then the backend’s `req.get('host')` is already the LAN IP, so the returned `phoneUrl` works on the phone without any env or frontend change.

For **production**, use your real domain in `PUBLIC_BASE_URL` (or have the frontend use it) so the QR works for anyone.

### Hosted backend (e.g. Railway)

For the hosted backend at **https://ddbackend-production.up.railway.app** (or your own deployment):

- **Set `PUBLIC_BASE_URL`** in the deployment environment to the public URL of the backend, e.g. `https://ddbackend-production.up.railway.app`. Then:
  - **`POST /api/camera/pair`** returns a `phoneUrl` like `https://ddbackend-production.up.railway.app/phone-camera.html?code=XXXXXX`, so the QR code works when the guest scans it on their phone (no localhost).
  - **`GET /`** (root) returns **`websocket: "wss://ddbackend-production.up.railway.app"`** so the frontend can connect to the correct WebSocket URL for real-time events (e.g. `character_injection`, `profiles_updated`).
- The frontend should use the **hosted API base** for all requests (e.g. `https://ddbackend-production.up.railway.app`) and the **`websocket`** value from `GET /` (or derive `wss://` from the same host) so the connection is consistent.

---

## What the frontend should implement

### 1. “Invite others” or “Scan to join” entry point

- Add a button or section: **“Invite others to join the story”** or **“Scan to join”**.
- Shown when a **story session is active** (after `POST /api/story/start`). Optionally also allow generating a code before start (e.g. “Get ready – show this to others”).

### 2. Generate pairing code and show QR code

- Call **`POST /api/camera/pair`** with optional `campaignId` (or omit to use default campaign).
- Request body: `{}` or `{ "campaignId": 1 }`.
- Response:
  ```json
  {
    "code": "A7KR3P",
    "phoneUrl": "http://192.168.1.5:4300/phone-camera.html?code=A7KR3P",
    "expiresAt": 1709767232000
  }
  ```
- **Display:**
  - The **6-character code** as text (e.g. “Code: A7KR3P”) so someone can type it if they can’t scan.
  - A **QR code** that encodes `phoneUrl`. Use any QR library (e.g. `qrcode` npm, or a CDN script). Example:
    ```javascript
    const res = await fetch(`${API}/api/camera/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId }), // optional
    });
    const { code, phoneUrl, expiresAt } = await res.json();
    // Show code on screen
    // Generate QR from phoneUrl and show <img src={qrDataUrl} /> or canvas
    ```
- **Important:** `phoneUrl` must be reachable from the **guest’s phone**. The backend uses the request’s host by default; if the app is opened at `http://localhost:4300`, `phoneUrl` will contain `localhost` and won’t work when scanned on a phone. Set **`PUBLIC_BASE_URL`** in `.env` to your machine’s LAN IP (e.g. `http://192.168.1.5:4300`) so the returned `phoneUrl` is phone-reachable, or have the frontend replace the host in `phoneUrl` with a configurable base URL before generating the QR. See **“Why the QR code didn’t open on your phone (localhost)”** above.

### 3. Use the built-in phone camera page (no extra backend work)

- The backend serves **`/phone-camera.html?code=XXXXXX`**.
- When the guest opens that URL (by scanning the QR or following a link):
  - The page validates the code with **`GET /api/camera/pair/:code`**.
  - It then shows the camera; when the guest taps capture, it sends the frame to **`POST /api/camera/remote/:code`**.
- So the **frontend only needs to show the QR code (and code)**; the rest is handled by the existing phone page.

### 4. Listen for guests joining (WebSocket)

- When a guest captures from the phone, the backend:
  - Runs the same pipeline as **`POST /api/camera/analyze`** (analyze + store profiles + reference frames).
  - If a story session is active and the guest is a **new entrant**, runs **stage vision** and:
    - Broadcasts **`character_injection`** with `narration`, `scene_prompt`, `imageUrl` (optional), `new_entrant_description`.
    - Pushes the new character into the session’s **stage characters** so the next **`POST /api/story/beat`** can include them.
- The backend also broadcasts **`profiles_updated`** with `source: "phone"` and the detected `people`.

**Frontend WebSocket handling:**

- Subscribe to the app’s WebSocket (e.g. `story_audio` or your main channel).
- On **`character_injection`**: show “Someone joined the story!”, the narration text, and if present the character card image (`imageUrl`). This is the “embedded into the story” moment.
- On **`profiles_updated`** with `source === 'phone'`: refresh any “Who’s in the story” or profile list so the host sees the new person(s).

Example:

```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'character_injection') {
    // New person joined and was added to the story
    showJoinedNarration(msg.narration);
    if (msg.imageUrl) showCharacterCard(msg.imageUrl);
  }
  if (msg.type === 'profiles_updated' && msg.source === 'phone') {
    refreshProfiles(msg.people);
  }
};
```

### 5. Optional: request a character card image when the guest captures

- The phone page currently sends **`POST /api/camera/remote/:code`** with `{ frame }`. The backend runs stage vision and, when there’s a new entrant, can generate a character card image **only if** the client asked for it.
- The **built-in** `phone-camera.html` does **not** send `generateImage: true`. To get a character card image when someone joins via phone, either:
  - Extend the phone page to send `generateImage: true` in the body, or
  - Rely on the desktop to show the character card when it receives **`character_injection`** with `imageUrl` (the backend may still generate one in some flows; see `routes/camera.js` and `generateImage`).
- For the “embed in story” experience, the important part is **`character_injection`** and **stage characters**; the card image is optional but nice for “here’s the new character”.

---

## API quick reference

| Action              | Endpoint                     | Purpose |
|---------------------|------------------------------|--------|
| Generate QR / code  | `POST /api/camera/pair`      | Body: `{}` or `{ campaignId }`. Returns `code`, `phoneUrl`, `expiresAt`. |
| Validate code       | `GET /api/camera/pair/:code` | Phone page calls on load. Returns `{ valid: true, campaignId }` or 404. |
| Phone sends frame   | `POST /api/camera/remote/:code` | Body: `{ frame }` or `{ frame, generateImage }`. Same behavior as `/api/camera/analyze` + stage vision when session active. |
| Phone page          | `GET /phone-camera.html?code=XXXXXX` | Built-in page: validate code → camera → capture → POST to remote. |

---

## Flow summary (for product/copy)

- **Host:** Tap “Invite others” → see a 6-letter code and a QR code.
- **Guest:** Scan QR (or open link) → open phone camera page → allow camera → tap capture.
- **Backend:** Analyzes guest, stores them, and if it’s a new person in the story, adds them as a character (narration + optional card image) and includes them in future story beats.
- **Host / viewers:** See “Someone joined!” and the new character’s narration (and card if present); the story continues with that person in it.

---

## Related docs

- **Camera pairing and remote API:** [CAMERA_HANDOFF.md](./CAMERA_HANDOFF.md) — full pairing API, QR generation example, WebSocket `profiles_updated`, and phone page behavior.
- **Stage vision and character injection:** [STORY_FLOW.md](./STORY_FLOW.md) — how new entrants get a character beat and are added to the story; section 4 (Judge walks onto the stage).
- **Frontend API overview:** [FRONTEND_API.md](./FRONTEND_API.md) — WebSocket events, `character_injection`, and camera endpoints.
