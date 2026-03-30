# Portfolio Insight Engine

## What it does

Analyzes a portfolio's composition for structural quality. Given a list of holdings with percentage allocations, it identifies sector concentrations, correlation clusters, diversification gaps, and misalignments with the stated goal and time horizon. Produces a health score, specific weaknesses, and prioritized improvement recommendations.

## Why it is better than a simple prompt

Asking "is my portfolio diversified?" produces a generic yes/no. This skill:

- Maps holdings to sectors and asset classes automatically
- Detects specific concentration risks (flags any sector >30%)
- Identifies correlation clusters — groups of positions that will move together in a downturn
- Evaluates fit against your stated goal (e.g. a growth-goal portfolio with 40% bonds is flagged as misaligned)
- Produces 3–5 structural improvement recommendations in priority order
- Assigns a portfolio health score so you can track improvement over time

The output is a structured portfolio audit — not a vague list of concerns.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Holdings | Yes | Tickers with % allocation (ETFs, bonds, cash included) |
| Portfolio size | No | Total value — for dollar-level context |
| Goal | Yes | Long-term growth / Balanced / Capital preservation / Aggressive / Income |
| Time horizon | Yes | < 1 year / 1–3 / 3–10 / 10+ years |
| Specific concerns | No | Anything you already suspect is a problem |

## Outputs

- Portfolio snapshot by sector/asset class
- Diversification assessment with rating
- Risk exposure analysis and vulnerability identification
- Weaknesses and gaps vs. stated goal
- 3–5 prioritized improvement recommendations (structural, not stock picks)
- Portfolio health score (1–10) and verdict
- Next step recommendation

## Memory behavior

Reads from memory to recall prior portfolio snapshots for comparison. Writes current portfolio profile to memory so future sessions can track how the portfolio has evolved.

## Permissions

- `memory:read` — recall prior portfolio snapshots
- `memory:write` — store current portfolio profile

## Ideal use cases

- Quarterly portfolio review
- After adding several new positions — checking if concentration has drifted
- Before a major market event — identifying biggest vulnerabilities
- For someone who has inherited or built a portfolio without a structured process
