// ═══════════════════════════════════════════════
// PARSE JSON — Shared Gemini JSON response parser
// Handles markdown code fences, trailing text,
// and truncated output from any Gemini call.
// ═══════════════════════════════════════════════

/**
 * Parse Gemini's JSON response. Handles markdown code fences, trailing text, and truncated output.
 * @param {string} raw - Raw text from Gemini response
 * @param {object} [defaults] - Default values to inject when repairing truncated JSON
 * @returns {object} Parsed JSON object
 * @throws {Error} If JSON cannot be parsed or repaired
 */
export function parseGeminiJson(raw, defaults) {
  let text = (raw || '').trim();
  // Strip markdown code block if present (anywhere in string, not only full match)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  // Strip // comments before brace-trimming so trailing braces aren't lost
  text = stripJsonComments(text);
  // Strip leading/trailing prose (e.g. "Here is the JSON requested:")
  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    text = text.slice(firstBrace);
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace !== -1) text = text.slice(0, lastBrace + 1);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    const sanitized = fixNewlinesInStrings(text);
    try {
      return JSON.parse(sanitized);
    } catch (_) {}
    const repaired = repairTruncatedJson(sanitized, defaults);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch (_) {}
    }
    console.error('[GEMINI] Invalid JSON from model (first 300 chars):', text.slice(0, 300));
    throw new Error('Gemini returned invalid JSON. Try again or rephrase your action.');
  }
}

/**
 * Replace literal newlines inside JSON string values with escaped \\n.
 * Gemini sometimes returns multi-line strings which are invalid JSON.
 * @param {string} text
 * @returns {string}
 */
function fixNewlinesInStrings(text) {
  return text.replace(/"(?:[^"\\]|\\.)*"/gs, (match) =>
    match.replace(/\n/g, '\\n').replace(/\r/g, '\\r'),
  );
}

/**
 * Strip single-line // comments from JSON text that Gemini occasionally produces.
 * Only strips comments that appear outside of string values.
 * @param {string} text
 * @returns {string}
 */
function stripJsonComments(text) {
  return text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n}\]]*/g, (match, str) =>
    str ? str : '',
  );
}

/**
 * If the model output was truncated (e.g. mid-string), close the string and add missing keys.
 * Only injects defaults for keys NOT already present in the truncated output so that
 * partially-written model values aren't silently overwritten by generic fallbacks.
 * @param {string} text - Truncated JSON string
 * @param {object} [defaults] - Default key-value pairs to append when repairing
 * @returns {string|null} Repaired JSON string, or null if unrecoverable
 */
function repairTruncatedJson(text, defaults) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let out = trimmed;
  if (!out.endsWith('}')) {
    if (!out.trimEnd().endsWith('"')) out += '"';
    if (defaults) {
      const missingPairs = getMissingDefaultPairs(out, defaults);
      if (missingPairs.length) {
        out += (out.trimEnd().endsWith(',') ? ' ' : ', ') + missingPairs.join(', ');
      }
    }
    out += '}';
  }
  return out;
}

/**
 * Return serialized key-value pairs from defaults whose keys don't already
 * appear in the (possibly truncated) JSON text.
 * @param {string} partialJson
 * @param {object} defaults
 * @returns {string[]}
 */
function getMissingDefaultPairs(partialJson, defaults) {
  return Object.entries(defaults)
    .filter(([k]) => !partialJson.includes(`"${k}"`))
    .map(([k, v]) => `"${k}": ${JSON.stringify(v)}`);
}
