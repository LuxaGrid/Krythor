// ─── ResponseChunker ──────────────────────────────────────────────────────────
//
// Splits long AI responses into message-sized chunks suitable for chat channels.
//
// Split algorithm:
//   1. Never split inside a fenced code block (``` or ~~~). If a hard break
//      is required mid-fence, reopen the fence in the next chunk.
//   2. Prefer breaks at paragraph boundaries (double newline).
//   3. Fall back to single newline if no paragraph boundary within window.
//   4. Fall back to sentence boundary (. ! ?) if no newline within window.
//   5. Fall back to whitespace if no sentence boundary.
//   6. Hard-break at maxLen if nothing better found.
//
// Configuration:
//   maxLen   — Maximum characters per chunk. Default: 2000.
//   minLen   — Prefer not breaking before this length. Default: 200.
//              (Avoids very short first chunks.)
//

export interface ResponseChunkerOptions {
  maxLen?: number;
  minLen?: number;
}

// Matches opening/closing code fence lines: ``` or ~~~, optionally with lang tag
const FENCE_RE = /^(`{3,}|~{3,})/m;

export function splitIntoChunks(text: string, options: ResponseChunkerOptions = {}): string[] {
  const maxLen = options.maxLen ?? 2_000;
  const minLen = options.minLen ?? 200;

  if (text.trim().length === 0) return [];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let activeFence: string | null = null; // fence marker (``` or ~~~) if inside a fence

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      // Close the fence if we're inside one
      chunks.push(activeFence ? `${activeFence}\n${remaining.trimEnd()}` : remaining);
      remaining = '';
      activeFence = null;
      break;
    }

    // Find the best break point within [minLen, maxLen]
    const window = remaining.slice(0, maxLen);
    const breakAt = findBreak(window, minLen, maxLen, activeFence !== null);

    let chunk = remaining.slice(0, breakAt);
    remaining = remaining.slice(breakAt).replace(/^\n+/, '');

    // Track code fence state across the cut
    const { insideFence, lastFenceMarker } = trackFences(chunk, activeFence);

    if (insideFence && lastFenceMarker) {
      // Close the fence at end of this chunk
      chunk = `${chunk.trimEnd()}\n${lastFenceMarker}`;
      // Reopen in the next chunk
      activeFence = lastFenceMarker;
    } else {
      activeFence = insideFence ? lastFenceMarker : null;
    }

    if (activeFence && remaining.length > 0) {
      // Prepend the reopened fence marker to the next chunk
      remaining = `${activeFence}\n${remaining}`;
    }

    chunks.push(chunk.trim());
  }

  return chunks.filter(c => c.trim().length > 0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the best character index to break `text` at.
 * Searches backward from maxLen looking for preferred boundaries.
 */
function findBreak(text: string, minLen: number, maxLen: number, insideFence: boolean): number {
  const searchFrom = Math.min(text.length, maxLen);

  if (insideFence) {
    // Inside a code block: only break at newline to preserve structure
    const nl = text.lastIndexOf('\n', searchFrom);
    if (nl >= minLen) return nl + 1;
    return searchFrom; // hard break
  }

  // 1. Paragraph boundary (double newline)
  const para = text.lastIndexOf('\n\n', searchFrom);
  if (para >= minLen) return para + 2;

  // 2. Single newline
  const nl = text.lastIndexOf('\n', searchFrom);
  if (nl >= minLen) return nl + 1;

  // 3. Sentence boundary
  const sentMatch = findLastSentenceBoundary(text, minLen, searchFrom);
  if (sentMatch !== -1) return sentMatch + 1;

  // 4. Whitespace
  const ws = text.lastIndexOf(' ', searchFrom);
  if (ws >= minLen) return ws + 1;

  // 5. Hard break
  return searchFrom;
}

function findLastSentenceBoundary(text: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
      return i;
    }
  }
  return -1;
}

/**
 * Walk the text and track whether we're inside a code fence at the end.
 * Returns { insideFence: boolean, lastFenceMarker: string | null }.
 */
function trackFences(text: string, initialFence: string | null): { insideFence: boolean; lastFenceMarker: string | null } {
  let insideFence = initialFence !== null;
  let lastFenceMarker = initialFence;

  const lines = text.split('\n');
  for (const line of lines) {
    const match = FENCE_RE.exec(line);
    if (match) {
      if (!insideFence) {
        insideFence = true;
        lastFenceMarker = match[1] ?? '```';
      } else {
        insideFence = false;
      }
    }
  }

  return { insideFence, lastFenceMarker };
}
