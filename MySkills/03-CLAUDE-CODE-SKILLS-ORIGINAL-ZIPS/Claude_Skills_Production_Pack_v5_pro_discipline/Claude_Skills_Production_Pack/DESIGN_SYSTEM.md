# Tailwind Design System (Practical)

## Layout
- Container: max-w-5xl, centered, px-4
- Page spacing: py-10 (desktop), py-6 (mobile)
- Sections: space-y-6

## Typography (simple hierarchy)
- H1: text-3xl md:text-4xl font-semibold tracking-tight
- H2: text-xl md:text-2xl font-semibold tracking-tight
- Body: text-base leading-7
- Muted: text-sm text-neutral-500

## Buttons
- Primary: solid bg, clear hover/focus ring
- Secondary: subtle background
- Destructive: red tone, confirm destructive actions

## Inputs
- Label always visible
- Error message directly under field
- Focus ring visible

## States
- Loading: Skeleton
- Empty: EmptyState with a CTA
- Error: Actionable message + Retry button when possible

