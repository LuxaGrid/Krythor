# Risk & Position Sizer

## What it does

Computes the correct position size for a trade using account size, risk percentage, entry price, and stop loss price. Shows every step of the calculation, validates the risk/reward ratio, checks against concentration limits, and produces a pass/fail risk rule checklist before the trader enters the position.

## Why it is better than a simple prompt

Asking "how many shares should I buy?" without structure produces a rough estimate. This skill:

- Computes exact position size to the share using your personal risk parameters
- Shows the full calculation step-by-step — not a black box
- Flags concentration risk if position exceeds 20% or 50% of account
- Validates stop distance (too tight? too wide?)
- Computes risk/reward ratio and rates it (Strong / Good / Acceptable / Poor)
- Runs a 4-point risk rule checklist so you can confirm discipline before entering
- Tells you exactly what to change if the trade fails risk standards

This skill enforces the habit that separates consistent traders from inconsistent ones: calculating risk before entering, every time.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Account size | Yes | Total trading account in USD |
| Risk per trade (%) | Yes | % of account to risk (typical: 0.5%–2%) |
| Entry price | Yes | Planned entry price per share |
| Stop loss price | Yes | Stop loss price |
| Target price | No | Profit target — enables R:R calculation |
| Ticker | No | For labeling output |
| Instrument type | Yes | Stocks / Options / Futures / Forex |

## Outputs

- Dollar risk per trade
- Risk per share/unit
- Position size (shares/contracts)
- Total position value and % of account
- Concentration flags (>20%, >50%)
- Stop distance validation
- Risk/reward ratio and verdict (if target provided)
- 4-point risk rule checklist
- Plain-English summary
- Next step recommendation

## Memory behavior

Reads stored risk preferences (preferred risk % per trade) from prior sessions. Writes the user's confirmed risk parameters to memory so future Trade Setup Builder sessions can pre-populate these values.

## Permissions

- `memory:read` — recall stored risk preferences
- `memory:write` — store confirmed risk parameters for future sessions

## Ideal use cases

- Before every trade — building the discipline habit
- When considering a larger-than-usual position
- When a stop is farther away than normal — checking if you need to size down
- Teaching new traders to think about risk before price targets
- Reviewing whether a past trade was correctly sized
