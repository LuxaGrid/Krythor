// Krythor Command Center — Core Types

export type AgentRole = 'orchestrator' | 'builder' | 'researcher' | 'archivist' | 'monitor';

export type AgentAnimationState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'handoff'
  | 'error'
  | 'offline';

export type SceneZoneId =
  | 'crown'
  | 'forge'
  | 'archive'
  | 'memory'
  | 'monitor';

export interface ScenePosition {
  x: number; // 0–100 percentage of scene width
  y: number; // 0–100 percentage of scene height
}

export interface CommandCenterAgent {
  id: string;
  displayName: string;
  role: AgentRole;
  themeColor: string;       // hex color — drives all visual accents
  glowColor: string;        // rgba glow string
  currentState: AgentAnimationState;
  currentTask?: string;
  assignedModel?: string;
  localOrRemote: 'local' | 'remote' | 'unknown';
  homeZone: SceneZoneId;
  currentZone: SceneZoneId;
  targetZone?: SceneZoneId;
  position: ScenePosition;
  lastEventAt?: number;
}

export type CCEventType =
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TOOL_CALLED'
  | 'TOOL_COMPLETED'
  | 'MODEL_SELECTED'
  | 'AGENT_HANDOFF'
  | 'MEMORY_RETRIEVED'
  | 'ERROR'
  | 'RESPONSE_COMPLETE'
  | 'AGENT_IDLE'
  | 'AGENT_MOVED';

export interface CCEvent {
  id: string;
  type: CCEventType;
  agentId: string;
  ts: number;
  summary: string;
  taskLabel?: string;
  modelId?: string;
  toolName?: string;
  targetAgentId?: string;
  zoneId?: SceneZoneId;
  error?: string;
}

export interface SceneZone {
  id: SceneZoneId;
  label: string;
  description: string;
  position: ScenePosition;
  width: number;
  height: number;
  accentColor: string;
  glowColor: string;
  defaultAgentId: string;
}
