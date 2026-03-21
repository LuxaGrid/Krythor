import type { CreateSkillInput } from '../types.js';

// ─── Built-in: Explain ────────────────────────────────────────────────────────
//
// Explains a concept at a specified level: beginner, intermediate, or expert.
// The user provides text in the format:
//   "Explain for <beginner|intermediate|expert>: <concept>"
// or just a concept — the model defaults to intermediate level.
//

export const EXPLAIN_SKILL: CreateSkillInput & { builtinId: string } = {
  builtinId: 'builtin:explain',
  name: 'Explain',
  description: 'Explain a concept at beginner, intermediate, or expert level. Prefix with "Explain for beginner:" to set level.',
  systemPrompt: [
    'You are a patient and knowledgeable teacher.',
    'When given a concept or question, explain it at the appropriate level.',
    'Levels:',
    '- "beginner": Use everyday language, simple analogies, no jargon. Assume no prior knowledge.',
    '- "intermediate": Use field terminology, assume basic familiarity, explain subtleties.',
    '- "expert": Use technical precision, reference edge cases, assume professional background.',
    '',
    'Rules:',
    '- If the user specifies a level (e.g. "Explain for beginner:"), use that level.',
    '- If no level is specified, default to intermediate.',
    '- Structure your response with: a 1-sentence overview, then a clear explanation, then an example.',
    '- Keep the response focused — do not over-explain unrelated concepts.',
  ].join('\n'),
  tags: ['builtin', 'explain', 'education'],
  permissions: [],
  taskProfile: {
    taskCategories: ['explain', 'general'],
    costTier:       'cost_aware',
    speedTier:      'normal',
    localOk:        true,
    reasoningDepth: 'medium',
  },
};
