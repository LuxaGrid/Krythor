# Stock Opportunity Scanner

## What it does

Evaluates a list of stock tickers and ranks them by opportunity quality for a given trading timeframe. Produces a structured output for each ticker — setup type, key levels, risk/reward verdict, one-sentence thesis, and one key risk — followed by a ranked summary table and a top pick.

## Why it is better than a simple prompt

A basic "which stocks look good?" prompt produces vague, unstructured output that shifts with every run. This skill:

- Evaluates each ticker against the same criteria every time
- Ranks by opportunity quality with explicit reasoning
- Adapts its weighting to your timeframe (day trade vs. swing vs. position)
- Incorporates your market context so analysis isn't done in a vacuum
- Ends with a clear top pick and a next-step recommendation — not just a list

The result is a repeatable scanning workflow that produces consistent, comparable output session to session.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Tickers | Yes | Comma-separated list of tickers to evaluate |
| Trading timeframe | Yes | Day trade / Swing trade / Position trade |
| Market context | No | Macro or sector conditions to factor in |
| Opportunity criteria | No | Setup type you are looking for (breakout, bounce, etc.) |

## Outputs

For each ticker:
- Opportunity score (1–10)
- Setup classification
- Key level to watch
- Risk/reward verdict (favorable / neutral / unfavorable)
- One-sentence thesis
- One key risk

Followed by:
- Ranked summary table
- Top pick with justification
- Suggested next step

## Memory behavior

Reads from memory to recall previously stored ticker preferences or watchlists. Writes a summary of the session's top opportunities to memory so future Trade Setup Builder sessions have context.

## Permissions

- `memory:read` — recall prior watchlist preferences
- `memory:write` — store top opportunities for follow-up

## Ideal use cases

- Morning pre-market scan before the trading day
- Weekend watchlist building for the coming week
- Narrowing down a large watchlist to the top 2–3 actionable ideas
- Comparing setups across a sector before picking one to trade
