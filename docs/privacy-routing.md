# Privacy-Aware Model Routing

`PrivacyRouter` wraps `ModelEngine` and automatically classifies request content by sensitivity before deciding whether to allow remote model inference or reroute to a local provider.

---

## How It Works

```
infer(request, context?) called
      |
      v
classifySensitivity(content + metadata)
      |
      v
SensitivityLabel: public | internal | private | restricted
      |
      +─────────────────────────────────────────────────+
      |                                                 |
  public / internal                          private / restricted
      |                                                 |
      v                                                 v
Remote allowed                              findLocalProvider()
      |                                          |
      v                                     Found?
ModelEngine.infer(request)             Yes ──────────────► Reroute request
      |                                                     to local provider ID
      v                                No ──────────────► blockOnPrivate?
InferResultWithPrivacy                        |               |
  privacyDecision: {                      true: throw   false: allow remote
    sensitivityLabel: 'public',           PrivacyBlockedError   (with warning)
    remoteAllowed: true,
    reason: '...'
  }
```

---

## Sensitivity Labels

### public
Content with no privacy signals. Safe for cloud transmission.

### internal
Content that references internal paths, workspace directories, or is marked `[INTERNAL]`.

Pattern examples:
- `/workspace/` in content
- `C:\Users\<name>\` Windows user paths
- `[INTERNAL]` marker in text

### private
Content containing personally identifiable information or credentials.

Pattern examples:
- `[PRIVATE]` marker
- Email addresses: `user@example.com`
- Phone numbers: `(555) 123-4567`, `+1-800-555-0000`
- File paths: `.ssh/`, `.env`
- Credential patterns: `password=`, `secret=`, `token=`, `api_key=`

### restricted
The highest sensitivity level. Contains credentials, financial data, or government identifiers.

Pattern examples:
- `[RESTRICTED]` marker
- Social Security Numbers: `123-45-6789`
- Credit card numbers (Luhn-checkable patterns)
- Passport numbers: `A12345678`

---

## Local Provider Discovery

When content is classified as `private` or `restricted`, `PrivacyRouter` searches for a local provider in this order:

1. **Ollama** — any provider with `providerId` containing `ollama`
2. **GGUF** — any provider with `providerId` containing `gguf`
3. **Localhost OpenAI-compat** — any provider whose base URL is `localhost` or `127.0.0.1`

The first matching local provider's ID is used for the rerouted request.

If no local provider is found:
- `blockOnPrivate: false` (default) — allows the request to proceed to the original provider with a warning logged
- `blockOnPrivate: true` — throws `PrivacyBlockedError`

---

## Usage

```typescript
import { PrivacyRouter } from '@krythor/models';

const privacyRouter = new PrivacyRouter(
  modelEngine,
  false,  // blockOnPrivate: false = allow fallback to remote
);

const result = await privacyRouter.infer({
  model: 'claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Summarise this: [PRIVATE] token=abc123' }],
});

console.log(result.privacyDecision);
// {
//   sensitivityLabel: 'private',
//   remoteAllowed: false,
//   reroutedTo: 'ollama',
//   redactionApplied: false,
//   reason: 'Content contains private patterns'
// }
```

---

## InferResultWithPrivacy

Every response from `PrivacyRouter.infer()` includes a `privacyDecision` field:

```typescript
interface PrivacyDecision {
  sensitivityLabel: SensitivityLabel;   // 'public' | 'internal' | 'private' | 'restricted'
  remoteAllowed: boolean;               // Was the original remote provider used?
  reroutedTo?: string;                  // Provider ID if rerouted
  redactionApplied: boolean;            // Always false in current implementation
  reason: string;                       // Human-readable explanation
}
```

---

## PrivacyBlockedError

Thrown when `blockOnPrivate: true` and no local provider is available:

```typescript
import { PrivacyBlockedError } from '@krythor/models';

try {
  await privacyRouter.infer(request);
} catch (e) {
  if (e instanceof PrivacyBlockedError) {
    console.log(e.sensitivityLabel);   // 'restricted'
    console.log(e.message);            // 'Content is restricted — no local provider available'
  }
}
```

---

## Audit Integration

Privacy decisions are recorded in the audit log:

```json
{
  "actionType": "model:infer",
  "privacyDecision": {
    "sensitivityLabel": "private",
    "remoteAllowed": false,
    "reroutedTo": "ollama",
    "redactionApplied": false,
    "reason": "Content contains private patterns"
  }
}
```

The `AuditPanel` in the Control UI shows a privacy badge on rows where rerouting occurred:
- Blue `local` badge — rerouted to a local provider
- Red `blocked` badge — remote was blocked (no local provider)
- Amber `<label>` badge — non-public but allowed through

---

## Configuration

`PrivacyRouter` has no configuration file. Sensitivity patterns are compiled-in regexes in `PrivacyRouter.ts`. The `blockOnPrivate` flag is passed at construction time in `server.ts`.

To add custom sensitivity patterns, extend `PrivacyRouter` or override `classifySensitivity()`:

```typescript
class MyPrivacyRouter extends PrivacyRouter {
  classifySensitivity(content: string): SensitivityLabel {
    if (content.includes('COMPANY_SECRET')) return 'restricted';
    return super.classifySensitivity(content);
  }
}
```
