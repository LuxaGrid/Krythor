import React, { useRef, useEffect, useCallback } from 'react';
import type { CommandCenterAgent, SceneZone } from '../types';

interface MythicCanvasProps {
  agents: CommandCenterAgent[];
  zones: SceneZone[];
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  memoryPulseAgentId?: string | null;
  isDemo: boolean;
}

// ── Particle system ──────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  type: 'spark' | 'rune' | 'bubble' | 'wave' | 'star';
  angle?: number; angleV?: number;
  char?: string;
}

const RUNE_CHARS = ['⬡', '◈', '◆', '⌘', '⌖', '✦', '❖', '⬟', '◉', '⊕', '⊗', '⋆'];
const SPARK_CHARS = ['✧', '★', '⁕', '·', '✦'];

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function colorWithAlpha(hex: string, alpha: number): string {
  try {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  } catch {
    return hex;
  }
}

// ── Main canvas renderer ─────────────────────────────────────────────────────

export function MythicCanvas({
  agents, zones, focusedAgentId, onFocusAgent, memoryPulseAgentId, isDemo,
}: MythicCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    tick: 0,
    particles: [] as Particle[],
    stars: [] as { x: number; y: number; r: number; twinkle: number }[],
    starsReady: false,
    prevStates: {} as Record<string, string>,
    agentBobPhase: {} as Record<string, number>,
    agentBobOffset: {} as Record<string, number>,
    celebrationAgent: null as string | null,
    celebrationTimer: 0,
    memoryPulseTimer: 0,
    memoryPulseAgent: null as string | null,
    rafId: 0,
    lastFocusedId: null as string | null,
  });
  const focusRef = useRef(focusedAgentId);
  const agentsRef = useRef(agents);
  const zonesRef = useRef(zones);
  const memPulseRef = useRef(memoryPulseAgentId);

  focusRef.current = focusedAgentId;
  agentsRef.current = agents;
  zonesRef.current = zones;

  // Track memory pulse
  useEffect(() => {
    if (memoryPulseAgentId && memoryPulseAgentId !== stateRef.current.memoryPulseAgent) {
      stateRef.current.memoryPulseAgent = memoryPulseAgentId;
      stateRef.current.memoryPulseTimer = 90;
    }
    memPulseRef.current = memoryPulseAgentId;
  }, [memoryPulseAgentId]);

  // Track celebrations (TASK_COMPLETED transitions)
  useEffect(() => {
    agents.forEach(a => {
      const prev = stateRef.current.prevStates[a.id];
      if (prev === 'working' && (a.currentState === 'idle' || a.currentState === 'listening')) {
        stateRef.current.celebrationAgent = a.id;
        stateRef.current.celebrationTimer = 80;
      }
      stateRef.current.prevStates[a.id] = a.currentState;
      if (!(a.id in stateRef.current.agentBobPhase)) {
        stateRef.current.agentBobPhase[a.id] = Math.random() * Math.PI * 2;
      }
    });
  }, [agents]);

  // Click handler
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const W = canvas.width, H = canvas.height;

    for (const agent of agentsRef.current) {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      const bob = stateRef.current.agentBobOffset[agent.id] ?? 0;
      const dist = Math.hypot(mx - ax, my - (ay + bob));
      if (dist < 36) {
        const current = focusRef.current;
        onFocusAgent(current === agent.id ? null : agent.id);
        return;
      }
    }
    onFocusAgent(null);
  }, [onFocusAgent]);

  // Spawn particles
  function spawnParticles(
    s: typeof stateRef.current,
    agent: CommandCenterAgent,
    ax: number, ay: number,
    bobOffset: number,
  ) {
    const cy = ay + bobOffset;
    const color = agent.themeColor;
    const state = agent.currentState;
    const rate = state === 'working' ? 0.6 : state === 'thinking' ? 0.3 : state === 'speaking' ? 0.4 : 0.05;
    if (Math.random() > rate) return;

    if (state === 'working') {
      // Sparks
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 2;
        s.particles.push({
          x: ax + (Math.random() - 0.5) * 20,
          y: cy + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          life: 1, maxLife: 1,
          size: 1.5 + Math.random() * 2,
          color,
          type: 'spark',
          char: SPARK_CHARS[Math.floor(Math.random() * SPARK_CHARS.length)],
        });
      }
    } else if (state === 'thinking') {
      // Orbiting rune
      const angle = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 14;
      s.particles.push({
        x: ax + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r * 0.55,
        vx: 0, vy: 0,
        life: 1, maxLife: 1,
        size: 9,
        color,
        type: 'rune',
        angle,
        angleV: (0.015 + Math.random() * 0.01) * (Math.random() < 0.5 ? 1 : -1),
        char: RUNE_CHARS[Math.floor(Math.random() * RUNE_CHARS.length)],
      });
    } else if (state === 'speaking') {
      // Concentric wave ring
      s.particles.push({
        x: ax, y: cy,
        vx: 0, vy: 0,
        life: 1, maxLife: 1,
        size: 10,
        color,
        type: 'wave',
      });
    } else if (state === 'idle') {
      // Gentle floating bubble
      if (Math.random() < 0.04) {
        s.particles.push({
          x: ax + (Math.random() - 0.5) * 30,
          y: cy + 10 + Math.random() * 20,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -(0.3 + Math.random() * 0.4),
          life: 1, maxLife: 1,
          size: 2 + Math.random() * 3,
          color,
          type: 'bubble',
        });
      }
    }
  }

  // Draw a mythic agent glyph at (cx, cy)
  function drawAgent(
    ctx: CanvasRenderingContext2D,
    agent: CommandCenterAgent,
    cx: number, cy: number,
    focused: boolean,
    dimmed: boolean,
    memPulse: boolean,
    celebrating: boolean,
    tick: number,
  ) {
    const alpha = dimmed ? 0.18 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;

    const color = agent.themeColor;
    const state = agent.currentState;
    const t = tick;

    // ── Outer aura ring (state-dependent) ──────────────────────────────────
    const auraR = state === 'working' ? 32 + Math.sin(t * 0.12) * 4
      : state === 'thinking' ? 28
      : state === 'speaking' ? 30 + Math.sin(t * 0.18) * 6
      : state === 'idle' ? 24
      : 22;

    if (state !== 'offline') {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, auraR + 12);
      grad.addColorStop(0, colorWithAlpha(color, state === 'working' ? 0.22 : 0.1));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, auraR + 12, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // ── Platform base ───────────────────────────────────────────────────────
    const zone = zonesRef.current.find(z => z.id === agent.homeZone);
    const zoneColor = zone?.accentColor ?? color;
    const platW = 70;
    const platY = cy + 28;
    const platGrad = ctx.createLinearGradient(cx - platW / 2, platY, cx + platW / 2, platY);
    platGrad.addColorStop(0, 'rgba(0,0,0,0)');
    platGrad.addColorStop(0.2, colorWithAlpha(zoneColor, 0.25));
    platGrad.addColorStop(0.5, colorWithAlpha(zoneColor, 0.4));
    platGrad.addColorStop(0.8, colorWithAlpha(zoneColor, 0.25));
    platGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.rect(cx - platW / 2, platY, platW, 2);
    ctx.fillStyle = platGrad;
    ctx.fill();
    // Platform glow
    ctx.shadowColor = zoneColor;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ── Role-specific body glyph ────────────────────────────────────────────
    drawRoleGlyph(ctx, agent, cx, cy, color, state, t, auraR);

    // ── Focus ring ─────────────────────────────────────────────────────────
    if (focused) {
      ctx.beginPath();
      ctx.arc(cx, cy, auraR + 2, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Memory recall pulse ─────────────────────────────────────────────────
    if (memPulse) {
      const pAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, auraR + 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(147,197,253,${pAlpha})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = '#93c5fd';
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ── Celebration burst (task complete) ──────────────────────────────────
    if (celebrating) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r2 = auraR + 24;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // ── Name label ─────────────────────────────────────────────────────────
    ctx.shadowBlur = 0;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = state === 'offline' ? '#3f3f46' : color;
    ctx.fillText(agent.displayName.toUpperCase(), cx, cy + 48);

    // State label
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.fillText(state, cx, cy + 60);

    // LC/RM badge
    if (state !== 'offline' && agent.localOrRemote !== 'unknown') {
      const badge = agent.localOrRemote === 'local' ? 'LC' : 'RM';
      const badgeColor = agent.localOrRemote === 'local' ? '#4ade80' : '#facc15';
      ctx.font = 'bold 7px "JetBrains Mono", monospace';
      ctx.fillStyle = badgeColor;
      ctx.fillText(badge, cx + 22, cy + 16);
    }

    ctx.restore();
  }

  function drawRoleGlyph(
    ctx: CanvasRenderingContext2D,
    agent: CommandCenterAgent,
    cx: number, cy: number,
    color: string,
    state: string,
    t: number,
    _auraR: number,
  ) {
    const working = state === 'working';
    const thinking = state === 'thinking';
    const speaking = state === 'speaking';
    const offline = state === 'offline';
    const err = state === 'error';
    const bodyAlpha = offline ? 0.15 : 1;
    const activeColor = err ? '#f87171' : color;
    const pulseR = working ? 4 + Math.sin(t * 0.2) * 1.5
      : thinking ? 3.5 + Math.sin(t * 0.12) * 1
      : 3;

    ctx.save();
    ctx.globalAlpha *= bodyAlpha;
    ctx.lineJoin = 'round';

    switch (agent.role) {
      case 'orchestrator': {
        // Crown + hexagon
        // Crown arch
        ctx.beginPath();
        ctx.moveTo(cx - 16, cy - 10);
        ctx.lineTo(cx - 14, cy - 18);
        ctx.lineTo(cx, cy - 22);
        ctx.lineTo(cx + 14, cy - 18);
        ctx.lineTo(cx + 16, cy - 10);
        ctx.strokeStyle = colorWithAlpha(activeColor, offline ? 0.2 : 0.7);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = speaking ? 14 : working ? 10 : 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Hexagon body
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
          const r = 16;
          if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = colorWithAlpha(activeColor, 0.08);
        ctx.fill();
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.8);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = working ? 12 : 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Core orb
        ctx.beginPath();
        ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.fillStyle = activeColor;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Speaking halo
        if (speaking) {
          const waveR = 20 + ((t * 2) % 24);
          ctx.beginPath();
          ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
          ctx.strokeStyle = colorWithAlpha(activeColor, Math.max(0, 1 - waveR / 44));
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        break;
      }

      case 'builder': {
        // Diamond with spikes
        const pts: [number, number][] = [[cx, cy - 18], [cx + 14, cy], [cx, cy + 18], [cx - 14, cy]];
        ctx.beginPath();
        pts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath();
        ctx.fillStyle = colorWithAlpha(activeColor, 0.1);
        ctx.fill();
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.85);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = working ? 14 : 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Spikes
        const spikeAlpha = working ? 0.9 : 0.3;
        ctx.strokeStyle = colorWithAlpha(activeColor, spikeAlpha);
        ctx.lineWidth = 1.2;
        [[cx - 14, cy, cx - 20, cy - 4], [cx - 14, cy, cx - 20, cy + 4],
         [cx + 14, cy, cx + 20, cy - 4], [cx + 14, cy, cx + 20, cy + 4]].forEach(([x1, y1, x2, y2]) => {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        });

        // Core
        const coreR = err ? 5 : pulseR;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4 + (working ? t * 0.04 : 0));
        ctx.fillStyle = activeColor;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 14;
        ctx.fillRect(-coreR, -coreR, coreR * 2, coreR * 2);
        ctx.shadowBlur = 0;
        ctx.restore();
        break;
      }

      case 'researcher': {
        // Eye / lens form
        ctx.beginPath();
        ctx.ellipse(cx, cy, 20, 12, 0, 0, Math.PI * 2);
        ctx.fillStyle = colorWithAlpha(activeColor, 0.08);
        ctx.fill();
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.8);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = working ? 12 : 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Iris ring — spins when thinking/working
        ctx.save();
        ctx.translate(cx, cy);
        if (thinking || working) ctx.rotate(t * (working ? 0.06 : 0.025));
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.5);
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Pupil
        ctx.beginPath();
        ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        ctx.fillStyle = activeColor;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Orbiting data fragments
        const fragCount = 2;
        for (let i = 0; i < fragCount; i++) {
          const fa = t * 0.04 + (i / fragCount) * Math.PI * 2;
          const fr = 22;
          ctx.fillStyle = colorWithAlpha(activeColor, working ? 0.8 : 0.35);
          ctx.fillRect(
            cx + Math.cos(fa) * fr - 2,
            cy + Math.sin(fa) * fr * 0.5 - 1.5,
            4, 3,
          );
        }
        break;
      }

      case 'archivist': {
        // Layered memory pillar (stacked slabs)
        const slabs = [
          { y: cy - 16, w: 28, h: 5, op: working ? 0.9 : 0.7 },
          { y: cy - 8, w: 24, h: 5, op: working ? 0.8 : 0.55 },
          { y: cy + 0, w: 20, h: 5, op: working ? 0.7 : 0.4 },
          { y: cy + 8, w: 16, h: 4, op: working ? 0.5 : 0.25 },
        ];
        slabs.forEach(({ y, w, h, op }, i) => {
          ctx.fillStyle = colorWithAlpha(activeColor, 0.12);
          ctx.strokeStyle = colorWithAlpha(activeColor, op);
          ctx.lineWidth = 1;
          ctx.shadowColor = activeColor;
          ctx.shadowBlur = (working || thinking) ? 6 : 2;
          const rx = cx - w / 2;
          ctx.beginPath();
          ctx.roundRect(rx, y, w, h, 2);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          // Delay flicker
          if ((working || thinking) && Math.sin(t * 0.1 + i * 1.2) > 0.3) {
            ctx.fillStyle = colorWithAlpha(activeColor, 0.08);
            ctx.fill();
          }
        });

        // Spine
        ctx.beginPath();
        ctx.moveTo(cx, cy - 16);
        ctx.lineTo(cx, cy + 12);
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.3);
        ctx.setLineDash([1, 4]);
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);

        // Top orb
        ctx.beginPath();
        ctx.arc(cx, cy - 13, pulseR, 0, Math.PI * 2);
        ctx.fillStyle = activeColor;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 14;
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }

      case 'monitor': {
        // Warning diamond with scan arc
        const dPts: [number, number][] = [
          [cx, cy - 18], [cx + 16, cy], [cx, cy + 16], [cx - 16, cy],
        ];
        ctx.beginPath();
        dPts.forEach(([x, y], i) => { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.closePath();
        ctx.fillStyle = colorWithAlpha(activeColor, 0.1);
        ctx.fill();
        ctx.strokeStyle = colorWithAlpha(activeColor, 0.85);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = err ? 20 : working ? 12 : 5;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Scan arc — rotates
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * (working ? 0.09 : 0.03));
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(14, -6);
        ctx.strokeStyle = colorWithAlpha(activeColor, working ? 0.9 : 0.5);
        ctx.lineWidth = working ? 1.8 : 1;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // Alert core
        const errR = err ? 6 : pulseR;
        ctx.beginPath();
        ctx.arc(cx, cy, errR, 0, Math.PI * 2);
        ctx.fillStyle = activeColor;
        ctx.shadowColor = activeColor;
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.shadowBlur = 0;
        break;
      }
    }
    ctx.restore();
  }

  // Draw connection beam from Atlas to agent
  function drawBeam(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    color: string,
    isActive: boolean,
    tick: number,
  ) {
    const midX = (x1 + x2) / 2 + (x2 > x1 ? -1 : 1) * Math.abs(y2 - y1) * 0.08;
    const midY = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.06;

    // Ghost line — always
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(midX, midY, x2, y2);
    ctx.strokeStyle = isActive
      ? colorWithAlpha(color, 0.15)
      : 'rgba(30,174,255,0.05)';
    ctx.lineWidth = isActive ? 1 : 0.5;
    ctx.stroke();

    if (isActive) {
      // Animated energy dash
      const dashLen = 8, gapLen = 20;
      const speed = 2.5;
      const offset = (tick * speed) % (dashLen + gapLen);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(midX, midY, x2, y2);
      ctx.strokeStyle = colorWithAlpha(color, 0.75);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([dashLen, gapLen]);
      ctx.lineDashOffset = -offset;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.lineDashOffset = 0;

      // Endpoint dot
      ctx.beginPath();
      ctx.arc(x2, y2, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Render a single frame
  function render(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const s = stateRef.current;
    const W = canvas.width, H = canvas.height;
    s.tick++;
    const t = s.tick;

    // ── Background ─────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);
    const bgGrad = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, W * 0.7);
    bgGrad.addColorStop(0, '#0d1220');
    bgGrad.addColorStop(0.5, '#090c16');
    bgGrad.addColorStop(1, '#060810');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Stars ──────────────────────────────────────────────────────────────
    if (!s.starsReady) {
      s.stars = Array.from({ length: 80 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H * 0.7,
        r: 0.5 + Math.random() * 1.2,
        twinkle: Math.random() * Math.PI * 2,
      }));
      s.starsReady = true;
    }
    s.stars.forEach(star => {
      star.twinkle += 0.02;
      const alpha = 0.1 + Math.abs(Math.sin(star.twinkle)) * 0.35;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,220,255,${alpha})`;
      ctx.fill();
    });

    // ── Perspective grid ───────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = 0.12;
    const VPX = W / 2, VPY = H * 0.18;
    const gridColor = 'rgba(30,174,255,1)';
    // Horizontals
    [0.35, 0.5, 0.62, 0.72, 0.8, 0.87, 0.93, 0.97, 1.0].forEach((frac, i) => {
      const y = H * frac;
      const t2 = (frac - 0.35) / 0.65;
      const xL = W * 0 + (VPX - W * 0) * (1 - t2);
      const xR = W * 1 - (W * 1 - VPX) * (1 - t2);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, xL), y);
      ctx.lineTo(Math.min(W, xR), y);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5 + i * 0.1;
      ctx.stroke();
    });
    // Verticals (converging to vanishing point)
    [-3, -2, -1, 0, 1, 2, 3].forEach(i => {
      const xBot = VPX + i * (W / 7) * 0.9;
      ctx.beginPath();
      ctx.moveTo(VPX, VPY);
      ctx.lineTo(xBot, H);
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.4;
      ctx.stroke();
    });
    ctx.restore();

    // ── Atlas ambient glow (center aura) ────────────────────────────────────
    const atlas = agentsRef.current.find(a => a.id === 'atlas');
    if (atlas) {
      const ax = (atlas.position.x / 100) * W;
      const ay = (atlas.position.y / 100) * H;
      const aGrad = ctx.createRadialGradient(ax, ay, 0, ax, ay, H * 0.4);
      const atlasActive = atlas.currentState !== 'idle' && atlas.currentState !== 'offline';
      aGrad.addColorStop(0, `rgba(245,158,11,${atlasActive ? 0.08 : 0.04})`);
      aGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = aGrad;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Connection beams ────────────────────────────────────────────────────
    if (atlas) {
      const ax = (atlas.position.x / 100) * W;
      const ay = (atlas.position.y / 100) * H + (s.agentBobOffset[atlas.id] ?? 0);
      agentsRef.current.filter(a => a.id !== 'atlas').forEach(agent => {
        const bx = (agent.position.x / 100) * W;
        const by = (agent.position.y / 100) * H + (s.agentBobOffset[agent.id] ?? 0);
        const isActive = agent.currentState !== 'idle' && agent.currentState !== 'offline';
        drawBeam(ctx, ax, ay, bx, by, agent.themeColor, isActive, t);
      });
    }

    // ── Particles ──────────────────────────────────────────────────────────
    // Spawn
    agentsRef.current.forEach(agent => {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      spawnParticles(s, agent, ax, ay, s.agentBobOffset[agent.id] ?? 0);
    });

    // Update + draw
    s.particles = s.particles.filter(p => p.life > 0);
    s.particles.forEach(p => {
      p.life -= 1 / 55;

      if (p.type === 'rune' && p.angle !== undefined && p.angleV !== undefined) {
        // Orbit around agent center
        const agent = agentsRef.current.find(a => a.currentState === 'thinking');
        if (agent) {
          const ax = (agent.position.x / 100) * W;
          const ay = (agent.position.y / 100) * H + (s.agentBobOffset[agent.id] ?? 0);
          p.angle += p.angleV;
          const r = 30;
          p.x = ax + Math.cos(p.angle) * r;
          p.y = ay + Math.sin(p.angle) * r * 0.55;
        }
        const a = p.life * 0.9;
        ctx.font = `${p.size}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = colorWithAlpha(p.color, a);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fillText(p.char ?? '◈', p.x, p.y);
        ctx.shadowBlur = 0;

      } else if (p.type === 'spark') {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.08; // gravity
        p.vx *= 0.96;
        const a = p.life * 0.9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fillStyle = colorWithAlpha(p.color, a);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;

      } else if (p.type === 'bubble') {
        p.x += p.vx;
        p.y += p.vy;
        const a = p.life * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - p.life * 0.3), 0, Math.PI * 2);
        ctx.strokeStyle = colorWithAlpha(p.color, a);
        ctx.lineWidth = 0.8;
        ctx.stroke();

      } else if (p.type === 'wave') {
        const elapsed = 1 - p.life;
        const r = elapsed * 60;
        const a = p.life * 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = colorWithAlpha(p.color, a);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 4;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });

    // ── Agent body-bob offsets ──────────────────────────────────────────────
    agentsRef.current.forEach(agent => {
      if (!(agent.id in s.agentBobPhase)) {
        s.agentBobPhase[agent.id] = Math.random() * Math.PI * 2;
      }
      s.agentBobPhase[agent.id] += agent.currentState === 'idle' ? 0.018
        : agent.currentState === 'working' ? 0.06
        : agent.currentState === 'thinking' ? 0.03
        : 0.025;
      const amp = agent.currentState === 'working' ? 5
        : agent.currentState === 'idle' ? 3
        : 4;
      s.agentBobOffset[agent.id] = Math.sin(s.agentBobPhase[agent.id]) * amp;
    });

    // ── Task bubble overlays ────────────────────────────────────────────────
    agentsRef.current.forEach(agent => {
      if (!agent.currentTask) return;
      if (agent.currentState !== 'working' && agent.currentState !== 'thinking') return;
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H + (s.agentBobOffset[agent.id] ?? 0);
      const text = agent.currentTask.slice(0, 22) + (agent.currentTask.length > 22 ? '…' : '');
      const padding = 8;

      ctx.font = '9px "JetBrains Mono", monospace';
      const textW = ctx.measureText(text).width;
      const boxW = textW + padding * 2;
      const boxH = 20;
      const bx = ax - boxW / 2;
      const by = ay - 55;

      ctx.fillStyle = 'rgba(9,9,11,0.95)';
      ctx.strokeStyle = agent.themeColor;
      ctx.lineWidth = 1;
      ctx.shadowColor = agent.themeColor;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Arrow
      ctx.beginPath();
      ctx.moveTo(ax - 5, by + boxH);
      ctx.lineTo(ax + 5, by + boxH);
      ctx.lineTo(ax, by + boxH + 6);
      ctx.fillStyle = agent.themeColor;
      ctx.fill();

      ctx.fillStyle = agent.themeColor;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text, ax, by + 13);
    });

    // ── Draw agents ─────────────────────────────────────────────────────────
    const focId = focusRef.current;
    agentsRef.current.forEach(agent => {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      const bob = s.agentBobOffset[agent.id] ?? 0;
      const focused = focId === agent.id;
      const dimmed = focId !== null && !focused;
      const memPulse = s.memoryPulseTimer > 0 && s.memoryPulseAgent === agent.id;
      const celebrating = s.celebrationTimer > 0 && s.celebrationAgent === agent.id;
      drawAgent(ctx, agent, ax, ay + bob, focused, dimmed, memPulse, celebrating, t);
    });

    // ── Tick celebration/memPulse timers ────────────────────────────────────
    if (s.celebrationTimer > 0) s.celebrationTimer--;
    else s.celebrationAgent = null;
    if (s.memoryPulseTimer > 0) s.memoryPulseTimer--;
    else s.memoryPulseAgent = null;

    // ── HUD: scene label ────────────────────────────────────────────────────
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.letterSpacing = '0.2em';
    ctx.fillText('• KRYTHOR COMMAND CHAMBER', 12, 16);
    if (isDemo) {
      ctx.fillStyle = '#92400e';
      ctx.fillText('DEMO MODE', W - 80, 16);
    }

    // Focus indicator
    if (focId) {
      const fa = agentsRef.current.find(a => a.id === focId);
      if (fa) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = fa.themeColor;
        ctx.fillText(`◉ FOCUS: ${fa.displayName.toUpperCase()}`, W - 12, 16);
      }
    }

    // Corner brackets (HUD)
    const bSize = 12, bPad = 6;
    const bracketColor = 'rgba(30,174,255,0.25)';
    ctx.strokeStyle = bracketColor;
    ctx.lineWidth = 1;
    [[bPad, bPad, 1, 1], [W - bPad, bPad, -1, 1], [bPad, H - bPad, 1, -1], [W - bPad, H - bPad, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x, y + sy * bSize); ctx.lineTo(x, y); ctx.lineTo(x + sx * bSize, y); ctx.stroke();
    });
  }

  // rAF loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas to match CSS size
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      stateRef.current.starsReady = false; // re-seed stars on resize
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function loop() {
      render(canvas!, ctx!);
      stateRef.current.rafId = requestAnimationFrame(loop);
    }
    stateRef.current.rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(stateRef.current.rafId);
      ro.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-pointer"
      onClick={handleClick}
      style={{ display: 'block' }}
    />
  );
}
