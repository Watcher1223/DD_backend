// ═══════════════════════════════════════════════
// NANOBANANA 2 — Scene Image Generation
// Generates fantasy artwork from scene descriptions.
// Falls back to placeholder images for demo.
// ═══════════════════════════════════════════════

const NANOBANANA_API_KEY = process.env.NANOBANANA_API_KEY;

/**
 * Generate a scene image from a text prompt.
 * @param {string} scenePrompt - Visual description of the scene
 * @returns {object} { imageUrl, source }
 */
export async function generateSceneImage(scenePrompt) {
  // ── NANOBANANA 2 API CALL ──
  // Replace this with the actual NanoBanana 2 API endpoint when available
  if (NANOBANANA_API_KEY && NANOBANANA_API_KEY !== 'your_nanobanana_api_key_here') {
    try {
      // NanoBanana 2 API integration point
      // The actual API format will depend on their documentation
      const res = await fetch('https://api.nanobanana.ai/v2/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${NANOBANANA_API_KEY}`,
        },
        body: JSON.stringify({
          prompt: scenePrompt,
          style: 'fantasy_illustration',
          width: 1024,
          height: 576,
          steps: 30,
        }),
      });

      const data = await res.json();
      if (data.image_url) {
        return { imageUrl: data.image_url, source: 'nanobanana' };
      }
    } catch (err) {
      console.error('[NANOBANANA] API error, falling back to placeholder:', err.message);
    }
  }

  // ── PLACEHOLDER FALLBACK ──
  // Use a themed placeholder that looks good in demo
  const imageUrl = generatePlaceholderUrl(scenePrompt);
  return { imageUrl, source: 'placeholder' };
}

/**
 * Generate a themed placeholder image URL based on the scene mood.
 * Uses pollinations.ai for free AI-generated images (no key needed).
 */
function generatePlaceholderUrl(prompt) {
  // pollinations.ai generates images from prompts for free — perfect for hackathon
  const encoded = encodeURIComponent(prompt + ', high quality, 4k, detailed');
  return `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=576&nologo=true`;
}
