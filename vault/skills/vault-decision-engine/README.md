# Decision Engine

**Category:** Business
**ID:** vault-decision-engine
**Version:** 1.0.0

## What It Does

Decision Engine applies structured decision analysis to any business choice. You provide the decision, the options you are weighing, your constraints, and your goals — and the skill produces a weighted decision matrix, a detailed pros/cons analysis tied to your actual goals, a single recommended choice with clear reasoning, a risk assessment for each path, and a concrete validation step to take before fully committing.

This is not a pros/cons list generator. It is a structured analytical process that weights options against what you actually care about and produces a defensible recommendation.

## Why It's Better Than a Plain LLM Prompt

A plain prompt produces unweighted, generic pros/cons that treat all criteria as equal and often avoid making a call. This skill:

- Builds a scored decision matrix weighted by your stated goals and constraints
- Forces every pro and con to be tied to your specific goals — no generic filler
- Makes a single, explicit recommendation rather than presenting options and deferring to you
- Surfaces path-specific risks, not abstract risk commentary
- Ends with a validation step so you can stress-test the recommendation before committing

## Inputs

- **Decision description** — what you are deciding (be specific)
- **Options** — 2 or more distinct paths being considered
- **Constraints** — budget limits, time pressure, resources, non-negotiables
- **Goals or success criteria** — what a good outcome looks like; what you are optimizing for

## Outputs

1. Decision Restatement (confirms shared understanding)
2. Decision Matrix (weighted scoring table)
3. Pros and Cons per option (goal-tied)
4. Recommended Choice with reasoning
5. Risks by Path
6. Validation Next Step

## Permissions Used

None. This skill operates entirely on the information you provide in the conversation.

## Memory Behavior

No memory access. All analysis is performed on the inputs you provide. If you want prior context about a related decision or project to be included, paste it directly into your prompt.

## Ideal Use Cases

- Build vs. buy vs. partner decisions
- Hiring decisions between multiple candidates
- Choosing between competing product or strategic directions
- Vendor or tool selection with multiple contenders
- Investment or resource allocation choices
- Any high-stakes decision where you need to move past gut feel and impose structure
