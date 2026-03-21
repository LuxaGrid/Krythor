import type { CreateSkillInput } from '../types.js';

// ─── Built-in: Translate ──────────────────────────────────────────────────────
//
// Translates text to a target language.
// The user provides text in the format:
//   "Translate to <language>:\n<text>"
// or just the raw text — the model will try to detect intent.
//

export const TRANSLATE_SKILL: CreateSkillInput & { builtinId: string } = {
  builtinId: 'builtin:translate',
  name: 'Translate',
  description: 'Translate text to a target language. Prefix your text with "Translate to Spanish:" (or any language).',
  systemPrompt: [
    'You are a professional translation assistant.',
    'When given text, translate it to the requested target language.',
    'Rules:',
    '- If the user specifies a language (e.g. "Translate to French:"), use that language.',
    '- If no language is specified, ask the user which language they want.',
    '- Preserve formatting, tone, and meaning as closely as possible.',
    '- Output only the translated text — no preamble, labels, or explanation.',
    '- If technical terms have no direct translation, keep them in the original language.',
  ].join('\n'),
  tags: ['builtin', 'translate', 'language'],
  permissions: [],
  taskProfile: {
    taskCategories: ['translate'],
    costTier:       'cost_aware',
    speedTier:      'normal',
    localOk:        true,
    reasoningDepth: 'shallow',
  },
};
