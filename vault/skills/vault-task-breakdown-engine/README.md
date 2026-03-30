# Task Breakdown Engine

## What it does

Takes any complex task, goal, or project description and produces a complete, ready-to-execute plan: a scoped definition of success, a full sub-task breakdown with time estimates and deliverables, a dependency map, an optimal execution sequence with critical path identified, a blockers-and-risks analysis, and a minimum viable completion path for time-constrained situations.

## Why it's better than a plain LLM prompt

"Break this down into steps" produces a generic numbered list. This skill runs a scope definition pass first to prevent misaligned effort, enforces realistic time estimates per task, maps dependencies so you know what is truly parallel vs. sequential, identifies the blockers most likely to kill your momentum before they happen, and always ends with an MVP path — the minimum set of tasks to ship something real when you are out of time. That last section alone makes it a different class of tool.

## Inputs

Describe any of the following:
- A complex task you need to complete (e.g., "launch a new product landing page")
- A goal you want to work toward (e.g., "build a 6-month emergency fund")
- A project that feels overwhelming or unclear (e.g., "migrate our team to a new project management tool")
- A deliverable with a deadline (e.g., "write and submit a conference talk proposal by Friday")

Plain language is fine. More context produces a more accurate breakdown.

## Outputs

1. **Scope Definition** — clear statement of what success looks like, what is in scope, and stated assumptions
2. **Full Task Breakdown** — numbered sub-tasks with active-verb phrasing, time estimate, skill/resource needed, and deliverable produced
3. **Dependency Map** — which tasks require which others, plus parallelizable task groups called out
4. **Recommended Execution Order** — full sequence with critical path identified
5. **Blockers and Risks** — 3-5 likely blockers with mitigation actions
6. **Minimum Viable Completion Path** — the smallest task set that produces a usable result, with trade-offs noted

## Permissions used

None. Operates entirely on the input provided.

## Memory behavior

No memory read or write. Each session is stateless.

## Ideal use cases

- Kicking off any project that feels too big to start
- Breaking out of procrastination by turning a vague goal into a clear first step
- Planning a deadline-driven deliverable when time is limited
- Pre-morteming a project to catch blockers before they occur
- Creating a delegation-ready task list for a team member or contractor
