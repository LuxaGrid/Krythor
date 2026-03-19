import * as readline from 'readline';

// ─── Minimal interactive prompt helper (no external deps) ─────────────────────

let rl: readline.Interface | null = null;

function getRL(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

export function closeRL(): void {
  rl?.close();
  rl = null;
}

export function ask(question: string): Promise<string> {
  return new Promise(resolve => {
    getRL().question(question, answer => resolve(answer.trim()));
  });
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${hint} `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
}

export async function choose<T extends string>(
  question: string,
  options: T[],
  defaultIdx = 0,
): Promise<T> {
  console.log(question);
  options.forEach((o, i) => {
    const marker = i === defaultIdx ? '●' : '○';
    console.log(`  ${marker} [${i + 1}] ${o}`);
  });
  const answer = await ask(`  Choice [${defaultIdx + 1}]: `);
  const idx = parseInt(answer, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) return options[defaultIdx]!;
  return options[idx]!;
}

// ANSI helpers
export const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

export const fmt = {
  ok:    (s: string) => `${c.green}✓${c.reset} ${s}`,
  warn:  (s: string) => `${c.yellow}⚠${c.reset} ${s}`,
  err:   (s: string) => `${c.red}✗${c.reset} ${s}`,
  info:  (s: string) => `${c.cyan}→${c.reset} ${s}`,
  dim:   (s: string) => `${c.gray}${s}${c.reset}`,
  bold:  (s: string) => `${c.bold}${s}${c.reset}`,
  head:  (s: string) => `\n${c.bold}${c.white}${s}${c.reset}`,
  // Recommendation label — used to highlight suggested options in the wizard
  rec:   (label: string, reason?: string) =>
    reason
      ? `${c.cyan}★${c.reset} ${c.bold}${label}${c.reset} ${c.gray}— ${reason}${c.reset}`
      : `${c.cyan}★${c.reset} ${c.bold}${label}${c.reset}`,
};
