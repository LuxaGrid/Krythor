# START HERE — Claude Code Skills Pack (Production)

This pack is designed for **Next.js + Firebase Hosting** projects (Pages Router first, App Router supported).

## 0) Drop-in Install (recommended)
Copy these into your repo root:
- `.claude/`
- `scripts/`
- `templates/`
- `START_HERE.md`, `ERROR_PLAYBOOK.md`, `DEFINITION_OF_DONE.md`

> Tip: keep this pack in a personal “starter repo” and copy into each new project.

## 1) New App Setup (run once per repo)
Run these skills in order:

1. `/00-setup-workflow`
2. `/00-setup-env`
3. `/00-setup-tailwind-ui`
4. `/00-setup-firebase-hosting`

## 2) Daily Feature Loop (use constantly)
1. `/30-ux-flow <feature>`
2. `/30-ui-build-pages <feature>`
3. `/30-ui-polish <page-or-component>`
4. `/10-check`
5. `/35-test-playwright-smoke <route>`

## 3) Fix Loop (when anything breaks)
1. `/20-fixloop "<what broke + expected vs actual>"`

## 4) Before Deploy (Firebase Hosting)
1. `/40-firebase-hosting-check`
2. `/40-security-audit-quick`
3. `/40-release-check`

---

## How to run without “skills” (optional)
If you prefer commands, these scripts work anywhere:

- `bash scripts/bugpack.sh "note"`
- `bash scripts/check.sh`
- `bash scripts/fixloop.sh "what broke"`
- `bash scripts/playwright_smoke.sh "/route"`

You can wire these into `package.json` if you want:
```json
{
  "scripts": {
    "check": "bash scripts/check.sh",
    "bugpack": "bash scripts/bugpack.sh",
    "fixloop": "bash scripts/fixloop.sh"
  }
}
```



## Big Tasks (Orchestrator)
Use this when a task is bigger than a quick fix (multi-file work, new feature, refactor):
- `/50-orchestrate-big-task <goal>`


**Orchestrator note:** `/50-orchestrate-big-task` creates `PLAN.md` + `TASKS.md` (checkbox punch-list). Move ONE task into In Progress at a time.


## Pro Add-ons
- `/00-bootstrap-project` (one-command setup)
- `/05-architecture-scan` (repo structure report)
- `/40-firebase-rules-guard` (rules safety report)
- `/45-performance-pass` (quick perf report)
- `/50-orchestrate-resume` (continue TASKS.md)


## Discipline Merge
- `/20-debug-root-cause "what broke"`
- `/55-review-two-stage`
- `/48-finish-branch prod`
