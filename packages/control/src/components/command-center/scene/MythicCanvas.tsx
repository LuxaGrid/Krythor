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

// ─── Pixel art palette ────────────────────────────────────────────────────────
// Each agent has a body color, accent, and skin tone
const AGENT_PALETTE: Record<string, { body: string; accent: string; skin: string; hair: string }> = {
  atlas:    { body: '#f59e0b', accent: '#fbbf24', skin: '#fcd9b0', hair: '#92400e' },
  voltaris: { body: '#1eaeff', accent: '#38bdf8', skin: '#fcd9b0', hair: '#1d4ed8' },
  aethon:   { body: '#818cf8', accent: '#a5b4fc', skin: '#e8c5a0', hair: '#4c1d95' },
  thyros:   { body: '#93c5fd', accent: '#bfdbfe', skin: '#fcd9b0', hair: '#1e3a8a' },
  pyron:    { body: '#fb923c', accent: '#fdba74', skin: '#fcd9b0', hair: '#7c2d12' },
};

const DEFAULT_PAL = { body: '#6366f1', accent: '#818cf8', skin: '#fcd9b0', hair: '#3730a3' };

// ─── Pixel drawing helpers ────────────────────────────────────────────────────

function px(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  color: string,
  alpha = 1,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
  ctx.globalAlpha = 1;
}

// Draw a pixel-art character sprite (16×24 px block, scaled by `scale`)
function drawSprite(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  pal: typeof DEFAULT_PAL,
  state: string,
  tick: number,
  scale: number,
  focused: boolean,
) {
  const s = scale;
  const ox = cx - 8 * s; // left edge
  const oy = cy - 24 * s; // top of sprite

  // Walk cycle: bob up 1px every other frame
  const walk = (state === 'working' || state === 'thinking') && Math.floor(tick / 6) % 2 === 0;
  const legOpen = Math.floor(tick / 8) % 2 === 0;
  const yOff = walk ? -s : 0;

  // ── Head (6×6) ─────────────────────────────────────────────────────────────
  const hx = ox + 5 * s, hy = oy + yOff;
  // Hair / hat
  if (state === 'working') {
    // Hard hat
    px(ctx, hx - s, hy - 2 * s, 8 * s, 3 * s, '#fbbf24');
    px(ctx, hx - 2 * s, hy - s, 10 * s, 2 * s, '#f59e0b');
  } else {
    px(ctx, hx, hy - s, 6 * s, 2 * s, pal.hair);
    px(ctx, hx - s, hy, 2 * s, 2 * s, pal.hair);
  }
  // Skin
  px(ctx, hx, hy, 6 * s, 6 * s, pal.skin);
  // Eyes
  px(ctx, hx + s, hy + 2 * s, s, s, '#1e293b');
  px(ctx, hx + 4 * s, hy + 2 * s, s, s, '#1e293b');
  // Mouth — smile when speaking, flat otherwise
  if (state === 'speaking') {
    px(ctx, hx + s, hy + 4 * s, s, s, '#dc2626');
    px(ctx, hx + 2 * s, hy + 5 * s, 2 * s, s, '#dc2626');
    px(ctx, hx + 4 * s, hy + 4 * s, s, s, '#dc2626');
  } else {
    px(ctx, hx + s, hy + 4 * s, 4 * s, s, '#78716c');
  }

  // ── Body / shirt (6×7) ─────────────────────────────────────────────────────
  const bx = ox + 5 * s, by = oy + 6 * s + yOff;
  px(ctx, bx, by, 6 * s, 7 * s, pal.body);
  // Collar detail
  px(ctx, bx + 2 * s, by, 2 * s, 2 * s, pal.accent);
  // Arms
  px(ctx, bx - 2 * s, by, 2 * s, 5 * s, pal.skin);
  px(ctx, bx + 6 * s, by, 2 * s, 5 * s, pal.skin);
  // Active arm raise (working)
  if (state === 'working') {
    px(ctx, bx - 2 * s, by - 2 * s, 2 * s, 3 * s, pal.skin);
    px(ctx, bx + 6 * s, by - 2 * s, 2 * s, 3 * s, pal.skin);
  }

  // ── Legs (5×5) ─────────────────────────────────────────────────────────────
  const lx = ox + 5 * s, ly = oy + 13 * s + yOff;
  // Pants
  px(ctx, lx, ly, 6 * s, 4 * s, '#1e3a8a');
  if (legOpen && walk) {
    // Left leg forward
    px(ctx, lx, ly + 4 * s, 2 * s, 3 * s, '#1e3a8a');
    px(ctx, lx + 4 * s, ly + 3 * s, 2 * s, 4 * s, '#1e3a8a');
    // Shoes
    px(ctx, lx - s, ly + 7 * s, 3 * s, 2 * s, '#0f172a');
    px(ctx, lx + 4 * s, ly + 6 * s, 3 * s, 2 * s, '#0f172a');
  } else {
    // Legs together
    px(ctx, lx + s, ly + 4 * s, 2 * s, 3 * s, '#1e3a8a');
    px(ctx, lx + 3 * s, ly + 4 * s, 2 * s, 3 * s, '#1e3a8a');
    // Shoes
    px(ctx, lx, ly + 6 * s, 3 * s, 2 * s, '#0f172a');
    px(ctx, lx + 3 * s, ly + 6 * s, 3 * s, 2 * s, '#0f172a');
  }

  // ── Focus glow outline ─────────────────────────────────────────────────────
  if (focused) {
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = s * 1.5;
    ctx.shadowColor = pal.body;
    ctx.shadowBlur = 12;
    ctx.strokeRect(ox + 3 * s - 2, oy - 2 * s - 2, 10 * s + 4, 26 * s + 4);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── State indicator dot ────────────────────────────────────────────────────
  const dotColor = state === 'working' ? '#4ade80'
    : state === 'thinking' ? '#a78bfa'
    : state === 'speaking' ? '#fb923c'
    : state === 'error' ? '#f87171'
    : state === 'offline' ? '#52525b'
    : '#22d3ee';
  ctx.beginPath();
  ctx.arc(ox + 14 * s, oy - s, 2 * s, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.shadowColor = dotColor;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

// Draw a pixel-art desk
function drawDesk(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string,
  s: number,
  state: string,
  tick: number,
) {
  const dx = cx - 18 * s, dy = cy - 4 * s;
  const dw = 36 * s, dh = 12 * s;

  // Desk surface
  px(ctx, dx, dy, dw, dh, '#1e293b');
  px(ctx, dx, dy, dw, 2 * s, '#334155'); // highlight edge
  px(ctx, dx, dy + dh - s, dw, s, '#0f172a'); // shadow edge

  // Accent border
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = s;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(dx + s, dy + s, dw - 2 * s, dh - 2 * s);
  ctx.globalAlpha = 1;
  ctx.restore();

  // Monitor on desk
  const mx = cx - 5 * s, my = dy - 10 * s;
  px(ctx, mx, my, 10 * s, 8 * s, '#0f172a'); // screen bezel
  px(ctx, mx + s, my + s, 8 * s, 6 * s, '#0c1a2e'); // screen bg
  // Screen content — scrolling lines if active
  if (state !== 'idle' && state !== 'offline') {
    const lineOffset = Math.floor(tick / 4) % 3;
    for (let i = 0; i < 3; i++) {
      const ly2 = my + (i + 1) * 2 * s - lineOffset * s;
      if (ly2 > my + s && ly2 < my + 7 * s) {
        px(ctx, mx + 2 * s, ly2, (3 + Math.floor(Math.random() * 4)) * s, s, color, 0.7);
      }
    }
  } else {
    px(ctx, mx + 3 * s, my + 3 * s, 4 * s, s, '#334155');
  }
  // Monitor stand
  px(ctx, cx - s, dy - 2 * s, 2 * s, 2 * s, '#334155');
  px(ctx, cx - 3 * s, dy - s, 6 * s, s, '#334155');

  // Keyboard
  px(ctx, cx - 5 * s, dy, 10 * s, 2 * s, '#1e3a5f');
  px(ctx, cx - 4 * s, dy + s, 8 * s, s, '#172554');

  // Desk legs
  px(ctx, dx + 2 * s, dy + dh, 3 * s, 4 * s, '#0f172a');
  px(ctx, dx + dw - 5 * s, dy + dh, 3 * s, 4 * s, '#0f172a');
}

// Draw a speech/task bubble
function drawBubble(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  text: string,
  color: string,
  s: number,
) {
  ctx.font = `bold ${Math.max(9, s * 5)}px "JetBrains Mono", monospace`;
  const textW = ctx.measureText(text).width;
  const pad = 6;
  const bw = textW + pad * 2;
  const bh = 18;
  const bx = cx - bw / 2;
  const by = cy - bh - 4;

  // Pixel-art box — flat fill + colored border
  ctx.fillStyle = '#0a0f1e';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.shadowBlur = 0;

  // Tail
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - 3, by + bh);
  ctx.lineTo(cx + 3, by + bh);
  ctx.lineTo(cx, by + bh + 5);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, by + bh / 2);
  ctx.textBaseline = 'alphabetic';
}

// Draw tiled floor
function drawFloor(ctx: CanvasRenderingContext2D, W: number, H: number, tileSize: number) {
  const cols = Math.ceil(W / tileSize) + 1;
  const rows = Math.ceil(H / tileSize) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tileSize;
      const y = r * tileSize;
      const dark = (r + c) % 2 === 0;
      ctx.fillStyle = dark ? '#0a0e1a' : '#0c1120';
      ctx.fillRect(x, y, tileSize, tileSize);
    }
  }
  // Grid lines
  ctx.strokeStyle = 'rgba(30,174,255,0.06)';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * tileSize, 0);
    ctx.lineTo(c * tileSize, H);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * tileSize);
    ctx.lineTo(W, r * tileSize);
    ctx.stroke();
  }
}

// Draw pixel decorations — plants, servers, etc.
function drawProps(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, tick: number) {
  // Corner plant (bottom-left)
  const px2 = (x: number, y: number, w: number, h: number, c: string, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
    ctx.globalAlpha = 1;
  };

  // Plant top-left
  const p1x = 18, p1y = H * 0.12;
  px2(p1x + 4 * s, p1y + 6 * s, 2 * s, 6 * s, '#166534'); // stem
  px2(p1x, p1y, 5 * s, 6 * s, '#15803d'); // leaf left
  px2(p1x + 5 * s, p1y + 2 * s, 5 * s, 5 * s, '#16a34a'); // leaf right
  px2(p1x + 2 * s, p1y + 3 * s, 4 * s, 4 * s, '#22c55e'); // center
  px2(p1x + 3 * s, p1y + 12 * s, 4 * s, 4 * s, '#92400e'); // pot

  // Plant top-right
  const p2x = W - 30, p2y = H * 0.12;
  px2(p2x + 4 * s, p2y + 6 * s, 2 * s, 6 * s, '#166534');
  px2(p2x, p2y + 2 * s, 5 * s, 5 * s, '#15803d');
  px2(p2x + 5 * s, p2y, 5 * s, 6 * s, '#16a34a');
  px2(p2x + 2 * s, p2y + 3 * s, 4 * s, 4 * s, '#22c55e');
  px2(p2x + 3 * s, p2y + 12 * s, 4 * s, 4 * s, '#92400e');

  // Server rack bottom-left
  const sx = 14, sy = H * 0.55;
  px2(sx, sy, 16 * s, 22 * s, '#0f172a');
  px2(sx + s, sy + s, 14 * s, 20 * s, '#1e293b');
  for (let i = 0; i < 5; i++) {
    const ry = sy + 2 * s + i * 4 * s;
    px2(sx + 2 * s, ry, 10 * s, 3 * s, '#0c1a2e');
    const blinkOn = Math.floor(tick / (8 + i * 3)) % 2 === 0;
    px2(sx + 11 * s, ry + s, 2 * s, s, blinkOn ? '#4ade80' : '#166534');
  }

  // Couch / lounge area (bottom center)
  const cx2 = W / 2, cy2 = H * 0.88;
  px2(cx2 - 26 * s, cy2, 52 * s, 10 * s, '#1e3a5f'); // base
  px2(cx2 - 28 * s, cy2 - 8 * s, 8 * s, 8 * s, '#1d4ed8'); // left arm
  px2(cx2 + 20 * s, cy2 - 8 * s, 8 * s, 8 * s, '#1d4ed8'); // right arm
  px2(cx2 - 26 * s, cy2 - 8 * s, 52 * s, 4 * s, '#2563eb'); // back
  px2(cx2 - 22 * s, cy2 - 5 * s, 44 * s, 6 * s, '#3b82f6'); // seat cushion

  // Circular rug under couch
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#6366f1';
  ctx.beginPath();
  ctx.ellipse(cx2, cy2 + 6 * s, 30 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ─── Particle system ─────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; color: string; size: number; type: 'spark' | 'pixel';
}

// ─── Main canvas component ────────────────────────────────────────────────────

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
    scale: 1,
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
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const W = canvas.width / window.devicePixelRatio;
    const H = canvas.height / window.devicePixelRatio;
    const dpr = window.devicePixelRatio;
    const mxl = mx / dpr, myl = my / dpr;

    for (const agent of agentsRef.current) {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      if (Math.hypot(mxl - ax, myl - ay) < 32) {
        onFocusAgent(focusRef.current === agent.id ? null : agent.id);
        return;
      }
    }
    onFocusAgent(null);
  }, [onFocusAgent]);

  // Spawn celebration sparks
  function spawnSparks(s: typeof stateRef.current, agent: CommandCenterAgent, ax: number, ay: number) {
    if (s.celebrationAgent !== agent.id || s.celebrationTimer <= 0) return;
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      s.particles.push({
        x: ax, y: ay,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1,
        color: agent.themeColor,
        size: 3 + Math.random() * 3,
        type: 'pixel',
      });
    }
  }

  function render(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const sr = stateRef.current;
    sr.tick++;
    const t = sr.tick;
    const W = canvas.width / window.devicePixelRatio;
    const H = canvas.height / window.devicePixelRatio;

    // Pixel scale — OpenClaw uses PX=5; we target ~3-4 at 1080p
    const s = Math.max(2, Math.round(W / 280));
    sr.scale = s;
    const tileSize = s * 10;

    ctx.imageSmoothingEnabled = false; // Must reset each frame after clearRect
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Floor tiles ──────────────────────────────────────────────────────────
    drawFloor(ctx, W, H, tileSize);

    // ── Top wall / ceiling strip ─────────────────────────────────────────────
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, W, H * 0.08);
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(0, H * 0.08, W, 3);

    // ── Props (plants, server, couch) ────────────────────────────────────────
    drawProps(ctx, W, H, s, t);

    // ── Zone labels (wall-mounted station signs) ─────────────────────────────
    zonesRef.current.forEach(zone => {
      const zx = (zone.position.x / 100) * W;
      const zy = (zone.position.y / 100) * H;
      const agent = agentsRef.current.find(a => a.homeZone === zone.id);
      const isActive = agent && agent.currentState !== 'idle' && agent.currentState !== 'offline';

      // Station platform glow on floor
      ctx.save();
      ctx.globalAlpha = isActive ? 0.15 : 0.07;
      const grd = ctx.createRadialGradient(zx, zy + 8 * s, 0, zx, zy + 8 * s, 40 * s);
      grd.addColorStop(0, zone.accentColor);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(zx, zy + 14 * s, 32 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Zone label above desk
      ctx.font = `bold ${Math.max(8, s * 5)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = zone.accentColor;
      ctx.globalAlpha = isActive ? 0.9 : 0.45;
      ctx.shadowColor = zone.accentColor;
      ctx.shadowBlur = isActive ? 8 : 0;
      ctx.fillText(zone.label.toUpperCase(), zx, zy - 52 * s);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    });

    // ── Desks ────────────────────────────────────────────────────────────────
    agentsRef.current.forEach(agent => {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      drawDesk(ctx, ax, ay + 14 * s, pal.body, s, agent.currentState, t);
    });

    // ── Connection lines (beams on floor) ────────────────────────────────────
    const atlas = agentsRef.current.find(a => a.id === 'atlas');
    if (atlas) {
      const ax = (atlas.position.x / 100) * W;
      const ay = (atlas.position.y / 100) * H + 18 * s;
      agentsRef.current.filter(a => a.id !== 'atlas').forEach(agent => {
        const bx = (agent.position.x / 100) * W;
        const by = (agent.position.y / 100) * H + 18 * s;
        const isActive = agent.currentState !== 'idle' && agent.currentState !== 'offline';

        ctx.save();
        ctx.globalAlpha = isActive ? 0.22 : 0.06;
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = isActive ? -(t * 1.5) % 12 : 0;
        ctx.strokeStyle = agent.themeColor;
        ctx.lineWidth = isActive ? 1.5 : 0.75;
        ctx.shadowColor = agent.themeColor;
        ctx.shadowBlur = isActive ? 6 : 0;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.restore();
      });
    }

    // ── Agents (sprites) ─────────────────────────────────────────────────────
    const focId = focusRef.current;
    agentsRef.current.forEach(agent => {
      const ax = (agent.position.x / 100) * W;
      const ay = (agent.position.y / 100) * H;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      const focused = focId === agent.id;
      const dimmed = focId !== null && !focused;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.3 : 1;

      // Memory pulse ring
      if (sr.memPulseTimer > 0 && sr.memPulseAgent === agent.id) {
        const pr = 28 + (1 - sr.memPulseTimer / 90) * 20;
        ctx.beginPath();
        ctx.arc(ax, ay, pr, 0, Math.PI * 2);
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#93c5fd';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      drawSprite(ctx, ax, ay, pal, agent.currentState, t + parseInt(agent.id, 36) % 20, s, focused);

      // Name label
      ctx.font = `bold ${Math.max(8, s * 5)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = pal.body;
      ctx.shadowColor = pal.body;
      ctx.shadowBlur = 4;
      ctx.fillText(agent.displayName.toUpperCase(), ax, ay + 32 * s);
      ctx.shadowBlur = 0;

      // State label
      ctx.font = `${Math.max(7, s * 4)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(148,163,184,0.75)';
      ctx.fillText(agent.currentState, ax, ay + 32 * s + Math.max(8, s * 5) + 2);

      // LC badge
      if (agent.localOrRemote === 'local') {
        ctx.font = `bold ${Math.max(6, s * 3.5)}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('LC', ax + 16 * s, ay - 22 * s);
      } else if (agent.localOrRemote === 'remote') {
        ctx.font = `bold ${Math.max(6, s * 3.5)}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#facc15';
        ctx.fillText('RM', ax + 16 * s, ay - 22 * s);
      }

      ctx.restore();

      // Task speech bubble
      if (agent.currentTask && (agent.currentState === 'working' || agent.currentState === 'speaking' || agent.currentState === 'thinking')) {
        const text = agent.currentTask.length > 20 ? agent.currentTask.slice(0, 18) + '…' : agent.currentTask;
        drawBubble(ctx, ax, ay - 26 * s, text, pal.body, s);
      }

      // Celebration sparks spawn
      if (Math.random() < 0.4) {
        spawnSparks(sr, agent, ax, ay - 8 * s);
      }
    });

    // ── Particles ────────────────────────────────────────────────────────────
    sr.particles = sr.particles.filter(p => p.life > 0);
    sr.particles.forEach(p => {
      p.life -= 0.035;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.vx *= 0.94;
      if (p.type === 'pixel') {
        const sz = Math.max(1, Math.round(p.size * p.life));
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
        ctx.globalAlpha = 1;
      }
    });

    // ── Timers ───────────────────────────────────────────────────────────────
    if (sr.celebrationTimer > 0) sr.celebrationTimer--;
    else sr.celebrationAgent = null;
    if (sr.memPulseTimer > 0) sr.memPulseTimer--;
    else sr.memPulseAgent = null;

    // ── HUD overlay ──────────────────────────────────────────────────────────
    // Top bar
    ctx.fillStyle = 'rgba(6,10,20,0.82)';
    ctx.fillRect(0, 0, W, H * 0.08);

    ctx.font = `bold ${Math.max(9, s * 5)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(30,174,255,0.8)';
    ctx.fillText('● AGENT WORKSPACE', 12, H * 0.055);

    if (isDemo) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('DEMO MODE', W - 12, H * 0.055);
    }

    // Focus indicator
    const focA = agentsRef.current.find(a => a.id === focId);
    if (focA) {
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.max(9, s * 5)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = (AGENT_PALETTE[focA.id] ?? DEFAULT_PAL).body;
      ctx.fillText(`◉ ${focA.displayName.toUpperCase()}`, W - 12, H * 0.055);
    }

    // Corner HUD brackets
    const bSz = 12, bPad = 4;
    ctx.strokeStyle = 'rgba(30,174,255,0.3)';
    ctx.lineWidth = 1.5;
    [[bPad, H * 0.08 + bPad, 1, 1], [W - bPad, H * 0.08 + bPad, -1, 1],
     [bPad, H - bPad, 1, -1], [W - bPad, H - bPad, -1, -1]].forEach(([x, y, sx2, sy2]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + sy2 * bSz);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx2 * bSz, y);
      ctx.stroke();
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false; // Preserve hard pixel edges
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
      style={{ display: 'block', imageRendering: 'pixelated' }}
    />
  );
}
