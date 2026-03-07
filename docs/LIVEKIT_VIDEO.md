# LiveKit Real-Time Video Pipeline

This doc describes the WebRTC-based video pipeline for the bedtime story stage: camera ingest via LiveKit, vision-on-stream, and optional V2V egress.

## Prerequisites

- **LiveKit Server** (Cloud or self-hosted). Set in `.env`:
  - `LIVEKIT_URL` (e.g. `wss://your-project.livekit.cloud`)
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET`
  - Optional: `LIVEKIT_ROOM_PREFIX=story` (room name becomes `story-{campaignId}`)

## Token API

**POST /api/livekit/token**

Request body:

- `campaignId` (optional): Campaign/session id. If omitted and a story session is active, the session’s campaign is used.
- `role`: `"publisher"` or `"viewer"`

**Publisher:** Must have an active story session (`POST /api/story/start` first). Use the token to join the room and publish the stage camera (e.g. via LiveKit React/JS SDK or WHIP).

**Viewer:** Can join with a `campaignId` (or current session’s room) to subscribe to the “story” video track (egress).

Response (200):

```json
{
  "token": "<JWT>",
  "roomName": "story-<campaignId>",
  "url": "wss://...",
  "role": "publisher"
}
```

**GET /api/livekit/status** — Returns `{ configured: boolean, url: boolean }` for UI/health.

## Client: join and publish camera

1. **Start story session**  
   `POST /api/story/start` with body `{ themeDescription: "bedtime story in the forest" }` (and ensure WebSocket is subscribed to `story_audio` first).

2. **Get a publisher token**  
   `POST /api/livekit/token` with body `{ role: "publisher" }` (optionally `campaignId` if you need to target a specific campaign).  
   Use the returned `token`, `roomName`, and `url`.

3. **Join room and publish**  
   Using [LiveKit JavaScript SDK](https://docs.livekit.io/client-sdk-js/):

   - Create a `Room()` and connect with `url`, `token`.
   - Get local camera track: `await createLocalVideoTrack({ facingMode: 'user' })` (or from `getUserMedia` and then `LocalVideoTrack.createTrackFromMediaStream(...)`).
   - Publish: `room.localParticipant.publishTrack(track, { name: 'camera' })`.

   The server will see the track in the room and can run the vision worker and egress on it.

4. **Viewer (stage display)**  
   Get a viewer token: `POST /api/livekit/token` with body `{ role: "viewer", campaignId: "<id>" }`.  
   Join the same room and subscribe to the remote track (ingest or egress “story” track) to show the video.

5. **Vision on stream**  
   While publishing, the client can capture frames from the local track (e.g. every 500 ms via canvas) and send them to `POST /api/livekit/vision-frame` with body `{ frame: "<base64>", generateImage?: boolean }`. The server runs stage vision, updates session state, broadcasts `stage_vision_tick`, and on new entrant runs character injection, Lyria update, and `v2v_prompt_updated`.

**POST /api/livekit/ingest-started** — After publishing the camera track, call with body `{ roomName }` so the server broadcasts `livekit_ingest_active` and `livekit_egress_active` (passthrough: the camera track is the “story” track).

## WebSocket events (app-level)

The existing WebSocket (`ws://...`) is used for app events. New event types (server → client):

| Type                   | Payload (representative)                          | When sent                          |
|------------------------|--------------------------------------------------|------------------------------------|
| `livekit_room_ready`   | `{ roomName, campaignId }`                       | After story start; room is ready   |
| `livekit_ingest_active`| `{ roomName, hasVideo: true }`                   | Server sees a video track in room  |
| `stage_vision_tick`    | `{ people_count, new_entrant, setting? }`        | Each vision worker run (throttled) |
| `character_injection`  | `{ narration, scene_prompt, imageUrl?, ... }`   | New person detected (e.g. judge)   |
| `v2v_prompt_updated`   | `{ prompt }`                                     | V2V scene prompt changed           |
| `livekit_egress_active`| `{ roomName, trackName? }`                      | Egress (story) track is publishing |

Clients can use these to show “Camera live”, “2 people on stage”, and to subscribe to the egress track when `livekit_egress_active` is received.

## Phases and testing

- **Phase 1a:** Token API + env — Get token, join room from browser, publish camera; verify track in LiveKit.
- **Phase 1b:** WebSocket events `livekit_room_ready`, `livekit_ingest_active` — Start story, join room, publish; client receives both events.
- **Phase 2a:** Vision worker — Server subscribes to room, samples frames, runs stage vision, broadcasts `stage_vision_tick`.
- **Phase 2b:** Character injection + Lyria update + `v2v_prompt_updated` when judge enters.
- **Phase 3a:** Egress passthrough + `livekit_egress_active` — Second client subscribes to “story” track.
- **Phase 3b:** V2V service interface + mock — `services/v2v.js` exports `transformFrame(frameBuffer, prompt)`; mock returns the input frame and logs the prompt. Wire a real V2V backend (e.g. StreamDiffusion, Luma) when available.

## Frame decoding (Phase 2)

Getting raw frames from a LiveKit track in Node may require a native addon or a sidecar that receives RTP and pushes decoded frames to the backend. This is documented as the main integration point for the vision worker; alternatives include a browser-based pipeline that sends frames to the backend (higher latency).

## Chroma: identity consistency and re-identification

Chroma is used as identity memory so the same person keeps the same character skin when they leave and re-enter the frame (e.g. judge returns and still appears as the Wizard). The backend stores stage identities in `lw_stage_identity` when a new entrant is first seen; when someone re-enters, it queries Chroma by description and reuses the stored beat if distance is below `CHROMA_REID_DISTANCE_THRESHOLD` (default 0.5). Re-identification test: enroll, leave frame 5s, return — pass if same character beat is reused.

## Testing the flow

**Automated (backend only)**  
With the server running (`npm run dev`), in another terminal run:

```bash
npm run test:flow
```

This script starts a story session, optionally exercises the LiveKit token API (if configured), sends a fixture image to `POST /api/story/stage-vision`, asserts response shape and WebSocket `character_injection` when a new entrant is detected, sends a second frame to exercise Chroma re-id, then stops the session. Requires `GEMINI_API_KEY` and a fixture image (`FIXTURE_IMAGE_BASE64` or `scripts/fixtures/sample.png`). Chroma and LiveKit are optional (steps are skipped if not configured).

**Manual E2E (full LiveKit + camera)**  
1. Start the server and open a client that connects to the app WebSocket.  
2. Subscribe to `story_audio`, then `POST /api/story/start`.  
3. `POST /api/livekit/token` with `{ role: "publisher" }`; join the room with the LiveKit JS SDK and publish a camera track (name `camera`).  
4. Call `POST /api/livekit/ingest-started` with `{ roomName }`; confirm the client receives `livekit_ingest_active` and `livekit_egress_active`.  
5. Capture frames from the published track (e.g. every 500 ms via canvas) and send them to `POST /api/livekit/vision-frame` with `{ frame: "<base64>" }`.  
6. Confirm the client receives `stage_vision_tick`, and on new entrant `character_injection` and `v2v_prompt_updated`.

**Camera → character in the test page**  
To see your camera image turned into a story character in real time (without LiveKit):

1. Open `http://localhost:4300/test-story-audio.html`.
2. Start a story session (e.g. enter a theme and click “Start story session”).
3. Check **“Run stage vision from camera (show me as character)”**. The page will request camera access and send a frame to `POST /api/story/stage-vision` every 5 seconds with `generateImage: true`.
4. When you first appear in frame (people_count 0 → 1), the backend detects a new entrant, generates a character-injection beat (narration + scene_prompt), and optionally a character card image. The page shows **People: 1 — New character!**, the narration text, and the generated image. You can also receive the same via WebSocket `character_injection`.
5. If a second person steps into view, they are detected as another new entrant and get their own character beat and card (or reuse from Chroma if they were seen before).
