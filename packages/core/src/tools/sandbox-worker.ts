/**
 * sandbox-worker — runs inside a forked child process to execute plugin code
 * in isolation from the main gateway process.
 *
 * Protocol (IPC messages):
 *   Parent → Child: { type: 'run', pluginPath: string, input: string }
 *   Child  → Parent: { type: 'result', output: string }
 *                    { type: 'error', message: string }
 *
 * The worker exits after sending its response. The parent's PluginSandbox
 * kills the child if it exceeds the configured timeout.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import { resolve } from 'path';

interface RunMessage {
  type: 'run';
  pluginPath: string;
  input: string;
}

process.on('message', (msg: RunMessage) => {
  if (!msg || msg.type !== 'run') return;

  const { pluginPath, input } = msg;

  let plugin: { run: (input: string) => Promise<string> };
  try {
    // Resolve to absolute path for safety
    const abs = resolve(pluginPath);
    plugin = require(abs) as { run: (input: string) => Promise<string> };
  } catch (err) {
    process.send!({ type: 'error', message: `Failed to load plugin: ${err instanceof Error ? err.message : String(err)}` });
    process.exit(1);
    return;
  }

  if (typeof plugin?.run !== 'function') {
    process.send!({ type: 'error', message: 'Plugin does not export a run() function' });
    process.exit(1);
    return;
  }

  Promise.resolve()
    .then(() => plugin.run(input))
    .then((output) => {
      process.send!({ type: 'result', output: String(output ?? '') });
      process.exit(0);
    })
    .catch((err) => {
      process.send!({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
});
