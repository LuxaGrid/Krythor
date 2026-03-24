// Krythor Command Center — Agent & Zone Definitions

import type { CommandCenterAgent, SceneZone, SceneZoneId } from './types';

// ── Default Agents ────────────────────────────────────────────────────────────

// Agent positions map to desk locations in the office scene.
// Y=40-80 is the floor area (below the wall at ~32%).
// Atlas sits at the boss desk top-center; others at workstations.
export const DEFAULT_AGENTS: CommandCenterAgent[] = [
  {
    id: 'atlas',
    displayName: 'Atlas',
    role: 'orchestrator',
    themeColor: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.3)',
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: 'crown',
    currentZone: 'crown',
    position: { x: 50, y: 28 }, // top center — command throne
  },
  {
    id: 'voltaris',
    displayName: 'Voltaris',
    role: 'builder',
    themeColor: '#1eaeff',
    glowColor: 'rgba(30,174,255,0.3)',
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: 'forge',
    currentZone: 'forge',
    position: { x: 20, y: 55 }, // left mid
  },
  {
    id: 'aethon',
    displayName: 'Aethon',
    role: 'researcher',
    themeColor: '#818cf8',
    glowColor: 'rgba(129,140,248,0.3)',
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: 'archive',
    currentZone: 'archive',
    position: { x: 80, y: 55 }, // right mid
  },
  {
    id: 'thyros',
    displayName: 'Thyros',
    role: 'archivist',
    themeColor: '#93c5fd',
    glowColor: 'rgba(147,197,253,0.3)',
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: 'memory',
    currentZone: 'memory',
    position: { x: 65, y: 80 }, // bottom-right
  },
  {
    id: 'pyron',
    displayName: 'Pyron',
    role: 'monitor',
    themeColor: '#fb923c',
    glowColor: 'rgba(251,146,60,0.3)',
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: 'monitor',
    currentZone: 'monitor',
    position: { x: 34, y: 80 }, // bottom-left
  },
];

// ── Scene Zones ───────────────────────────────────────────────────────────────

// Zone positions match desk positions in the office floor layout.
// Zones are desk platforms agents sit at — sized to hold agent body + label.
export const SCENE_ZONES: SceneZone[] = [
  {
    id: 'crown',
    label: 'Crown Platform',
    description: 'Orchestration hub',
    position: { x: 50, y: 28 },
    width: 24,
    height: 16,
    accentColor: '#f59e0b',
    glowColor: 'rgba(245,158,11,0.12)',
    defaultAgentId: 'atlas',
  },
  {
    id: 'forge',
    label: 'Forge Console',
    description: 'Execution engine',
    position: { x: 20, y: 55 },
    width: 22,
    height: 16,
    accentColor: '#1eaeff',
    glowColor: 'rgba(30,174,255,0.12)',
    defaultAgentId: 'voltaris',
  },
  {
    id: 'archive',
    label: 'Archive Pillar',
    description: 'Research & knowledge',
    position: { x: 80, y: 55 },
    width: 22,
    height: 16,
    accentColor: '#818cf8',
    glowColor: 'rgba(129,140,248,0.12)',
    defaultAgentId: 'aethon',
  },
  {
    id: 'memory',
    label: 'Memory Core',
    description: 'Long-term memory store',
    position: { x: 65, y: 80 },
    width: 22,
    height: 16,
    accentColor: '#93c5fd',
    glowColor: 'rgba(147,197,253,0.12)',
    defaultAgentId: 'thyros',
  },
  {
    id: 'monitor',
    label: 'Monitor Node',
    description: 'System watch & logs',
    position: { x: 34, y: 80 },
    width: 22,
    height: 16,
    accentColor: '#fb923c',
    glowColor: 'rgba(251,146,60,0.12)',
    defaultAgentId: 'pyron',
  },
];

// ── O(1) Lookup Maps ──────────────────────────────────────────────────────────

export const ZONE_MAP: Record<SceneZoneId, SceneZone> = Object.fromEntries(
  SCENE_ZONES.map(z => [z.id, z])
) as Record<SceneZoneId, SceneZone>;

export const AGENT_MAP: Record<string, CommandCenterAgent> = Object.fromEntries(
  DEFAULT_AGENTS.map(a => [a.id, a])
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the home zone of the given agent. */
export function getZoneForAgent(agentId: string): SceneZone | undefined {
  const agent = AGENT_MAP[agentId];
  if (!agent) return undefined;
  return ZONE_MAP[agent.homeZone];
}

/** Creates a fully-formed CommandCenterAgent from a partial spec, using sensible defaults. */
export function createAgent(
  partial: Partial<CommandCenterAgent> & { id: string; displayName: string }
): CommandCenterAgent {
  const homeZone: SceneZoneId = partial.homeZone ?? 'crown';
  return {
    role: 'orchestrator',
    themeColor: '#71717a',
    glowColor: 'rgba(113,113,122,0.3)',
    currentState: 'idle',
    localOrRemote: 'unknown',
    homeZone,
    currentZone: homeZone,
    position: ZONE_MAP[homeZone]?.position ?? { x: 50, y: 50 },
    ...partial,
  };
}
