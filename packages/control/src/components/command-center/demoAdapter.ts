// Krythor Command Center — Demo Adapter
// Self-contained synthetic event generator for when no real gateway events arrive.

import { useState, useEffect, useRef } from 'react';
import type { CCEvent } from './types';
import { makeEvent } from './events';

// ── Scenario script — ~12 steps, cycles continuously ─────────────────────────

interface ScriptStep {
  agentId: string;
  type: Parameters<typeof makeEvent>[0];
  summary: string;
  taskLabel?: string;
  toolName?: string;
}

const DEMO_SCRIPT: ScriptStep[] = [
  {
    agentId: 'atlas',
    type: 'TASK_STARTED',
    summary: 'Atlas received new task: "Analyze system performance"',
    taskLabel: 'Analyze system performance',
  },
  {
    agentId: 'atlas',
    type: 'AGENT_HANDOFF',
    summary: 'Atlas delegating build analysis to Voltaris',
    taskLabel: 'Analyze system performance',
  },
  {
    agentId: 'voltaris',
    type: 'TASK_STARTED',
    summary: 'Voltaris picking up build analysis',
    taskLabel: 'Build analysis',
  },
  {
    agentId: 'voltaris',
    type: 'TOOL_CALLED',
    summary: 'Voltaris calling tool: run_diagnostics',
    toolName: 'run_diagnostics',
    taskLabel: 'Build analysis',
  },
  {
    agentId: 'aethon',
    type: 'TASK_STARTED',
    summary: 'Aethon beginning research on performance bottlenecks',
    taskLabel: 'Research bottlenecks',
  },
  {
    agentId: 'aethon',
    type: 'TOOL_CALLED',
    summary: 'Aethon calling tool: web_search',
    toolName: 'web_search',
    taskLabel: 'Research bottlenecks',
  },
  {
    agentId: 'thyros',
    type: 'MEMORY_RETRIEVED',
    summary: 'Thyros retrieved prior performance logs from memory',
    taskLabel: 'Memory lookup',
  },
  {
    agentId: 'voltaris',
    type: 'TOOL_COMPLETED',
    summary: 'Voltaris diagnostics complete — 3 issues found',
    toolName: 'run_diagnostics',
    taskLabel: 'Build analysis',
  },
  {
    agentId: 'aethon',
    type: 'TOOL_COMPLETED',
    summary: 'Aethon research complete — patterns identified',
    toolName: 'web_search',
    taskLabel: 'Research bottlenecks',
  },
  {
    agentId: 'pyron',
    type: 'MODEL_SELECTED',
    summary: 'Pyron selected model: krythor-core-v2 for synthesis',
    taskLabel: 'Log synthesis',
  },
  {
    agentId: 'atlas',
    type: 'TASK_COMPLETED',
    summary: 'Atlas synthesized findings — report ready',
    taskLabel: 'Analyze system performance',
  },
  {
    agentId: 'atlas',
    type: 'RESPONSE_COMPLETE',
    summary: 'Atlas response delivered to user',
    taskLabel: 'Analyze system performance',
  },
];

// ── Hook ──────────────────────────────────────────────────────────────────────

const MAX_DEMO_LOG = 50;
const TICK_MS = 2_500;

export function useDemoAdapter(): { events: CCEvent[]; isDemo: boolean } {
  const [events, setEvents] = useState<CCEvent[]>([]);
  const stepIndexRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      const idx = stepIndexRef.current % DEMO_SCRIPT.length;
      stepIndexRef.current += 1;
      const step = DEMO_SCRIPT[idx];
      const event = makeEvent(step.type, step.agentId, step.summary, {
        taskLabel: step.taskLabel,
        toolName: step.toolName,
      });
      setEvents(log => [event, ...log].slice(0, MAX_DEMO_LOG));
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  return { events, isDemo: true };
}
