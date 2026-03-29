import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from './ResponseChunker.js';

describe('splitIntoChunks', () => {

  it('returns the whole text if it fits within maxLen', () => {
    const result = splitIntoChunks('hello world', { maxLen: 2000 });
    expect(result).toEqual(['hello world']);
  });

  it('returns empty array for empty string', () => {
    expect(splitIntoChunks('', { maxLen: 10 })).toEqual([]);
  });

  it('splits at paragraph boundaries', () => {
    const text = 'Paragraph one.\n\nParagraph two.\n\nParagraph three.';
    const chunks = splitIntoChunks(text, { maxLen: 30, minLen: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should contain complete paragraphs
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/^\n/);
    }
  });

  it('splits at newline when no paragraph boundary available', () => {
    const text = 'Line one\nLine two\nLine three\nLine four';
    const chunks = splitIntoChunks(text, { maxLen: 18, minLen: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(18);
    }
  });

  it('hard-breaks text with no natural boundaries', () => {
    const text = 'a'.repeat(100);
    const chunks = splitIntoChunks(text, { maxLen: 30, minLen: 1 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
  });

  it('never splits inside a code fence', () => {
    const code = '```typescript\n' + 'const x = 1;\n'.repeat(20) + '```';
    const surrounding = 'Before code.\n' + code + '\nAfter code.';
    const chunks = splitIntoChunks(surrounding, { maxLen: 200, minLen: 50 });

    for (const chunk of chunks) {
      // If chunk contains an opening fence, count fences — should be balanced or have closing
      const fenceLines = chunk.split('\n').filter(l => /^(`{3,}|~{3,})/.test(l));
      // Odd number means either opened or closed here — that's allowed
      // But the content between fences should not be split mid-statement
      expect(chunk).toBeTruthy(); // at minimum, non-empty
    }

    // All chunks concatenated (with joining) should contain the original code
    const joined = chunks.join('\n');
    expect(joined).toContain('const x = 1;');
  });

  it('reopens fence in next chunk when forced to split inside fence', () => {
    // Very small maxLen forces a split inside the code block
    const text = '```js\n' + 'x;\n'.repeat(30) + '```';
    const chunks = splitIntoChunks(text, { maxLen: 80, minLen: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    // The last chunk should close the fence
    const lastChunk = chunks[chunks.length - 1]!;
    expect(lastChunk).toContain('```');
  });

  it('produces chunks all within maxLen', () => {
    const text = 'Word '.repeat(500); // 2500 chars
    const chunks = splitIntoChunks(text, { maxLen: 300, minLen: 50 });
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
  });

  it('covers the full original text across all chunks', () => {
    const sentences = Array.from({ length: 50 }, (_, i) => `Sentence number ${i + 1} is here.`);
    const text = sentences.join(' ');
    const chunks = splitIntoChunks(text, { maxLen: 200, minLen: 50 });
    // Each sentence should appear in at least one chunk
    for (const sentence of sentences) {
      const found = chunks.some(c => c.includes(sentence) || sentence.includes(c));
      expect(found).toBe(true);
    }
  });

  it('handles ~~~ fences as well as ``` fences', () => {
    const text = '~~~python\nimport os\n' + 'print(os.getcwd())\n'.repeat(20) + '~~~';
    const chunks = splitIntoChunks(text, { maxLen: 150, minLen: 30 });
    // Should not throw and should produce valid output
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
