# Priority Triage Engine

**Category:** Productivity
**ID:** vault-priority-triage-engine
**Version:** 1.0.0

## What It Does

Priority Triage Engine takes a raw dump of everything you are holding — tasks, requests, messages, obligations, ideas, commitments — and immediately sorts it into a four-tier priority grid. It adds time estimates for every high-priority item, designs an optimal 2-hour execution plan, explicitly handles the items you should delegate or drop, and flags cognitive overload if your Tier 1 list exceeds what is actually achievable today.

This is the skill for moments when your head is full, your list is overwhelming, and you need someone to just tell you what to do next.

## Why It's Better Than a Plain LLM Prompt

A plain prompt re-lists your tasks in a different order. This skill:

- Applies a rigorous four-tier framework — not a simple high/medium/low label — that forces genuine triage, including explicit delegation and drop decisions
- Adds time estimates to every priority item so you know whether your Tier 1 is actually achievable today
- Designs a concrete 2-hour execution plan as a mini time-block schedule, not just a reordered list
- Produces an explicit Delegation and Deferral Log so that dropped and delegated items are handled, not abandoned
- Raises a Cognitive Overhead Alert if the workload is unrealistic, with specific items to renegotiate — rather than leaving you to discover the overload at 5pm

## Inputs

Just dump everything. Any format works:

- A bullet list of tasks
- A stream-of-consciousness paragraph
- A list of emails, Slack threads, and obligations
- A mix of work tasks, personal obligations, and incoming requests
- Notes from a meeting, inbox, or whatever is on your mind

More items = better triage. Do not pre-filter — give the engine everything.

## Outputs

1. Triage Grid (all items sorted into 4 tiers: Urgent+Important / Important / Low Priority / Delegate or Drop)
2. Time Estimates (for all Tier 1 and Tier 2 items)
3. Next 2-Hour Execution Plan (time-block mini schedule)
4. Delegation and Deferral Log (specific handling for every Tier 4 item)
5. Cognitive Overhead Alert (if applicable, with specific renegotiation recommendations)

## Permissions Used

None. This skill operates entirely on the information you provide. No memory access is required — triage is a real-time, in-context operation.

## Memory Behavior

No memory access. All analysis is performed on the inputs provided in the current session. If you want prior context (carry-over tasks, weekly goals) included in the triage, paste them in directly or run the Weekly Planning System first.

## Ideal Use Cases

- Monday morning when everything feels urgent at once
- Post-vacation inbox and obligation clearance
- Mid-week reset when the plan has broken down
- Before a busy afternoon when you have 2 hours and a long list
- Processing a sudden pile of incoming requests or escalations
- Any moment when you are frozen by too many options and need a clear next action
