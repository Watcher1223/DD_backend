#!/usr/bin/env node
/**
 * Run all Gemini-related tests and report pass/fail/skip.
 * Usage: node scripts/run-gemini-tests.js
 * Requires GEMINI_API_KEY for non-skip results. Vision tests also need FIXTURE_IMAGE_BASE64 or scripts/fixtures/sample.png.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scripts = [
  'test-gemini-theme.js',
  'test-gemini-character-injection.js',
  'test-gemini-beat-language.js',
  'test-gemini-beat-protagonist.js',
  'test-gemini-emotion.js',
  'test-gemini-stage-vision.js',
  'test-gemini-object.js',
];

function runOne(name) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(__dirname, name)],
      { stdio: 'pipe', env: process.env, cwd: join(__dirname, '..') }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      resolve({ name, code, out, err });
    });
  });
}

async function main() {
  console.log('');
  console.log('  Gemini tests');
  console.log('  ────────────');
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  for (const name of scripts) {
    const { code, out } = await runOne(name);
    const label = name.replace('test-gemini-', '').replace('.js', '');
    if (out) process.stdout.write(out);
    const skipMatch = out.match(/skipped: (\d+)/);
    const passMatch = out.match(/(\d+) passed/);
    const failMatch = out.match(/(\d+) failed/);
    const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
    const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
    const skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    totalPassed += passed;
    totalFailed += failed;
    totalSkipped += skipped;
    if (code !== 0 && failed === 0 && skipped === 0) totalFailed += 1;
  }
  console.log('');
  console.log('  Total: ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalSkipped + ' skipped');
  console.log('');
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
