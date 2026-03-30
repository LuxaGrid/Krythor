# Personal Context Assistant

## What it does

Builds and maintains a structured personal and professional profile in memory. On first use, takes whatever context you provide and organizes it into a clean profile covering your role, goals, projects, voice, communication style, and preferences. On every subsequent use, retrieves that profile automatically and uses it to personalize any output to match your voice, goals, and situation — without you having to re-explain yourself.

## Why it's better than a plain LLM prompt

Every session with a plain LLM starts from zero. You re-explain your context, your tone, your audience, your constraints — every time. This skill solves that permanently. One profile build session is all it takes. From that point forward, emails, posts, plans, and drafts are generated with knowledge of who you are, how you write, what you are working on, and what your audience expects. The personalization note at the bottom of each output makes the adaptation visible and lets you catch anything that needs updating.

## Inputs

**Profile Build (first use):**
Provide any combination of:
- Your name and professional role
- Current projects and their status
- Short-term and long-term goals
- How you like to communicate (formal/casual, direct/diplomatic, etc.)
- Writing quirks, preferred vocabulary, phrases to avoid
- Who your typical audience is and what they value
- Any hard preferences or constraints (e.g., "never use corporate jargon", "always include a CTA")

**Subsequent use:**
Just make a request normally. The profile is retrieved automatically.

## Outputs

**Profile Build:** A clean structured profile under named headings, presented for your review, then saved to memory.

**Personalized Output:** Any writing, planning, or communication output tailored to your stored profile, with a personalization note at the end explaining which profile elements shaped the output.

## Permissions used

`memory:read` + `memory:write` — reads the stored profile before generating any output; writes and updates the profile when new context is provided.

## Memory behavior

Writes a full structured profile on first use. Updates specific fields when new context is provided. Reads the profile automatically at the start of every output generation request. The profile persists across all sessions.

## Ideal use cases

- Ensuring all AI-generated writing sounds like you, not a generic AI
- Giving a consistent communication baseline for emails, posts, and documents
- Keeping AI outputs aligned with your current priorities and projects
- Onboarding an AI that actually knows your professional context
- Maintaining voice consistency across a large content volume
