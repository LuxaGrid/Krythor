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
    isMythic: true,
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
    isMythic: true,
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
    isMythic: true,
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
    isMythic: true,
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
    isMythic: true,
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

export const ZONE_MAP: Record<string, SceneZone> = Object.fromEntries(
  SCENE_ZONES.map(z => [z.id, z])
);

export const AGENT_MAP: Record<string, CommandCenterAgent> = Object.fromEntries(
  DEFAULT_AGENTS.map(a => [a.id, a])
);

// ── Dynamic agent color palette ───────────────────────────────────────────────
// Colors assigned to user-created agents in order; wraps around if more than 8.
const USER_AGENT_COLORS: Array<{ hex: string; rgba: string }> = [
  { hex: '#34d399', rgba: 'rgba(52,211,153,0.3)'  }, // emerald
  { hex: '#f472b6', rgba: 'rgba(244,114,182,0.3)' }, // pink
  { hex: '#a78bfa', rgba: 'rgba(167,139,250,0.3)' }, // violet
  { hex: '#38bdf8', rgba: 'rgba(56,189,248,0.3)'  }, // sky
  { hex: '#fb7185', rgba: 'rgba(251,113,133,0.3)' }, // rose
  { hex: '#4ade80', rgba: 'rgba(74,222,128,0.3)'  }, // green
  { hex: '#facc15', rgba: 'rgba(250,204,21,0.3)'  }, // yellow
  { hex: '#e879f9', rgba: 'rgba(232,121,249,0.3)' }, // fuchsia
];

// Positions for overflow user agents — arranged in a second row above the mythic agents
const USER_AGENT_POSITIONS: Array<{ x: number; y: number }> = [
  { x: 15, y: 38 },
  { x: 35, y: 38 },
  { x: 65, y: 38 },
  { x: 85, y: 38 },
  { x: 15, y: 68 },
  { x: 50, y: 68 },
  { x: 85, y: 68 },
  { x: 50, y: 48 },
];

/**
 * Creates a CommandCenterAgent for a user-created gateway agent.
 * Each one gets a unique color and position slot, keyed by its index.
 */
export function createUserAgent(
  gatewayId: string,
  name: string,
  index: number,
): CommandCenterAgent {
  const color = USER_AGENT_COLORS[index % USER_AGENT_COLORS.length]!;
  const pos   = USER_AGENT_POSITIONS[index % USER_AGENT_POSITIONS.length]!;
  const zoneId: SceneZoneId = `user-${gatewayId.slice(0, 8)}`;
  return {
    id: zoneId,                 // stable CC id derived from gateway UUID
    displayName: name,
    role: 'builder',
    themeColor: color.hex,
    glowColor: color.rgba,
    currentState: 'idle',
    localOrRemote: 'local',
    homeZone: zoneId,
    currentZone: zoneId,
    position: pos,
    isMythic: false,
    gatewayAgentId: gatewayId,
  };
}

/**
 * Creates a SceneZone for a user-created agent.
 */
export function createUserZone(
  agent: CommandCenterAgent,
): SceneZone {
  return {
    id: agent.homeZone,
    label: agent.displayName,
    description: 'User agent',
    position: agent.position,
    width: 20,
    height: 14,
    accentColor: agent.themeColor,
    glowColor: agent.glowColor.replace('0.3', '0.12'),
    defaultAgentId: agent.id,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the home zone of the given agent. */
export function getZoneForAgent(agentId: string, zoneMap: Record<string, SceneZone> = ZONE_MAP): SceneZone | undefined {
  const agent = AGENT_MAP[agentId];
  if (!agent) return undefined;
  return zoneMap[agent.homeZone];
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
