# Listing Intelligence Builder

Takes raw property details — beds, baths, square footage, condition, neighborhood notes, and recent comps — and produces a complete listing intelligence package in one pass. The output covers MLS copywriting, selling points, pricing rationale, marketing angle strategies, and agent risk notes, giving the listing agent everything needed to launch confidently.

## Why it's better than a plain LLM prompt

A plain prompt might produce a decent description. This skill produces five interdependent deliverables that feed each other: the marketing angles inform the description tone, the pricing rationale is grounded in comp data, and the agent notes flag what to address before going live. It saves an hour of pre-listing prep and ensures nothing falls through the cracks. The output is saved to memory so it can be referenced throughout the listing lifecycle.

## Inputs

- Property address
- Bedroom and bathroom count
- Square footage
- Condition notes (updates, deferred maintenance, standout features)
- Neighborhood observations (walkability, schools, amenities, character)
- Recent comparable sales data (address, price, days on market, notes)

## Outputs

- **MLS Listing Description** — headline, narrative paragraph, feature bullet list, call to action
- **Top 5 Selling Points** — ranked by buyer appeal with one-sentence rationale each
- **Pricing Range with Rationale** — low / target / ceiling with comp-grounded justification
- **Marketing Angles** — 3 distinct buyer profiles with matched property features
- **Agent Notes** — pricing risks, disclosure flags, positioning challenges

## Permissions Used

- `memory:write` — saves the listing intelligence package for reference throughout the listing period

## Memory Behavior

The full output package is saved to memory at the listing's address key, allowing future skills (e.g. Seller Update Generator) to reference the original pricing rationale and marketing strategy without re-input.

## Ideal Use Cases

- Pre-listing preparation for any residential property
- Refreshing a stale listing with new copy and repositioned marketing angles
- Price reduction analysis — revisiting comp rationale with updated data
- Training new agents on how to build a listing strategy from raw data
- Producing seller presentation materials during the listing consultation
