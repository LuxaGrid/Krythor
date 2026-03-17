# Workflow (Fast + Repeatable)

## New App Setup (once)
- /00-setup-workflow
- /00-setup-env
- /00-setup-tailwind-ui
- /00-setup-firebase-hosting

## Daily Feature Loop
- /30-ux-flow
- /30-ui-build-pages
- /30-ui-polish
- /10-check
- /35-test-playwright-smoke

## Bug Fix Loop
- /20-fixloop

## Release
- /40-release-check


## Orchestrator (big tasks)
- /50-orchestrate-big-task


**Orchestrator note:** `/50-orchestrate-big-task` creates `PLAN.md` + `TASKS.md` (checkbox punch-list). Move ONE task into In Progress at a time.


## Pro Add-ons
- /00-bootstrap-project
- /05-architecture-scan
- /40-firebase-rules-guard
- /45-performance-pass
- /50-orchestrate-resume


## Discipline Merge
- /20-debug-root-cause
- /55-review-two-stage
- /48-finish-branch
