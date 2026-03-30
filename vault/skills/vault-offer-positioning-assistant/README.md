# Offer Positioning Assistant

Analyzes a specific offer scenario — list price, comp data, competition level, buyer motivation, and any known seller context — and produces a precise strategic brief. The output covers recommended offer price with rationale, a full terms strategy, a risk assessment, and a negotiation talking points brief the agent can use immediately.

## Why it's better than a plain LLM prompt

Offer strategy is where transactions are won or lost, and a plain prompt produces advice of unpredictable structure. This skill enforces the four components that experienced negotiators actually need: a price recommendation grounded in comps (not just intuition), a complete terms package (not just price), an honest risk register, and ready-to-use talking points for the presentation. No permissions are needed because offer analysis is self-contained — all inputs come from the current scenario.

## Inputs

- List price
- Recent comparable sales data (address, price, DOM, condition delta notes)
- Competition level (no other offers / light interest / active multiple offer situation)
- Buyer motivation level and flexibility (must-have vs. would-like)
- Seller situation (if known — timeline, motivation, financial pressure)
- Buyer's pre-approval status and financial flexibility

## Outputs

- **Recommended Offer Price** — specific number or tight range with comp-grounded rationale
- **Terms Strategy** — escalation clause, inspection approach, contingencies, earnest money, closing timeline, concessions
- **Risk Assessment** — top 2-3 risks with likelihood ratings and mitigation options
- **Negotiation Talking Points Brief** — strongest arguments, terms defense, and 2 counter-offer scenarios

## Permissions Used

None. All inputs are provided at invocation time and no persistent data access is required.

## Memory Behavior

No memory operations. This skill is stateless by design — offer scenarios are highly time-sensitive and context-specific, making persistent memory unnecessary and potentially misleading.

## Ideal Use Cases

- Pre-offer strategy session with a buyer before writing the contract
- Multiple offer situations where every term decision matters
- First-time buyers who need the terms strategy explained and justified
- Agents who want a second opinion before advising a client on offer price
- Documenting the reasoning behind offer decisions for buyer file records
