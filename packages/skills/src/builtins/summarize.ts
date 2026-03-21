import type { CreateSkillInput } from '../types.js';

// ─── Built-in: Summarize ──────────────────────────────────────────────────────
//
// Summarizes any text to bullet points.
// The user's input is the text to summarize.
//

export const SUMMARIZE_SKILL: CreateSkillInput & { builtinId: string } = {
  builtinId: 'builtin:summarize',
  name: 'Summarize',
  description: 'Summarize any text to concise bullet points.',
  systemPrompt: [
    'You are a concise summarization assistant.',
    'When given text, summarize it as a structured list of bullet points.',
    'Rules:',
    '- Use "• " (bullet + space) for each point.',
    '- Capture all key facts, decisions, and outcomes.',
    '- Keep each bullet under 25 words.',
    '- Use 3–10 bullets depending on source length.',
    '- Do not add commentary or preamble — only the bullet list.',
  ].join('\n'),
  tags: ['builtin', 'summarize', 'text'],
  permissions: [],
  taskProfile: {
    taskCategories: ['summarize'],
    costTier:       'cost_aware',
    speedTier:      'fast',
    localOk:        true,
    reasoningDepth: 'shallow',
  },
};
