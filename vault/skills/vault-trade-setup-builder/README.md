# Trade Setup Builder

## What it does

Converts a trade thesis into a complete, structured trade plan. Given a ticker, direction, timeframe, and entry thesis, it produces: an ideal entry zone with trigger condition, two profit targets, a stop loss with reasoning, a risk/reward ratio, position sizing guidance, and explicit trade management rules for common scenarios.

## Why it is better than a simple prompt

Traders who plan trades in the moment make emotional decisions. This skill:

- Forces all key decisions (entry, stop, targets) to be made before entering the trade
- Calculates risk/reward automatically when a current price is provided
- Computes exact position size if you provide your account risk percentage
- Documents trade management rules — so you know what to do if price stalls at T1 or reverses after entry
- Ends with an immediate next-step recommendation

The output is a complete trade brief you can reference while managing the position — not a vague recommendation.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Ticker | Yes | The stock being traded |
| Direction | Yes | Long or Short |
| Timeframe | Yes | Scalp / Day trade / Swing / Position |
| Entry thesis | Yes | Why you are considering this trade |
| Current price | No | Used to calculate R:R ratios |
| Max account risk % | No | Used to calculate position size |

## Outputs

- Trade overview (classification, restated thesis)
- Entry plan: zone, trigger condition, invalidation conditions
- Exit plan: T1, T2, stop loss, trailing stop guidance
- Risk profile: R:R ratio, position sizing, verdict
- Trade management rules (stall at T1, re-entry, full invalidation)
- Next step recommendation

## Memory behavior

Reads from memory to incorporate previously stored trader risk preferences. Writes the trade plan summary to memory for later review in Trade Journal Intelligence.

## Permissions

- `memory:read` — recall risk preferences from prior sessions
- `memory:write` — store trade plan for journal follow-up

## Ideal use cases

- Pre-market trade preparation
- Structuring a swing trade idea before end of day
- Forcing discipline before entering a position sized larger than usual
- Building a record of planned trades to compare against actual results
