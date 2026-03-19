# Screenshot Capture Guide

## Required screenshots

| File | What to capture |
|---|---|
| `command.png` | Command tab with a completed conversation — shows a user message and a full AI response with the model badge visible |
| `models.png` | Models tab with at least one provider configured — shows provider list, model list, and status indicators |
| `run-transparency.png` | A completed agent run or command result showing selectionReason and/or fallback info in the run details |
| `onboarding.png` | The onboarding wizard welcome step with auto-detected local providers shown (if available) |

## Naming convention

Lowercase, hyphen-separated, no version numbers:

```
assets/screenshots/command.png
assets/screenshots/models.png
assets/screenshots/run-transparency.png
assets/screenshots/onboarding.png
```

## Capture tips

- Window width: 1280px minimum
- Use a dark system theme to match Krythor's dark UI
- Have at least one real conversation visible in the sidebar for `command.png`
- For `run-transparency.png`: run an agent, then open the run detail to show the selectionReason field
- Crop to the browser viewport only — no browser chrome, no taskbar
- Save as PNG

## After capturing

Add to README.md under the Screenshots section:

```markdown
## Screenshots

![Command Panel](./assets/screenshots/command.png)
![Models & Providers](./assets/screenshots/models.png)
![Run Transparency](./assets/screenshots/run-transparency.png)
![Onboarding](./assets/screenshots/onboarding.png)
```
