import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillFileLoader } from './SkillFileLoader.js';

let tmpDir: string;

function makeSkillDir(baseDir: string, dirName: string, content: string): string {
  const p = join(baseDir, dirName);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'SKILL.md'), content, 'utf-8');
  return p;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-skillfile-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SkillFileLoader', () => {
  it('returns empty array when directory does not exist', () => {
    const loader = new SkillFileLoader([join(tmpDir, 'nonexistent')]);
    expect(loader.loadSkills()).toHaveLength(0);
  });

  it('returns empty array when directory has no SKILL.md files', () => {
    const loader = new SkillFileLoader([tmpDir]);
    expect(loader.loadSkills()).toHaveLength(0);
  });

  it('loads a simple skill', () => {
    makeSkillDir(tmpDir, 'hello', `---
name: hello-skill
description: A hello skill
---

Say hello to the user.`);
    const loader = new SkillFileLoader([tmpDir]);
    const skills = loader.loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('hello-skill');
    expect(skills[0]!.description).toBe('A hello skill');
    expect(skills[0]!.systemPrompt).toBe('Say hello to the user.');
  });

  it('uses directory name as skill name when frontmatter has no name', () => {
    makeSkillDir(tmpDir, 'my-skill', `---
description: No name in frontmatter
---

Instructions here.`);
    const loader = new SkillFileLoader([tmpDir]);
    const skills = loader.loadSkills();
    expect(skills[0]!.name).toBe('my-skill');
  });

  it('parses tags array', () => {
    makeSkillDir(tmpDir, 'tagged', `---
name: tagged-skill
description: Has tags
tags: [code, review, analysis]
---

Instructions.`);
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills[0]!.tags).toEqual(['code', 'review', 'analysis']);
  });

  it('parses boolean fields', () => {
    makeSkillDir(tmpDir, 'disabled', `---
name: disabled-skill
description: Disabled
enabled: false
userInvocable: false
---

Content.`);
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills[0]!.enabled).toBe(false);
    expect(skills[0]!.userInvocable).toBe(false);
  });

  it('defaults enabled and userInvocable to true', () => {
    makeSkillDir(tmpDir, 'defaults', `---
name: defaults-skill
description: Defaults
---

Content.`);
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills[0]!.enabled).toBe(true);
    expect(skills[0]!.userInvocable).toBe(true);
  });

  it('parses modelId and timeoutMs', () => {
    makeSkillDir(tmpDir, 'custom-model', `---
name: custom-model-skill
description: Custom model
modelId: claude-sonnet-4-6
timeoutMs: 30000
---

Use this model.`);
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills[0]!.modelId).toBe('claude-sonnet-4-6');
    expect(skills[0]!.timeoutMs).toBe(30000);
  });

  it('generates stable IDs based on path', () => {
    makeSkillDir(tmpDir, 'stable', `---
name: stable-skill
description: Stable ID
---

Content.`);
    const loader = new SkillFileLoader([tmpDir]);
    const run1 = loader.loadSkills();
    const run2 = loader.loadSkills();
    expect(run1[0]!.id).toBe(run2[0]!.id);
    expect(run1[0]!.id).toMatch(/^file:[0-9a-f]{12}$/);
  });

  it('loads multiple skills from the same directory', () => {
    makeSkillDir(tmpDir, 'skill-a', `---\nname: skill-a\ndescription: A\n---\nA`);
    makeSkillDir(tmpDir, 'skill-b', `---\nname: skill-b\ndescription: B\n---\nB`);
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.name).sort()).toEqual(['skill-a', 'skill-b']);
  });

  it('earlier directory takes precedence over later on name conflict', () => {
    const dir1 = join(tmpDir, 'workspace');
    const dir2 = join(tmpDir, 'global');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    // Same skill name in both
    makeSkillDir(dir1, 'shared-skill', `---\nname: shared\ndescription: Workspace version\n---\nWorkspace`);
    makeSkillDir(dir2, 'shared-skill', `---\nname: shared\ndescription: Global version\n---\nGlobal`);

    const loader = new SkillFileLoader([dir1, dir2]);
    const skills = loader.loadSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.description).toBe('Workspace version');
    expect(skills[0]!.systemPrompt).toBe('Workspace');
  });

  it('skips non-directory entries', () => {
    writeFileSync(join(tmpDir, 'SKILL.md'), `---\nname: top-level\ndescription: Top\n---\nContent`);
    // Only sub-directories are scanned, not files in root
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('skips directories without SKILL.md', () => {
    mkdirSync(join(tmpDir, 'no-skill-md'), { recursive: true });
    const skills = new SkillFileLoader([tmpDir]).loadSkills();
    expect(skills).toHaveLength(0);
  });

  it('returns file path metadata in load()', () => {
    makeSkillDir(tmpDir, 'with-path', `---\nname: path-skill\ndescription: D\n---\nContent`);
    const entries = new SkillFileLoader([tmpDir]).load();
    expect(entries[0]!.filePath).toContain('SKILL.md');
  });
});
