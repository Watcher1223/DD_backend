# Gemini / vision test fixtures

For **vision tests** (emotion, stage-vision, object detection), the test runner looks for a valid image so the Gemini Vision API can analyze it.

- **Option A:** Set env `FIXTURE_IMAGE_BASE64` to a base64-encoded image string (at least 200 characters).
- **Option B:** Place a small image file here named `sample.png` (at least ~150 bytes so its base64 is ≥200 chars).

If neither is provided, vision tests are skipped and the runner reports "skip (no fixture)".
