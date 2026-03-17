import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine } from '@krythor/models';
import type { GuardEngine } from '@krythor/guard';

// ─── Readiness Checks ─────────────────────────────────────────────────────────
//
// GET /ready returns 200 when the server is ready to serve requests.
// GET /health returns system statistics (existing, always 200).
//
// A server is "ready" when:
//   - The database is accessible (db check passes)
//   - The guard policy is loaded (guard check passes)
//   - Models check is informational only (no providers on first run is ok)
//

export interface ReadinessCheck {
  ok: boolean;
  detail?: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    db: ReadinessCheck;
    guard: ReadinessCheck;
    models: ReadinessCheck;
  };
}

export async function checkReadiness(
  memory: MemoryEngine,
  models: ModelEngine,
  guard: GuardEngine,
): Promise<ReadinessResult> {
  const checks: ReadinessResult['checks'] = {
    db:     { ok: false },
    guard:  { ok: false },
    models: { ok: false },
  };

  // DB check — can we read from the database without throwing?
  try {
    memory.store.getAllEntryCount();
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, detail: err instanceof Error ? err.message : 'Database unreachable' };
  }

  // Guard check — is the policy engine loaded with a known default action?
  try {
    const stats = guard.stats();
    if (stats.defaultAction === 'allow' || stats.defaultAction === 'deny') {
      checks.guard = { ok: true };
    } else {
      checks.guard = { ok: false, detail: 'Guard policy not initialized' };
    }
  } catch (err) {
    checks.guard = { ok: false, detail: err instanceof Error ? err.message : 'Guard engine error' };
  }

  // Models check — informational, does not affect ready status
  try {
    const stats = models.stats();
    if (stats.providerCount > 0) {
      checks.models = { ok: true };
    } else {
      checks.models = { ok: false, detail: 'No providers configured — add one in the Models tab' };
    }
  } catch (err) {
    checks.models = { ok: false, detail: err instanceof Error ? err.message : 'Models engine error' };
  }

  // Ready only requires db + guard to be ok
  const ready = checks.db.ok && checks.guard.ok;

  return { ready, checks };
}
