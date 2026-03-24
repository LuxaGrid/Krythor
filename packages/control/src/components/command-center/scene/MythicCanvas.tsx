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

// ─── Palette ──────────────────────────────────────────────────────────────────
const AGENT_PALETTE: Record<string, { body: string; accent: string; skin: string; hair: string }> = {
  atlas:    { body: '#f59e0b', accent: '#fbbf24', skin: '#fcd9b0', hair: '#92400e' },
  voltaris: { body: '#1eaeff', accent: '#38bdf8', skin: '#fcd9b0', hair: '#1d4ed8' },
  aethon:   { body: '#818cf8', accent: '#a5b4fc', skin: '#e8c5a0', hair: '#4c1d95' },
  thyros:   { body: '#93c5fd', accent: '#bfdbfe', skin: '#fcd9b0', hair: '#1e3a8a' },
  pyron:    { body: '#fb923c', accent: '#fdba74', skin: '#fcd9b0', hair: '#7c2d12' },
};
const DEFAULT_PAL = { body: '#6366f1', accent: '#818cf8', skin: '#fcd9b0', hair: '#3730a3' };

// ─── Wandering system ─────────────────────────────────────────────────────────
// Agents walk between their home desk and random waypoints when idle
interface AgentWander {
  x: number; y: number;       // current pixel position (% * W/H)
  targetX: number; targetY: number;
  homeX: number; homeY: number;
  walkPhase: number;          // walk animation accumulator
  facing: 1 | -1;            // 1=right, -1=left
  wanderTimer: number;        // frames until next wander decision
  isWalking: boolean;
}

// ─── Pixel helpers ────────────────────────────────────────────────────────────
function p(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, a = 1) {
  if (a !== 1) ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
  if (a !== 1) ctx.globalAlpha = 1;
}

// Draw pixel pattern from string array — exactly like OpenClaw
function pattern(
  ctx: CanvasRenderingContext2D,
  rows: string[],
  ox: number, oy: number,
  PX: number,
  color: string,
) {
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === 'X') {
        ctx.fillRect(Math.round(ox + c * PX), Math.round(oy + r * PX), PX, PX);
      }
    }
  }
}

// ─── Sprite drawing ───────────────────────────────────────────────────────────
function drawSprite(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  pal: typeof DEFAULT_PAL,
  state: string,
  walkPhase: number,
  facing: number,
  PX: number,
  focused: boolean,
) {
  const working = state === 'working';
  const thinking = state === 'thinking';
  const speaking = state === 'speaking';
  const offline = state === 'offline';

  // Body bob
  const bob = Math.abs(Math.sin(walkPhase * 3)) * PX * 0.5;
  const legSwing = Math.sin(walkPhase * 6);

  // Base position — sprite is 8px wide, 14px tall (in logical pixels)
  const bx = cx - 4 * PX;
  const by = cy - 14 * PX - bob;

  ctx.save();
  if (facing === -1) {
    ctx.scale(-1, 1);
    ctx.translate(-cx * 2, 0);
  }

  if (offline) ctx.globalAlpha = 0.3;

  // ── Hair / hat ──────────────────────────────────────────────────────────────
  if (working) {
    // Hard hat
    p(ctx, bx + PX, by - PX, 6 * PX, PX * 2, '#f59e0b');
    p(ctx, bx, by, 8 * PX, PX, '#d97706');
  } else {
    p(ctx, bx + PX, by - PX, 6 * PX, PX * 2, pal.hair);
    p(ctx, bx + PX, by, 2 * PX, PX, pal.hair);
    p(ctx, bx + 5 * PX, by, 2 * PX, PX, pal.hair);
  }

  // ── Head (6×5) ──────────────────────────────────────────────────────────────
  const headRows = [
    ' XXXXXX ',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    ' XXXXXX ',
  ];
  pattern(ctx, headRows, bx, by, PX, pal.skin);

  // Eyes
  const eyeY = by + 2 * PX;
  p(ctx, bx + 2 * PX, eyeY, PX, PX, '#1e293b');
  p(ctx, bx + 5 * PX, eyeY, PX, PX, '#1e293b');
  // Pupils / highlights
  p(ctx, bx + 2 * PX, eyeY, PX / 2, PX / 2, '#ffffff');
  p(ctx, bx + 5 * PX, eyeY, PX / 2, PX / 2, '#ffffff');

  // Mouth
  const mouthY = by + 4 * PX;
  if (speaking) {
    p(ctx, bx + 3 * PX, mouthY, 2 * PX, PX, '#dc2626');
  } else if (thinking) {
    p(ctx, bx + 3 * PX, mouthY, PX, PX, '#78716c');
    p(ctx, bx + 5 * PX, mouthY, PX / 2, PX, '#78716c');
    p(ctx, bx + 6 * PX, mouthY, PX / 2, PX, '#78716c');
  } else {
    p(ctx, bx + 2 * PX, mouthY, 4 * PX, PX / 2, '#78716c');
  }

  // ── Body (8×5) ──────────────────────────────────────────────────────────────
  const bodyY = by + 5 * PX;
  const bodyRows = [
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
  ];
  pattern(ctx, bodyRows, bx, bodyY, PX, pal.body);
  // Collar
  p(ctx, bx + 3 * PX, bodyY, 2 * PX, PX, pal.accent);
  // Chest detail
  p(ctx, bx + PX, bodyY + 2 * PX, 2 * PX, 2 * PX, pal.accent);

  // Arms
  const armY = bodyY + PX;
  const armSwing = working ? Math.sin(walkPhase * 8) * PX : 0;
  p(ctx, bx - PX, armY + armSwing, PX, 3 * PX, pal.skin);
  p(ctx, bx + 8 * PX, armY - armSwing, PX, 3 * PX, pal.skin);

  // ── Legs ────────────────────────────────────────────────────────────────────
  const legY = bodyY + 5 * PX;
  // Pants
  p(ctx, bx + PX, legY, 6 * PX, 2 * PX, '#1e3a8a');
  // Left leg
  const lLegX = bx + PX + legSwing * PX * 0.8;
  p(ctx, lLegX, legY + 2 * PX, 2 * PX, 3 * PX, '#1e3a8a');
  p(ctx, lLegX - PX / 2, legY + 5 * PX, 3 * PX, PX, '#0f172a'); // shoe
  // Right leg
  const rLegX = bx + 5 * PX - legSwing * PX * 0.8;
  p(ctx, rLegX, legY + 2 * PX, 2 * PX, 3 * PX, '#1e3a8a');
  p(ctx, rLegX - PX / 2, legY + 5 * PX, 3 * PX, PX, '#0f172a'); // shoe

  // ── Focus glow ──────────────────────────────────────────────────────────────
  if (focused) {
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = PX * 0.75;
    ctx.shadowColor = pal.body;
    ctx.shadowBlur = 10;
    ctx.strokeRect(bx - PX, by - PX * 2, 10 * PX, 18 * PX);
    ctx.shadowBlur = 0;
  }

  // ── State dot ───────────────────────────────────────────────────────────────
  const dotColor = state === 'working' ? '#4ade80'
    : state === 'thinking' ? '#a78bfa'
    : state === 'speaking' ? '#fb923c'
    : state === 'error' ? '#f87171'
    : state === 'offline' ? '#52525b'
    : '#22d3ee';
  ctx.beginPath();
  ctx.arc(cx + 5 * PX, by - PX, PX * 1.2, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.shadowColor = dotColor;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

// ─── Desk ─────────────────────────────────────────────────────────────────────
function drawDesk(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, PX: number,
  state: string, tick: number,
) {
  const dw = 20 * PX, dh = 6 * PX;
  const dx = cx - dw / 2, dy = cy;

  // Surface
  p(ctx, dx, dy, dw, dh, '#1e293b');
  p(ctx, dx, dy, dw, PX, '#334155'); // top edge highlight
  p(ctx, dx, dy + dh - PX, dw, PX, '#0f172a'); // bottom shadow

  // Accent border
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = PX * 0.5;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(dx + PX, dy + PX, dw - 2 * PX, dh - 2 * PX);
  ctx.restore();

  // Monitor
  const mx = cx - 4 * PX, my = dy - 7 * PX;
  p(ctx, mx, my, 8 * PX, 6 * PX, '#0f172a');
  p(ctx, mx + PX, my + PX, 6 * PX, 4 * PX, '#0c1a2e');
  // Screen content
  if (state !== 'idle' && state !== 'offline') {
    const row = Math.floor(tick / 6) % 3;
    for (let i = 0; i < 3; i++) {
      if (i !== row) {
        p(ctx, mx + 2 * PX, my + PX + i * PX, 3 * PX, PX * 0.75, color, 0.5);
      }
    }
    p(ctx, mx + 2 * PX, my + PX + row * PX, 5 * PX, PX * 0.75, color, 0.9);
  } else {
    p(ctx, mx + 2 * PX, my + 3 * PX, 4 * PX, PX * 0.75, '#334155');
  }
  // Stand
  p(ctx, cx - PX, dy - PX, 2 * PX, PX, '#334155');
  p(ctx, cx - 2 * PX, dy, 4 * PX, PX * 0.5, '#334155');

  // Keyboard
  p(ctx, cx - 4 * PX, dy + PX, 8 * PX, PX * 1.5, '#1e3a5f');

  // Legs
  p(ctx, dx + PX, dy + dh, 2 * PX, 3 * PX, '#0f172a');
  p(ctx, dx + dw - 3 * PX, dy + dh, 2 * PX, 3 * PX, '#0f172a');
}

// ─── Speech bubble ────────────────────────────────────────────────────────────
function drawBubble(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  text: string, color: string, PX: number,
) {
  ctx.font = `bold ${Math.max(9, PX * 3.5)}px "JetBrains Mono", monospace`;
  const tw = ctx.measureText(text).width;
  const pad = PX * 2;
  const bw = tw + pad * 2, bh = PX * 5;
  const bx = cx - bw / 2, by = cy - bh;

  ctx.fillStyle = 'rgba(8,12,24,0.95)';
  ctx.strokeStyle = color;
  ctx.lineWidth = PX * 0.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  // roundRect polyfill — Safari <15.4 and older Chromium lack it
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, bw, bh, PX);
  } else {
    ctx.rect(bx, by, bw, bh);
  }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Tail
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - PX, by + bh);
  ctx.lineTo(cx + PX, by + bh);
  ctx.lineTo(cx, by + bh + PX * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by + bh / 2);
  ctx.textBaseline = 'alphabetic';
}

// ─── Floor ────────────────────────────────────────────────────────────────────
function drawFloor(ctx: CanvasRenderingContext2D, W: number, H: number, PX: number) {
  const tileW = PX * 8, tileH = PX * 8;
  const cols = Math.ceil(W / tileW) + 1;
  const rows = Math.ceil(H / tileH) + 1;
  const wallH = H * 0.1;

  // Ceiling/wall strip
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, W, wallH);
  ctx.fillStyle = '#0d1a2e';
  ctx.fillRect(0, wallH - 2, W, 2);
  // Wall accent lights
  const lightSpacing = W / 5;
  for (let i = 0; i < 5; i++) {
    const lx = lightSpacing * (i + 0.5);
    // Light fixture
    p(ctx, lx - PX * 2, wallH - PX * 3, PX * 4, PX, '#334155');
    p(ctx, lx - PX, wallH - PX * 2, PX * 2, PX * 2, '#fbbf24', 0.6);
    // Light cone
    ctx.save();
    ctx.globalAlpha = 0.04;
    const cone = ctx.createRadialGradient(lx, wallH, 0, lx, wallH, H * 0.4);
    cone.addColorStop(0, '#fbbf24');
    cone.addColorStop(1, 'transparent');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(lx, wallH);
    ctx.lineTo(lx - H * 0.3, H);
    ctx.lineTo(lx + H * 0.3, H);
    ctx.fill();
    ctx.restore();
  }

  // Checkerboard floor tiles
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tileW;
      const y = wallH + r * tileH;
      ctx.fillStyle = (r + c) % 2 === 0 ? '#080d1a' : '#0a1020';
      ctx.fillRect(x, y, tileW, tileH);
    }
  }

  // Grid lines
  ctx.strokeStyle = 'rgba(30,174,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath(); ctx.moveTo(c * tileW, wallH); ctx.lineTo(c * tileW, H); ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    const y = wallH + r * tileH;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────
function drawProps(ctx: CanvasRenderingContext2D, W: number, H: number, PX: number, tick: number) {
  // Plant left
  const p1x = PX * 3, p1y = H * 0.15;
  p(ctx, p1x + 3 * PX, p1y + 4 * PX, PX * 2, 5 * PX, '#166534');
  p(ctx, p1x, p1y, 4 * PX, 5 * PX, '#15803d');
  p(ctx, p1x + 4 * PX, p1y + 2 * PX, 4 * PX, 4 * PX, '#16a34a');
  p(ctx, p1x + 2 * PX, p1y + 2 * PX, 3 * PX, 4 * PX, '#22c55e');
  p(ctx, p1x + 2 * PX, p1y + 9 * PX, 3 * PX, 3 * PX, '#92400e'); // pot

  // Plant right
  const p2x = W - PX * 12, p2y = H * 0.15;
  p(ctx, p2x + 3 * PX, p2y + 4 * PX, PX * 2, 5 * PX, '#166534');
  p(ctx, p2x, p2y + 2 * PX, 4 * PX, 4 * PX, '#15803d');
  p(ctx, p2x + 4 * PX, p2y, 4 * PX, 5 * PX, '#16a34a');
  p(ctx, p2x + 2 * PX, p2y + 2 * PX, 3 * PX, 4 * PX, '#22c55e');
  p(ctx, p2x + 2 * PX, p2y + 9 * PX, 3 * PX, 3 * PX, '#92400e');

  // Server rack (left wall)
  const sx = PX * 3, sy = H * 0.5;
  p(ctx, sx, sy, 12 * PX, 18 * PX, '#0f172a');
  p(ctx, sx + PX, sy + PX, 10 * PX, 16 * PX, '#1e293b');
  for (let i = 0; i < 4; i++) {
    const ry = sy + 2 * PX + i * 4 * PX;
    p(ctx, sx + PX, ry, 10 * PX, 3 * PX, '#0c1a2e');
    const blink = Math.floor(tick / (10 + i * 4)) % 2 === 0;
    p(ctx, sx + 9 * PX, ry + PX, PX, PX, blink ? '#4ade80' : '#166534');
  }

  // Water cooler (right wall)
  const wx = W - PX * 10, wy = H * 0.5;
  p(ctx, wx + PX, wy - 4 * PX, 4 * PX, 3 * PX, '#93c5fd', 0.8); // bottle
  p(ctx, wx, wy, 6 * PX, 8 * PX, '#e2e8f0'); // body
  p(ctx, wx + 2 * PX, wy + 2 * PX, 2 * PX, PX, '#3b82f6'); // spigot

  // Couch (bottom center)
  const couchX = W / 2, couchY = H * 0.88;
  p(ctx, couchX - 18 * PX, couchY, 36 * PX, 7 * PX, '#1e3a5f'); // base
  p(ctx, couchX - 20 * PX, couchY - 5 * PX, 5 * PX, 5 * PX, '#1d4ed8'); // left arm
  p(ctx, couchX + 15 * PX, couchY - 5 * PX, 5 * PX, 5 * PX, '#1d4ed8'); // right arm
  p(ctx, couchX - 18 * PX, couchY - 5 * PX, 36 * PX, 2 * PX, '#2563eb'); // back
  p(ctx, couchX - 15 * PX, couchY - 3 * PX, 30 * PX, 4 * PX, '#3b82f6'); // cushion

  // Round table (center)
  const tx = W / 2, ty = H * 0.72;
  ctx.save();
  ctx.fillStyle = '#1e3a5f';
  ctx.beginPath();
  ctx.ellipse(tx, ty, 12 * PX, 5 * PX, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.ellipse(tx, ty - PX, 12 * PX, 4 * PX, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  p(ctx, tx - PX, ty, 2 * PX, 5 * PX, '#1e293b'); // leg
}

// ─── Particle ─────────────────────────────────────────────────────────────────
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }

// ─── Main component ───────────────────────────────────────────────────────────
export function MythicCanvas({
  agents, zones, focusedAgentId, onFocusAgent, memoryPulseAgentId, isDemo,
}: MythicCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    tick: 0,
    particles: [] as Particle[],
    rafId: 0,
    prevStates: {} as Record<string, string>,
    celebrationAgent: null as string | null,
    celebrationTimer: 0,
    memPulseTimer: 0,
    memPulseAgent: null as string | null,
    wander: {} as Record<string, AgentWander>,
  });
  const focusRef = useRef(focusedAgentId);
  const agentsRef = useRef(agents);
  const zonesRef = useRef(zones);

  focusRef.current = focusedAgentId;
  agentsRef.current = agents;
  zonesRef.current = zones;

  useEffect(() => {
    if (memoryPulseAgentId && memoryPulseAgentId !== stateRef.current.memPulseAgent) {
      stateRef.current.memPulseAgent = memoryPulseAgentId;
      stateRef.current.memPulseTimer = 90;
    }
  }, [memoryPulseAgentId]);

  useEffect(() => {
    agents.forEach(a => {
      const prev = stateRef.current.prevStates[a.id];
      if (prev === 'working' && (a.currentState === 'idle' || a.currentState === 'listening')) {
        stateRef.current.celebrationAgent = a.id;
        stateRef.current.celebrationTimer = 60;
      }
      stateRef.current.prevStates[a.id] = a.currentState;
    });
  }, [agents]);

  // Click hit-test
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (e.clientX - rect.left);
    const my = (e.clientY - rect.top);
    const W = canvas.width / dpr, H = canvas.height / dpr;

    for (const agent of agentsRef.current) {
      const w = stateRef.current.wander[agent.id];
      const ax = w ? w.x : (agent.position.x / 100) * W;
      const ay = w ? w.y : (agent.position.y / 100) * H;
      if (Math.hypot(mx - ax, my - ay) < 30) {
        onFocusAgent(focusRef.current === agent.id ? null : agent.id);
        return;
      }
    }
    onFocusAgent(null);
  }, [onFocusAgent]);

  // ── Wander update ───────────────────────────────────────────────────────────
  function updateWander(agent: CommandCenterAgent, W: number, H: number) {
    const sr = stateRef.current;
    if (!sr.wander[agent.id]) {
      const hx = (agent.position.x / 100) * W;
      const hy = (agent.position.y / 100) * H;
      sr.wander[agent.id] = {
        x: hx, y: hy,
        targetX: hx, targetY: hy,
        homeX: hx, homeY: hy,
        walkPhase: Math.random() * Math.PI * 2,
        facing: 1,
        wanderTimer: 180, // 3s grace period — agents start at their desk
        isWalking: false,
      };
    }

    const w = sr.wander[agent.id];
    const isIdle = agent.currentState === 'idle' || agent.currentState === 'listening';

    // Wander timer — only when idle
    if (isIdle) {
      w.wanderTimer--;
      if (w.wanderTimer <= 0) {
        // Pick new target: either home desk or a random waypoint in the room
        const goHome = Math.random() < 0.4;
        if (goHome) {
          w.targetX = w.homeX;
          w.targetY = w.homeY;
        } else {
          // Wander to a random spot within the lower 60% of screen
          w.targetX = W * (0.15 + Math.random() * 0.7);
          w.targetY = H * (0.45 + Math.random() * 0.4);
        }
        w.wanderTimer = Math.floor(Math.random() * 240) + 120;
      }
    } else {
      // Working/thinking/speaking — return to home desk
      w.targetX = w.homeX;
      w.targetY = w.homeY;
    }

    // Move toward target
    const dx = w.targetX - w.x;
    const dy = w.targetY - w.y;
    const dist = Math.hypot(dx, dy);
    const speed = isIdle ? 0.8 : 1.5;

    if (dist > 2) {
      w.x += (dx / dist) * speed;
      w.y += (dy / dist) * speed;
      w.facing = dx > 0 ? 1 : -1;
      w.isWalking = true;
      w.walkPhase += 0.12;
    } else {
      w.isWalking = false;
      w.walkPhase += 0.02; // gentle idle bob
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  function render(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const sr = stateRef.current;
    sr.tick++;
    const t = sr.tick;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    // Pixel scale — OpenClaw uses PX=5 at ~500px wide. We target ~3-4px.
    const PX = Math.max(2, Math.min(4, Math.round(W / 280)));

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#070b15';
    ctx.fillRect(0, 0, W, H);

    // ── Floor & room ──────────────────────────────────────────────────────────
    drawFloor(ctx, W, H, PX);

    // ── Props ─────────────────────────────────────────────────────────────────
    drawProps(ctx, W, H, PX, t);

    // ── Update wander positions ───────────────────────────────────────────────
    agentsRef.current.forEach(agent => updateWander(agent, W, H));

    // ── Zone floor glows ──────────────────────────────────────────────────────
    zonesRef.current.forEach(zone => {
      const agent = agentsRef.current.find(a => a.homeZone === zone.id);
      const isActive = agent && agent.currentState !== 'idle' && agent.currentState !== 'offline';
      const w = agent && sr.wander[agent.id];
      const zx = w ? w.homeX : (zone.position.x / 100) * W;
      const zy = w ? w.homeY : (zone.position.y / 100) * H;

      ctx.save();
      ctx.globalAlpha = isActive ? 0.18 : 0.06;
      const grd = ctx.createRadialGradient(zx, zy + PX * 8, 0, zx, zy + PX * 8, PX * 28);
      grd.addColorStop(0, zone.accentColor);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(zx, zy + PX * 10, PX * 22, PX * 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // ── Desks (at home positions) ─────────────────────────────────────────────
    agentsRef.current.forEach(agent => {
      const w = sr.wander[agent.id];
      const hx = w ? w.homeX : (agent.position.x / 100) * W;
      const hy = w ? w.homeY : (agent.position.y / 100) * H;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      drawDesk(ctx, hx, hy + PX * 6, pal.body, PX, agent.currentState, t);
    });

    // ── Connection lines from Atlas to all agents ─────────────────────────────
    const atlasAgent = agentsRef.current.find(a => a.id === 'atlas');
    if (atlasAgent) {
      const aw = sr.wander['atlas'];
      const ax = aw ? aw.homeX : (atlasAgent.position.x / 100) * W;
      const ay = aw ? aw.homeY + PX * 8 : (atlasAgent.position.y / 100) * H;
      agentsRef.current.filter(a => a.id !== 'atlas').forEach(agent => {
        const bw = sr.wander[agent.id];
        const bx = bw ? bw.homeX : (agent.position.x / 100) * W;
        const by2 = bw ? bw.homeY + PX * 8 : (agent.position.y / 100) * H;
        const isActive = agent.currentState !== 'idle' && agent.currentState !== 'offline';
        ctx.save();
        ctx.globalAlpha = isActive ? 0.25 : 0.07;
        ctx.setLineDash([PX * 2, PX * 4]);
        ctx.lineDashOffset = isActive ? -(t * 1.2) % (PX * 6) : 0;
        ctx.strokeStyle = agent.themeColor;
        ctx.lineWidth = isActive ? PX * 0.75 : PX * 0.4;
        ctx.shadowColor = agent.themeColor;
        ctx.shadowBlur = isActive ? 4 : 0;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.restore();
      });
    }

    // ── Zone labels (above desks, on wall) ───────────────────────────────────
    zonesRef.current.forEach(zone => {
      const agent = agentsRef.current.find(a => a.homeZone === zone.id);
      const w = agent && sr.wander[agent.id];
      const zx = w ? w.homeX : (zone.position.x / 100) * W;
      const zy = w ? w.homeY : (zone.position.y / 100) * H;
      const isActive = agent && agent.currentState !== 'idle' && agent.currentState !== 'offline';

      ctx.font = `bold ${PX * 3}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = zone.accentColor;
      ctx.globalAlpha = isActive ? 0.85 : 0.35;
      ctx.shadowColor = zone.accentColor;
      ctx.shadowBlur = isActive ? 6 : 0;
      ctx.fillText(zone.label.toUpperCase(), zx, zy - PX * 28);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });

    // ── Agents ────────────────────────────────────────────────────────────────
    const focId = focusRef.current;

    // Sort by Y so agents in front render on top
    const sorted = [...agentsRef.current].sort((a, b) => {
      const wa = sr.wander[a.id], wb = sr.wander[b.id];
      return (wa?.y ?? 0) - (wb?.y ?? 0);
    });

    sorted.forEach(agent => {
      const w = sr.wander[agent.id];
      if (!w) return;
      const ax = w.x, ay = w.y;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      const focused = focId === agent.id;
      const dimmed = focId !== null && !focused;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.35 : 1;

      // Memory pulse ring
      if (sr.memPulseTimer > 0 && sr.memPulseAgent === agent.id) {
        const pr = PX * 10 + (1 - sr.memPulseTimer / 90) * PX * 8;
        ctx.beginPath();
        ctx.arc(ax, ay, pr, 0, Math.PI * 2);
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = PX * 0.75;
        ctx.shadowColor = '#93c5fd';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      drawSprite(ctx, ax, ay, pal, agent.currentState, w.walkPhase, w.facing, PX, focused);

      // Name label
      ctx.font = `bold ${PX * 3}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = pal.body;
      ctx.shadowColor = pal.body;
      ctx.shadowBlur = 4;
      ctx.fillText(agent.displayName.toUpperCase(), ax, ay + PX * 18);
      ctx.shadowBlur = 0;

      // State label
      ctx.font = `${PX * 2.5}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(148,163,184,0.75)';
      ctx.fillText(agent.currentState, ax, ay + PX * 21);

      // LC/RM badge
      if (agent.localOrRemote === 'local') {
        ctx.font = `bold ${PX * 2}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('LC', ax + PX * 7, ay - PX * 12);
      } else if (agent.localOrRemote === 'remote') {
        ctx.font = `bold ${PX * 2}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#facc15';
        ctx.fillText('RM', ax + PX * 7, ay - PX * 12);
      }

      ctx.restore();

      // Speech bubble
      if (agent.currentTask && (agent.currentState === 'working' || agent.currentState === 'speaking' || agent.currentState === 'thinking')) {
        const truncated = agent.currentTask.length > 20
          ? agent.currentTask.slice(0, 18) + '…'
          : agent.currentTask;
        drawBubble(ctx, ax, ay - PX * 16, truncated, pal.body, PX);
      }

      // Celebration sparks — capped at 80 total particles
      if (sr.celebrationAgent === agent.id && sr.celebrationTimer > 0 && Math.random() < 0.5 && sr.particles.length < 80) {
        for (let i = 0; i < 3; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.5 + Math.random() * 2;
          sr.particles.push({
            x: ax, y: ay - PX * 8,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
            life: 1, color: pal.body, size: PX * 1.5,
          });
        }
      }
    });

    // ── Particles ─────────────────────────────────────────────────────────────
    sr.particles = sr.particles.filter(p2 => p2.life > 0);
    sr.particles.forEach(p2 => {
      p2.life -= 0.04;
      p2.x += p2.vx; p2.y += p2.vy;
      p2.vy += 0.1; p2.vx *= 0.95;
      const sz = Math.max(1, Math.round(p2.size * p2.life));
      ctx.globalAlpha = p2.life;
      ctx.fillStyle = p2.color;
      ctx.fillRect(Math.round(p2.x), Math.round(p2.y), sz, sz);
      ctx.globalAlpha = 1;
    });

    // ── Timers ────────────────────────────────────────────────────────────────
    if (sr.celebrationTimer > 0) sr.celebrationTimer--;
    else sr.celebrationAgent = null;
    if (sr.memPulseTimer > 0) sr.memPulseTimer--;
    else sr.memPulseAgent = null;

    // ── HUD ───────────────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(5,8,18,0.85)';
    ctx.fillRect(0, 0, W, H * 0.08);

    ctx.font = `bold ${PX * 3.5}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(30,174,255,0.85)';
    ctx.fillText('● AGENT WORKSPACE', PX * 3, H * 0.057);

    if (isDemo) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('DEMO MODE', W - PX * 3, H * 0.057);
    }

    const focA = agentsRef.current.find(a => a.id === focId);
    if (focA) {
      ctx.textAlign = 'right';
      ctx.fillStyle = (AGENT_PALETTE[focA.id] ?? DEFAULT_PAL).body;
      ctx.fillText(`◉ ${focA.displayName.toUpperCase()}`, W - PX * 3, H * 0.057);
    }

    // Corner brackets
    const bSz = PX * 5;
    ctx.strokeStyle = 'rgba(30,174,255,0.3)';
    ctx.lineWidth = PX * 0.5;
    [[PX * 2, H * 0.08 + PX * 2, 1, 1], [W - PX * 2, H * 0.08 + PX * 2, -1, 1],
     [PX * 2, H - PX * 2, 1, -1], [W - PX * 2, H - PX * 2, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * bSz); ctx.lineTo(x, y); ctx.lineTo(x + sx * bSz, y);
      ctx.stroke();
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function loop() {
      render(canvas!, ctx!);
      stateRef.current.rafId = requestAnimationFrame(loop);
    }
    stateRef.current.rafId = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(stateRef.current.rafId); ro.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-pointer"
      onClick={handleClick}
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}
