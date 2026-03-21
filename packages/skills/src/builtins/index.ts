// ─── Built-in Skill Templates ─────────────────────────────────────────────────
//
// These are the three built-in skills shipped with Krythor.
// They are returned by GET /api/skills/builtins so the UI can display them
// without requiring the user to create them first.
// They can also be created via POST /api/skills (they are not auto-installed).
//

export { SUMMARIZE_SKILL } from './summarize.js';
export { TRANSLATE_SKILL } from './translate.js';
export { EXPLAIN_SKILL }   from './explain.js';

import { SUMMARIZE_SKILL } from './summarize.js';
import { TRANSLATE_SKILL } from './translate.js';
import { EXPLAIN_SKILL }   from './explain.js';

import type { CreateSkillInput } from '../types.js';

export type BuiltinSkillTemplate = CreateSkillInput & { builtinId: string };

export const BUILTIN_SKILLS: BuiltinSkillTemplate[] = [
  SUMMARIZE_SKILL,
  TRANSLATE_SKILL,
  EXPLAIN_SKILL,
];
