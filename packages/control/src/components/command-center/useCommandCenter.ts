// Krythor Command Center — Master Hook

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGatewayContext } from '../../GatewayContext';
import type { ConnectionState } from '../../GatewayContext';
import { useDemoAdapter } from './demoAdapter';
import { adaptGatewayEvent } from './eventAdapter';
import { DEFAULT_AGENTS, SCENE_ZONES, ZONE_MAP } from './agents';
import { AGENT_STATE_TRANSITIONS } from './events';
import type { CCEvent, CommandCenterAgent, SceneZone, SceneZoneId } from './types';

const MAX_LOG_ENTRIES = 100;
const DEMO_FALLBACK_MS = 8_000; // switch to demo if no real events for 8s
const ACTIVE_ZONE_CLEAR_MS = 3_000; // delay before removing zone from active set
const AUTO_IDLE_MS = 30_000; // auto-return agent to idle after 30s with no follow-up event
const MEMORY_PULSE_MS = 1_800; // how long the memory recall pulse lasts

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCommandCenter(): {
  agents: CommandCenterAgent[];
  zones: SceneZone[];
  logEntries: CCEvent[];
  activeZones: Set<SceneZoneId>;
  isDemo: boolean;
  focusedAgentId: string | null;
  setFocusedAgentId: (id: string | null) => void;
  activeRunCount: number;
  connectionState: ConnectionState;
  memoryPulseAgentId: string | null;
} {
  const gateway = useGatewayContext();

  // ── Local state ───────────────────────────────────────────────────────────
  const [agents, setAgents] = useState<CommandCenterAgent[]>(DEFAULT_AGENTS);
  const [logEntries, setLogEntries] = useState<CCEvent[]>([]);
  const [activeZones, setActiveZones] = useState<Set<SceneZoneId>>(new Set());
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);

  // Track when we last received a real gateway event
  const lastRealEventAt = useRef<number>(0);
  const [isDemo, setIsDemo] = useState<boolean>(false);

  // Track which gateway event ids we've already processed (gateway prepends newest first)
  const processedIds = useRef<Set<number>>(new Set());

  // Per-agent auto-idle timers
  const agentIdleTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Memory recall pulse
  const [memoryPulseAgentId, setMemoryPulseAgentId] = useState<string | null>(null);

  // Demo adapter — always running internally, only surfaces when needed
  const demo = useDemoAdapter();

  // ── Cleanup idle timers on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      agentIdleTimers.current.forEach(t => clearTimeout(t));
    };
  }, []);

  // ── applyEvent — mutates agent + zone state for one CCEvent ──────────────
  const applyEvent = useCallback((event: CCEvent) => {
    const nextState = AGENT_STATE_TRANSITIONS[event.type];

    // Update matching agent
    setAgents(prev =>
      prev.map(agent => {
        if (agent.id !== event.agentId) return agent;

        const updates: Partial<CommandCenterAgent> = {
          currentState: nextState,
          lastEventAt: event.ts,
        };

        if (event.taskLabel) {
          updates.currentTask = event.taskLabel;
        }

        // Bind model to agent when event carries a modelId
        if (event.modelId) {
          updates.assignedModel = event.modelId;
        }

        if (event.type === 'AGENT_HANDOFF' && event.zoneId) {
          updates.targetZone = event.zoneId;
          // Lerp position toward target zone center
          const targetZone = ZONE_MAP[event.zoneId];
          if (targetZone) {
            updates.position = {
              x: agent.position.x + (targetZone.position.x - agent.position.x) * 0.6,
              y: agent.position.y + (targetZone.position.y - agent.position.y) * 0.6,
            };
            updates.currentZone = event.zoneId;
          }
        }

        return { ...agent, ...updates };
      })
    );

    // Auto-idle timeout — when agent goes working/thinking, arm a timer
    if (nextState === 'working' || nextState === 'thinking') {
      const agentId = event.agentId;
      const existing = agentIdleTimers.current.get(agentId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        setAgents(prev => prev.map(a =>
          a.id === agentId && (a.currentState === 'working' || a.currentState === 'thinking')
            ? { ...a, currentState: 'idle', currentTask: undefined }
            : a
        ));
      }, AUTO_IDLE_MS);
      agentIdleTimers.current.set(agentId, timer);
    }

    // Manage active zones
    if (event.type === 'TASK_STARTED') {
      const agent = agents.find(a => a.id === event.agentId);
      const zoneId = event.zoneId ?? agent?.currentZone;
      if (zoneId) {
        setActiveZones(prev => new Set([...prev, zoneId]));
      }
    }

    if (event.type === 'AGENT_IDLE' || event.type === 'RESPONSE_COMPLETE') {
      const agent = agents.find(a => a.id === event.agentId);
      const zoneId = event.zoneId ?? agent?.currentZone;
      if (zoneId) {
        setTimeout(() => {
          setActiveZones(prev => {
            const next = new Set(prev);
            next.delete(zoneId);
            return next;
          });
        }, ACTIVE_ZONE_CLEAR_MS);
      }
    }

    // Memory recall pulse — flash the archivist agent when memory is retrieved
    if (event.type === 'MEMORY_RETRIEVED') {
      setMemoryPulseAgentId(event.agentId);
      setTimeout(() => setMemoryPulseAgentId(null), MEMORY_PULSE_MS);
    }

    // Prepend to log, cap at MAX_LOG_ENTRIES
    setLogEntries(prev => [event, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, [agents]);

  // ── Watch real gateway events ─────────────────────────────────────────────
  useEffect(() => {
    const agentMap: Record<string, CommandCenterAgent> = Object.fromEntries(
      agents.map(a => [a.id, a])
    );

    let hadNew = false;
    for (const raw of gateway.events) {
      if (processedIds.current.has(raw.id)) continue;
      processedIds.current.add(raw.id);

      const ccEvent = adaptGatewayEvent(raw, agentMap);
      if (ccEvent) {
        applyEvent(ccEvent);
        lastRealEventAt.current = Date.now();
        hadNew = true;
      }
    }

    if (hadNew) {
      setIsDemo(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway.events]);

  // ── Demo fallback: check every 2s whether we need to switch ──────────────
  useEffect(() => {
    const id = setInterval(() => {
      // Only enter demo if not connected (or never received real events)
      const age = Date.now() - lastRealEventAt.current;
      const neverHadRealEvents = lastRealEventAt.current === 0;
      const isStale = age >= DEMO_FALLBACK_MS;
      // If connected and received recent real events, stay out of demo
      if (gateway.connectionState === 'connected' && !isStale && !neverHadRealEvents) {
        setIsDemo(false);
      } else {
        setIsDemo(isStale);
      }
    }, 2_000);
    return () => clearInterval(id);
  }, [gateway.connectionState]);

  // ── When in demo mode, pipe demo events into the log ─────────────────────
  const lastDemoEventId = useRef<string | null>(null);

  useEffect(() => {
    if (!isDemo) return;
    const newest = demo.events[0];
    if (!newest || newest.id === lastDemoEventId.current) return;
    lastDemoEventId.current = newest.id;
    applyEvent(newest);
  }, [isDemo, demo.events, applyEvent]);

  // ── Derived values ────────────────────────────────────────────────────────
  const activeRunCount = agents.filter(
    a => a.currentState === 'working' || a.currentState === 'thinking' || a.currentState === 'speaking' || a.currentState === 'listening'
  ).length;

  return {
    agents,
    zones: SCENE_ZONES,
    logEntries,
    activeZones,
    isDemo,
    focusedAgentId,
    setFocusedAgentId,
    activeRunCount,
    connectionState: gateway.connectionState,
    memoryPulseAgentId,
  };
}
