// ─── SessionTranscriptStore ───────────────────────────────────────────────────
//
// Persists agent run transcripts to JSONL files under:
//   <sessionsBaseDir>/agents/<agentId>/sessions/<runId>.jsonl
//
// Each file contains one JSON object per line:
//   - { type: "message", role, content, timestamp }  — one per conversation turn
//   - { type: "run_summary", runId, agentId, status, startedAt, completedAt,
//       modelUsed, inputChars, outputChars }          — final line
//
// Files are written synchronously after run completion using appendFileSync so
// partial writes do not corrupt existing lines. The directory is created on
// first write (mkdirSync with recursive:true).
//

import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { AgentRun } from './types.js';

export class SessionTranscriptStore {
  constructor(private readonly baseDir: string) {}

  /**
   * Write the full transcript for a completed run.
   * Safe to call on failed/stopped runs — writes whatever messages were collected.
   * Errors are swallowed so a transcript failure never breaks a run.
   */
  write(run: AgentRun): void {
    try {
      const dir = join(this.baseDir, 'agents', run.agentId, 'sessions');
      mkdirSync(dir, { recursive: true });

      const filePath = join(dir, `${run.id}.jsonl`);

      const lines: string[] = [];

      // One line per message (skip system prompt — too verbose for a session log)
      for (const msg of run.messages) {
        if (msg.role === 'system') continue;
        lines.push(JSON.stringify({
          type: 'message',
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp ?? run.startedAt,
        }));
      }

      // Summary line
      const inputChars  = run.input?.length ?? 0;
      const outputChars = run.output?.length ?? 0;
      lines.push(JSON.stringify({
        type:        'run_summary',
        runId:       run.id,
        agentId:     run.agentId,
        status:      run.status,
        startedAt:   run.startedAt,
        completedAt: run.completedAt ?? Date.now(),
        modelUsed:   run.modelUsed,
        inputChars,
        outputChars,
      }));

      appendFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    } catch {
      // Never let transcript IO break a run
    }
  }
}
