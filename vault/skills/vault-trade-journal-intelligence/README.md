# Trade Journal Intelligence

## What it does

Analyzes a batch of trades to identify behavioral patterns, recurring mistakes, and genuine strengths. Produces a performance summary, pattern classification (entry / exit / sizing / psychological), a validated or challenged self-assessment, three concrete improvement rules, and a trader profile summary stored in memory for future skill sessions.

## Why it is better than a simple prompt

Pasting trades into a chat and asking "what am I doing wrong?" produces vague, generic feedback. This skill:

- Measures win rate, average win/loss, and profit factor from your raw log
- Identifies specific behavioral patterns with evidence from your actual trades
- Classifies each mistake by type (execution / psychological / planning) so you fix the right thing
- Validates or challenges your own self-assessment — surfaces blind spots
- Produces improvement rules that are concrete and testable, not generic advice
- Builds a persistent trader profile in memory so future sessions (Trade Setup Builder, Stock Opportunity Scanner) have context about your tendencies

This is the skill that turns a trade log into a coaching session.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Trade log | Yes | Paste trades with ticker, direction, entry, exit, P&L, notes |
| Period covered | No | Time range or trade count |
| Trading style | Yes | Day / Swing / Position / Mixed |
| Self-assessment | No | Your own read on what's working and what isn't |

## Outputs

- Performance summary (win rate, avg win/loss, profit factor, best/worst trade)
- Pattern analysis with strength/weakness ratings
- Strengths (specific, evidence-based)
- Top 3 recurring mistakes with classification
- Self-assessment validation
- 3 concrete improvement rules
- Trader profile paragraph (also stored in memory)
- Next step recommendation

## Memory behavior

Writes a trader profile summary to memory — covering behavioral tendencies, strengths, and focus area. This profile is recalled by Trade Setup Builder and Stock Opportunity Scanner to tailor their output to this specific trader's patterns.

## Permissions

- `memory:read` — recall prior trader profile for comparison
- `memory:write` — store updated trader profile

## Ideal use cases

- Monthly or quarterly performance review
- After a losing streak — diagnosing what changed
- After a winning streak — confirming what to repeat
- Onboarding to a new trading strategy — establishing a baseline profile
- Preparing for a mentor or coach review session
