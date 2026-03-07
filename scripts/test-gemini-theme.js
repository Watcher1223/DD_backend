#!/usr/bin/env node
/**
 * Test theme extraction: "Bedtime story in the forest" → magical forest; "under the sea" → under the sea.
 * Run: node scripts/test-gemini-theme.js (requires GEMINI_API_KEY)
 */

import 'dotenv/config';
import { extractThemeFromDescription } from '../ai/gemini.js';

const TESTS = [
  { input: 'Bedtime story in the forest', expectedSubstring: 'forest' },
  { input: 'under the sea', expectedSubstring: 'sea' },
  { input: 'a story', expectedSubstring: 'bedtime' },
];

async function run() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
    console.log('SKIP test-gemini-theme: GEMINI_API_KEY not set');
    return { passed: 0, failed: 0, skipped: TESTS.length };
  }
  let passed = 0;
  let failed = 0;
  for (const { input, expectedSubstring } of TESTS) {
    try {
      const theme = await extractThemeFromDescription(input);
      const ok = theme && theme.toLowerCase().includes(expectedSubstring.toLowerCase());
      if (ok) {
        console.log(`PASS: "${input}" → ${theme}`);
        passed++;
      } else {
        console.log(`FAIL: "${input}" → ${theme} (expected to contain "${expectedSubstring}")`);
        failed++;
      }
    } catch (e) {
      console.log(`FAIL: "${input}" → ${e.message}`);
      failed++;
    }
  }
  return { passed, failed, skipped: 0 };
}

run()
  .then((r) => {
    console.log('');
    console.log(`Theme: ${r.passed} passed, ${r.failed} failed, ${r.skipped} skipped`);
    process.exit(r.failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
