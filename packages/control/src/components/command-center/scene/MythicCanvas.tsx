import React, { useRef, useEffect, useCallback } from 'react';
import type { CommandCenterAgent, SceneZone, SceneZoneId } from '../types';

interface MythicCanvasProps {
  agents: CommandCenterAgent[];
  zones: SceneZone[];
  activeZones: Set<SceneZoneId>;
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  memoryPulseAgentId?: string | null;
  isDemo: boolean;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const AGENT_PALETTE: Record<string, { body: string; accent: string; skin: string; hair: string }> = {
  atlas:    { body: '#f59e0b', accent: '#fde68a', skin: '#d4a96a', hair: '#92400e' }, // Titan — gold/amber
  voltaris: { body: '#06b6d4', accent: '#67e8f9', skin: '#a5f3fc', hair: '#0e7490' }, // Elemental — cyan/teal
  aethon:   { body: '#7c3aed', accent: '#c4b5fd', skin: '#ddd6fe', hair: '#4c1d95' }, // Mage — violet/arcane
  thyros:   { body: '#3b82f6', accent: '#bfdbfe', skin: '#e0f2fe', hair: '#1e3a8a' }, // Wraith — ice-blue
  pyron:    { body: '#dc2626', accent: '#fca5a5', skin: '#fcd9b0', hair: '#7f1d1d' }, // Elemental — fire-red
};
const DEFAULT_PAL = { body: '#6366f1', accent: '#818cf8', skin: '#fcd9b0', hair: '#3730a3' };


// ─── Bridge layout constants ───────────────────────────────────────────────────
// All positions are expressed as fractions of W/H and computed at render time.
// This ensures correct layout at any canvas size — no hardcoded pixel offsets.

// Station positions (fraction of W, fraction of H) — Star Trek bridge arc layout
// Atlas: center-top command chair
// Others: arc consoles around the command area
const STATION_POSITIONS: Record<string, { fx: number; fy: number }> = {
  atlas:    { fx: 0.50, fy: 0.38 }, // center — command chair
  voltaris: { fx: 0.22, fy: 0.58 }, // left arc — helm
  aethon:   { fx: 0.78, fy: 0.58 }, // right arc — science
  thyros:   { fx: 0.68, fy: 0.74 }, // lower right — ops
  pyron:    { fx: 0.32, fy: 0.74 }, // lower left — engineering
};

// ─── Wandering system ─────────────────────────────────────────────────────────
interface AgentWander {
  x: number; y: number;
  targetX: number; targetY: number;
  homeX: number; homeY: number;
  walkPhase: number;
  facing: 1 | -1;
  wanderTimer: number;
  isWalking: boolean;
}

// ─── Pixel helpers ────────────────────────────────────────────────────────────
function p(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, a = 1) {
  if (a !== 1) ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  if (a !== 1) ctx.globalAlpha = 1;
}

// ─── Sprite drawing — Tron robot ──────────────────────────────────────────────
function drawSprite(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  pal: typeof DEFAULT_PAL,
  state: string,
  walkPhase: number,
  facing: number,
  PX: number,
  focused: boolean,
  _agentId: string,
) {
  const working   = state === 'working';
  const thinking  = state === 'thinking';
  const speaking  = state === 'speaking';
  const offline   = state === 'offline';
  const handoff   = state === 'handoff';

  const bob = Math.abs(Math.sin(walkPhase * 3)) * PX * 0.5;

  const bx = cx - 4 * PX;
  const by = cy - 14 * PX - bob;

  ctx.save();
  if (facing === -1) {
    ctx.scale(-1, 1);
    ctx.translate(-cx * 2, 0);
  }
  if (offline) ctx.globalAlpha = 0.22;

  // Glow helper — fills a rect with accent color + shadow bloom
  const glow = (lx: number, ly: number, lw: number, lh: number, alpha = 1, blur = PX * 2.5, color = pal.accent) => {
    ctx.save();
    ctx.globalAlpha = offline ? 0.12 : alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillRect(Math.round(lx), Math.round(ly), Math.max(1, Math.round(lw)), Math.max(1, Math.round(lh)));
    ctx.shadowBlur = 0;
    ctx.restore();
  };

  // ── Helmet ───────────────────────────────────────────────────────────────────
  const headW = 8 * PX, headH = 6 * PX;
  const hx = bx;
  const hy = by;

  // Flat-top robot head — wider than tall, angular
  p(ctx, hx + PX, hy, headW - PX * 2, headH, '#060b14');    // main head block
  p(ctx, hx, hy + PX, headW, headH - PX * 2, '#060b14');    // side ears flush
  // Helmet plates — subtle dark panels
  p(ctx, hx + PX, hy, headW - PX * 2, PX, '#0d1520');       // top plate
  p(ctx, hx, hy + PX, PX, headH - PX * 2, '#0d1520');       // left panel
  p(ctx, hx + headW - PX, hy + PX, PX, headH - PX * 2, '#0d1520'); // right panel

  // Outline trim — glowing circuit edges
  glow(hx + PX, hy, headW - PX * 2, PX * 0.5);              // top edge
  glow(hx, hy + PX, PX * 0.5, headH - PX * 2);              // left edge
  glow(hx + headW - PX * 0.5, hy + PX, PX * 0.5, headH - PX * 2); // right edge
  glow(hx, hy + headH - PX * 0.5, headW, PX * 0.5);         // bottom edge

  // Antenna — single centered spike on top
  glow(cx - PX * 0.25, hy - PX * 3, PX * 0.5, PX * 3, 0.8); // stem
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, hy - PX * 3, PX * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = pal.accent;
  ctx.shadowColor = pal.accent;
  ctx.shadowBlur = PX * 5;
  ctx.globalAlpha = offline ? 0.12 : 0.95;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Visor — full-width glowing bar
  const visorY = hy + PX * 2;
  p(ctx, hx + PX, visorY, headW - PX * 2, PX * 1.5, '#020509'); // dark recess
  // Visor glow bar
  ctx.save();
  ctx.globalAlpha = offline ? 0.1 : 0.92;
  ctx.fillStyle = pal.accent;
  ctx.shadowColor = pal.accent;
  ctx.shadowBlur = PX * 5;
  ctx.fillRect(Math.round(hx + PX), Math.round(visorY + PX * 0.25), Math.round(headW - PX * 2), Math.round(PX * 0.9));
  // Outer bloom pass
  ctx.shadowBlur = PX * 10;
  ctx.globalAlpha = 0.28;
  ctx.fillRect(Math.round(hx + PX), Math.round(visorY + PX * 0.25), Math.round(headW - PX * 2), Math.round(PX * 0.9));
  ctx.shadowBlur = 0;
  ctx.restore();

  // State-based visor expression
  const mouthY = hy + PX * 4 + PX * 0.5;
  if (speaking) {
    // Three-bar open grille
    for (let b = 0; b < 3; b++) {
      glow(hx + PX * 1.5 + b * PX * 2, mouthY, PX, PX * 0.6, 0.8);
    }
  } else if (thinking) {
    // Asymmetric blinking dots
    glow(hx + PX * 2, mouthY + PX * 0.2, PX * 1.5, PX * 0.5, 0.65);
    glow(hx + PX * 5, mouthY + PX * 0.2, PX * 0.8, PX * 0.5, 0.35);
  } else {
    // Flat neutral grille line
    glow(hx + PX * 1.5, mouthY + PX * 0.2, headW - PX * 3, PX * 0.4, 0.35);
  }

  // ── Robot torso ───────────────────────────────────────────────────────────────
  const bodyY = hy + headH;
  const bodyW = 8 * PX;

  p(ctx, bx, bodyY, bodyW, 5 * PX, '#050810');

  // Shoulder blocks — slight overhang
  p(ctx, bx - PX, bodyY, PX * 2, PX * 1.5, '#0a0f1a');
  p(ctx, bx + bodyW - PX, bodyY, PX * 2, PX * 1.5, '#0a0f1a');
  glow(bx - PX, bodyY, PX * 2, PX * 0.5);             // left shoulder trim
  glow(bx + bodyW - PX, bodyY, PX * 2, PX * 0.5);     // right shoulder trim

  // Chest circuit panel
  glow(bx, bodyY, bodyW, PX * 0.5);                   // top chest edge
  glow(bx, bodyY, PX * 0.5, 5 * PX, 0.6);             // left side
  glow(bx + bodyW - PX * 0.5, bodyY, PX * 0.5, 5 * PX, 0.6); // right side
  glow(bx, bodyY + 5 * PX - PX * 0.5, bodyW, PX * 0.5, 0.5); // bottom edge
  // Vertical spine
  glow(cx - PX * 0.25, bodyY + PX, PX * 0.5, PX * 3, 0.5);
  // Horizontal rib
  glow(bx + PX, bodyY + PX * 2.5, bodyW - PX * 2, PX * 0.5, 0.4);

  // Core reactor — glowing circle center chest
  ctx.save();
  const reactorPulse = (working || speaking) ? 0.9 + Math.sin(walkPhase * 8) * 0.1 : 0.55;
  ctx.beginPath();
  ctx.arc(cx, bodyY + PX * 2.2, PX * 1.4, 0, Math.PI * 2);
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = PX * 0.5;
  ctx.shadowColor = pal.accent;
  ctx.shadowBlur = PX * 4;
  ctx.globalAlpha = offline ? 0.1 : reactorPulse;
  ctx.stroke();
  // Inner fill pulse
  ctx.beginPath();
  ctx.arc(cx, bodyY + PX * 2.2, PX * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = pal.accent;
  ctx.shadowBlur = PX * 6;
  ctx.globalAlpha = offline ? 0.08 : reactorPulse * 0.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  // ── Arms ──────────────────────────────────────────────────────────────────────
  const armY = bodyY + PX * 0.5;
  const armSwing = working ? Math.sin(walkPhase * 8) * PX
    : handoff ? -PX * 2 : 0;
  const rightArmSwing = working ? -armSwing : handoff ? -PX * 2 : 0;

  // Left arm — black block + outer circuit stripe + wrist cuff
  p(ctx, bx - PX * 1.5, armY + armSwing, PX * 1.5, PX * 3.5, '#050810');
  glow(bx - PX * 1.5, armY + armSwing, PX * 0.5, PX * 3.5, 0.7);
  glow(bx - PX * 1.5, armY + PX * 3 + armSwing, PX * 1.5, PX * 0.5, 0.55); // wrist

  // Right arm
  p(ctx, bx + bodyW, armY + rightArmSwing, PX * 1.5, PX * 3.5, '#050810');
  glow(bx + bodyW + PX, armY + rightArmSwing, PX * 0.5, PX * 3.5, 0.7);
  glow(bx + bodyW, armY + PX * 3 + rightArmSwing, PX * 1.5, PX * 0.5, 0.55);

  // ── Hover flame — no legs, single thruster orb-flame below body ──────────────
  const flameBaseY = bodyY + 5 * PX;
  const flameOrbY  = flameBaseY + PX * 6;       // orb center
  const flicker    = Math.sin(walkPhase * 9) * PX * 0.6; // fast flicker
  const flicker2   = Math.sin(walkPhase * 11 + 1.2) * PX * 0.4;

  ctx.save();
  ctx.globalAlpha = offline ? 0.1 : 1;

  // Flame cone — tapers from body bottom down to the orb
  // Outer soft cone (wide, very transparent)
  const coneGrd = ctx.createLinearGradient(cx, flameBaseY, cx, flameOrbY);
  coneGrd.addColorStop(0, 'transparent');
  coneGrd.addColorStop(0.4, pal.body + '55');
  coneGrd.addColorStop(1, pal.accent + 'aa');
  ctx.fillStyle = coneGrd;
  ctx.beginPath();
  ctx.moveTo(cx - PX * 3, flameBaseY);
  ctx.lineTo(cx + PX * 3, flameBaseY);
  ctx.lineTo(cx + PX * 1.5 + flicker2, flameOrbY);
  ctx.lineTo(cx - PX * 1.5 + flicker,  flameOrbY);
  ctx.closePath();
  ctx.fill();

  // Inner bright core cone
  const innerConeGrd = ctx.createLinearGradient(cx, flameBaseY + PX, cx, flameOrbY);
  innerConeGrd.addColorStop(0, 'transparent');
  innerConeGrd.addColorStop(0.6, pal.accent + '88');
  innerConeGrd.addColorStop(1, '#ffffff99');
  ctx.fillStyle = innerConeGrd;
  ctx.beginPath();
  ctx.moveTo(cx - PX * 1.5, flameBaseY + PX);
  ctx.lineTo(cx + PX * 1.5, flameBaseY + PX);
  ctx.lineTo(cx + PX * 0.6 + flicker2 * 0.5, flameOrbY);
  ctx.lineTo(cx - PX * 0.6 + flicker  * 0.5, flameOrbY);
  ctx.closePath();
  ctx.fill();

  // Bottom body edge — nozzle trim line
  glow(bx + PX, flameBaseY, 6 * PX, PX * 0.5, 0.6);

  ctx.shadowBlur = 0;

  ctx.restore();

  // ── Focus glow ────────────────────────────────────────────────────────────────
  if (focused) {
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = PX * 0.5;
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = 18;
    ctx.strokeRect(bx - PX * 2, by - PX * 4, 12 * PX, 26 * PX);
    ctx.shadowBlur = 30;
    ctx.globalAlpha = 0.14;
    ctx.strokeRect(bx - PX * 3, by - PX * 5, 14 * PX, 29 * PX);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── State dot ─────────────────────────────────────────────────────────────────
  const dotColor = working  ? '#4ade80'
    : thinking ? '#a78bfa'
    : speaking ? pal.accent
    : state === 'error'   ? '#f87171'
    : state === 'offline' ? '#334155'
    : pal.accent;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx + 5 * PX, by - PX * 2, PX * 1.2, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.shadowColor = dotColor;
  ctx.shadowBlur = 10;
  ctx.globalAlpha = offline ? 0.2 : 1;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.restore();
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

  ctx.fillStyle = 'rgba(4,8,20,0.96)';
  ctx.strokeStyle = color;
  ctx.lineWidth = PX * 0.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(bx, by, bw, bh, PX);
  } else {
    ctx.rect(bx, by, bw, bh);
  }
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

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

// ─── Star Trek Bridge background ─────────────────────────────────────────────
function drawBridge(ctx: CanvasRenderingContext2D, W: number, H: number, PX: number, tick: number) {
  // Deep space void
  ctx.fillStyle = '#020409';
  ctx.fillRect(0, 0, W, H);

  // ── Starfield ──────────────────────────────────────────────────────────────
  // Static seed-based stars — consistent per render, no random() per frame
  const starCount = 120;
  for (let i = 0; i < starCount; i++) {
    // Deterministic position from index
    const sx = ((i * 137.508 + 43) % W);
    const sy = ((i * 97.345 + 17) % (H * 0.72));
    const brightness = 0.3 + (i % 7) * 0.1;
    const twinkle = Math.sin(tick * 0.02 + i * 0.7) * 0.15;
    const sz = i % 5 === 0 ? 1.5 : 0.8;
    ctx.globalAlpha = brightness + twinkle;
    ctx.fillStyle = i % 11 === 0 ? '#bfdbfe' : i % 7 === 0 ? '#fde68a' : '#ffffff';
    ctx.fillRect(Math.round(sx), Math.round(sy), sz, sz);
  }
  ctx.globalAlpha = 1;

  // ── Viewscreen (upper center — main display) ───────────────────────────────
  const vsW = W * 0.55, vsH = H * 0.30;
  const vsX = (W - vsW) / 2, vsY = H * 0.02;

  // Outer frame — LCARS orange bar
  ctx.fillStyle = '#c47c2c';
  ctx.fillRect(vsX - PX * 2, vsY - PX * 2, vsW + PX * 4, PX * 2);
  ctx.fillRect(vsX - PX * 2, vsY + vsH, vsW + PX * 4, PX * 2);
  ctx.fillStyle = '#1a5f8a';
  ctx.fillRect(vsX - PX * 2, vsY, PX * 2, vsH);
  ctx.fillRect(vsX + vsW, vsY, PX * 2, vsH);

  // Screen interior
  const grad = ctx.createLinearGradient(vsX, vsY, vsX, vsY + vsH);
  grad.addColorStop(0, '#040c1e');
  grad.addColorStop(0.5, '#050f25');
  grad.addColorStop(1, '#030810');
  ctx.fillStyle = grad;
  ctx.fillRect(vsX, vsY, vsW, vsH);

  // ── Tron brain-planet — animated ──────────────────────────────────────────
  const nebX = vsX + vsW * 0.5, nebY = vsY + vsH * 0.5;
  const PR = vsW * 0.115; // planet radius

  // Outer ambient halo — deep nebula glow
  const haloGrd = ctx.createRadialGradient(nebX, nebY, PR * 0.5, nebX, nebY, PR * 2.8);
  haloGrd.addColorStop(0, 'rgba(0,120,255,0.22)');
  haloGrd.addColorStop(0.4, 'rgba(40,20,120,0.13)');
  haloGrd.addColorStop(0.7, 'rgba(0,200,255,0.05)');
  haloGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = haloGrd;
  ctx.beginPath();
  ctx.ellipse(nebX, nebY, PR * 2.8, PR * 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Clip all planet drawing to the sphere
  ctx.save();
  ctx.beginPath();
  ctx.arc(nebX, nebY, PR, 0, Math.PI * 2);
  ctx.clip();

  // Base sphere gradient — dark core lit from upper-left
  const pGrd = ctx.createRadialGradient(nebX - PR * 0.35, nebY - PR * 0.30, 0, nebX, nebY, PR);
  pGrd.addColorStop(0, '#1a4a7a');
  pGrd.addColorStop(0.45, '#0c2244');
  pGrd.addColorStop(0.8, '#06101e');
  pGrd.addColorStop(1, '#020509');
  ctx.fillStyle = pGrd;
  ctx.fillRect(nebX - PR, nebY - PR, PR * 2, PR * 2);

  // Rotating latitude lines (horizontal circuit bands)
  const rotLat = (tick * 0.0017) % (Math.PI * 2);
  ctx.strokeStyle = '#1eaeff';
  ctx.lineWidth = 0.6;
  for (let li = 0; li < 9; li++) {
    const latFrac = (li / 8) - 0.5; // -0.5 to +0.5
    const latR = Math.abs(Math.cos(latFrac * Math.PI));
    if (latR < 0.08) continue;
    const lcy = nebY + latFrac * PR * 2;
    const lcr = Math.sqrt(Math.max(0, PR * PR - (lcy - nebY) ** 2));
    if (lcr < 2) continue;
    // Animated sweep — segments that travel around
    const offset = rotLat + li * 0.4;
    const segArc = Math.PI * 0.55;
    ctx.save();
    ctx.globalAlpha = 0.22 + 0.12 * Math.sin(tick * 0.04 + li * 0.9);
    ctx.shadowColor = '#1eaeff';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.ellipse(nebX, lcy, lcr, lcr * 0.25, 0, offset, offset + segArc);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(nebX, lcy, lcr, lcr * 0.25, 0, offset + Math.PI, offset + Math.PI + segArc * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  // Rotating meridian lines (vertical great-circle arcs)
  const rotMer = (tick * 0.0027) % Math.PI;
  const meridianCount = 7;
  for (let mi = 0; mi < meridianCount; mi++) {
    const angle = rotMer + (mi / meridianCount) * Math.PI;
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.10 * Math.sin(tick * 0.05 + mi * 1.1);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 0.7;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 4;
    // Draw as squashed ellipse (perspective of a great circle)
    const squeeze = Math.abs(Math.cos(angle));
    ctx.beginPath();
    ctx.ellipse(nebX, nebY, PR * squeeze + 0.5, PR, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Circuit node hotspots — bright intersection dots that pulse
  const nodeCount = 8;
  for (let ni = 0; ni < nodeCount; ni++) {
    const theta = (ni / nodeCount) * Math.PI * 2 + tick * 0.002;
    const phi   = ((ni * 137.5) % 180) * Math.PI / 180;
    const nx = nebX + PR * 0.82 * Math.sin(phi) * Math.cos(theta);
    const ny = nebY + PR * 0.82 * Math.sin(phi) * Math.sin(theta) * 0.4;
    const pulse = 0.5 + 0.5 * Math.sin(tick * 0.12 + ni * 0.8);
    ctx.save();
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle = '#4fffff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(nx, ny, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Data pulse arcs — short bright arcs chasing around the equator
  for (let pi2 = 0; pi2 < 3; pi2++) {
    const pAngle = (tick * 0.006 + pi2 * Math.PI * 2 / 3) % (Math.PI * 2);
    const px2 = nebX + PR * 0.96 * Math.cos(pAngle);
    const py2 = nebY + PR * 0.96 * Math.sin(pAngle) * 0.28;
    const pulseFade = 0.7 + 0.3 * Math.sin(tick * 0.18 + pi2);
    ctx.save();
    ctx.globalAlpha = pulseFade;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(px2, py2, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Atmospheric rim — inner glow on sphere edge
  const rimGrd = ctx.createRadialGradient(nebX, nebY, PR * 0.72, nebX, nebY, PR);
  rimGrd.addColorStop(0, 'transparent');
  rimGrd.addColorStop(0.7, 'rgba(0,140,255,0.08)');
  rimGrd.addColorStop(1, 'rgba(0,200,255,0.38)');
  ctx.fillStyle = rimGrd;
  ctx.fillRect(nebX - PR, nebY - PR, PR * 2, PR * 2);

  ctx.restore(); // end clip

  // Outer sphere stroke — crisp glowing edge
  ctx.save();
  ctx.strokeStyle = '#1eaeff';
  ctx.lineWidth = 1.2;
  ctx.shadowColor = '#1eaeff';
  ctx.shadowBlur = 16;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(nebX, nebY, PR, 0, Math.PI * 2);
  ctx.stroke();
  // Double-pass for stronger bloom
  ctx.shadowBlur = 30;
  ctx.globalAlpha = 0.25;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // Orbiting ring — tilted circuit loop around the planet
  ctx.save();
  ctx.strokeStyle = '#00e5ff';
  ctx.lineWidth = 0.9;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur = 10;
  ctx.globalAlpha = 0.50;
  const ringRot = tick * 0.0022;
  ctx.save();
  ctx.translate(nebX, nebY);
  ctx.rotate(ringRot);
  ctx.beginPath();
  ctx.ellipse(0, 0, PR * 1.42, PR * 0.30, Math.PI * 0.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  // Thinking pulse — radial wave emitted from planet every ~3 s
  const waveCycle = tick % 190;
  if (waveCycle < 90) {
    const wR = PR + (waveCycle / 90) * PR * 1.1;
    const wAlpha = (1 - waveCycle / 90) * 0.45;
    ctx.save();
    ctx.strokeStyle = '#1eaeff';
    ctx.lineWidth = 1;
    ctx.shadowColor = '#1eaeff';
    ctx.shadowBlur = 8;
    ctx.globalAlpha = wAlpha;
    ctx.beginPath();
    ctx.arc(nebX, nebY, wR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // Scan lines on viewscreen
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#000000';
  for (let sy2 = vsY; sy2 < vsY + vsH; sy2 += 2) {
    ctx.fillRect(vsX, sy2, vsW, 1);
  }
  ctx.restore();

  // Moving scan beam
  const scanY = vsY + ((tick * 0.8) % vsH);
  const scanGrd = ctx.createLinearGradient(vsX, scanY - 4, vsX, scanY + 4);
  scanGrd.addColorStop(0, 'transparent');
  scanGrd.addColorStop(0.5, 'rgba(0,200,255,0.12)');
  scanGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = scanGrd;
  ctx.fillRect(vsX, scanY - 4, vsW, 8);

  // Viewscreen label
  ctx.font = `bold ${PX * 2.5}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,200,80,0.7)';
  ctx.fillText('MAIN VIEWER', vsX + vsW - PX, vsY + PX * 3);

  // ── Bridge floor gradient ──────────────────────────────────────────────────
  const floorY = H * 0.32;
  const floorGrd = ctx.createLinearGradient(0, floorY, 0, H);
  floorGrd.addColorStop(0, 'rgba(3,8,20,0)');
  floorGrd.addColorStop(0.3, 'rgba(5,12,28,0.8)');
  floorGrd.addColorStop(1, 'rgba(4,8,18,0.95)');
  ctx.fillStyle = floorGrd;
  ctx.fillRect(0, floorY, W, H - floorY);

  // ── Bridge deck grid (subtle perspective lines) ────────────────────────────
  const horizonY = H * 0.38;
  const vanishX = W * 0.5;
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#1eaeff';
  ctx.lineWidth = 0.5;
  // Radial perspective lines from vanishing point
  for (let i = 0; i <= 12; i++) {
    const bx2 = (W / 12) * i;
    ctx.beginPath();
    ctx.moveTo(vanishX, horizonY);
    ctx.lineTo(bx2, H);
    ctx.stroke();
  }
  // Horizontal deck lines
  for (let r = 0; r < 8; r++) {
    const py2 = horizonY + (H - horizonY) * (r / 7) ** 1.5;
    ctx.beginPath();
    ctx.moveTo(0, py2);
    ctx.lineTo(W, py2);
    ctx.stroke();
  }
  ctx.restore();

  // ── LCARS side panels ──────────────────────────────────────────────────────
  drawLCARSPanel(ctx, PX * 2, H * 0.35, PX * 18, H * 0.55, tick, 'left');
  drawLCARSPanel(ctx, W - PX * 20, H * 0.35, PX * 18, H * 0.55, tick, 'right');

  // ── Command arc console (curved desk around command chair) ─────────────────
  drawCommandArc(ctx, W, H, PX, tick);
}

// ─── LCARS side panel ─────────────────────────────────────────────────────────
function drawLCARSPanel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  tick: number, side: 'left' | 'right',
) {
  const colors = ['#c47c2c', '#1a5f8a', '#9b59b6', '#27ae60', '#1eaeff', '#c0392b'];

  // Corner bracket
  ctx.strokeStyle = '#1a5f8a';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  if (side === 'left') {
    ctx.moveTo(x + w, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Colored status blocks — more of them, smaller, stronger glow when active
  const blockCount = 14;
  const blockH = (h - 4) / blockCount;
  for (let i = 0; i < blockCount; i++) {
    const by2 = y + 2 + i * blockH;
    const bh2 = blockH * 0.6; // only 60% filled — visible gap between blocks
    const color = colors[i % colors.length];
    const active = Math.floor(tick / 360) % blockCount === i;
    if (active) {
      // Outer ambient halo
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = color;
      ctx.fillRect(x - 2, by2 - 2, w + 4, bh2 + 4);
      // Core block — bright
      ctx.shadowBlur = 12;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(x + 2, by2, w - 4, bh2);
      ctx.shadowBlur = 0;
    } else {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, by2, w - 4, bh2);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// ─── Command arc console ──────────────────────────────────────────────────────
function drawCommandArc(
  ctx: CanvasRenderingContext2D,
  W: number, H: number, PX: number, tick: number,
) {
  const cx = W * 0.5;
  const cy = H * 0.82; // arc center below screen center
  const rx = W * 0.42; // horizontal radius
  const ry = H * 0.22; // vertical radius

  // Outer arc console surface
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
  ctx.closePath();

  const arcGrd = ctx.createLinearGradient(cx, cy - ry, cx, cy);
  arcGrd.addColorStop(0, '#0d1f3c');
  arcGrd.addColorStop(0.5, '#0a1628');
  arcGrd.addColorStop(1, '#060e1c');
  ctx.fillStyle = arcGrd;
  ctx.fill();

  // Arc edge glow
  ctx.strokeStyle = '#1eaeff';
  ctx.lineWidth = PX * 0.6;
  ctx.shadowColor = '#1eaeff';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner arc (raised inner edge)
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.72, ry * 0.72, 0, Math.PI, Math.PI * 2);
  ctx.strokeStyle = 'rgba(30,174,255,0.3)';
  ctx.lineWidth = PX * 0.4;
  ctx.stroke();

  ctx.restore();

  // Console panels on the arc surface — 5 stations
  const stations = [
    { fx: 0.18, label: 'HELM',   color: '#1eaeff' },
    { fx: 0.34, label: 'ENG',    color: '#fb923c' },
    { fx: 0.50, label: 'CMD',    color: '#f59e0b' },
    { fx: 0.66, label: 'OPS',    color: '#93c5fd' },
    { fx: 0.82, label: 'SCI',    color: '#818cf8' },
  ];

  stations.forEach((st, i) => {
    const angle = Math.PI + st.fx * Math.PI; // spread across arc
    const consX = cx + Math.cos(angle) * rx * 0.86;
    const consY = cy + Math.sin(angle) * ry * 0.86;
    const pw = PX * 10, ph = PX * 4;

    // Panel surface
    ctx.fillStyle = '#0a1628';
    ctx.fillRect(consX - pw / 2, consY - ph / 2, pw, ph);
    ctx.strokeStyle = st.color;
    ctx.lineWidth = PX * 0.4;
    ctx.globalAlpha = 0.7;
    ctx.strokeRect(consX - pw / 2, consY - ph / 2, pw, ph);
    ctx.globalAlpha = 1;

    // Blinking indicator
    const blink = Math.floor(tick / (15 + i * 7)) % 2 === 0;
    ctx.fillStyle = blink ? st.color : 'rgba(30,174,255,0.2)';
    ctx.fillRect(consX - pw / 2 + PX, consY - ph / 4, PX * 1.5, PX * 1.5);

    // Data bars
    for (let b = 0; b < 3; b++) {
      const barW = PX * (1.5 + (Math.sin(tick * 0.05 + i + b * 1.3) * 0.5 + 0.5) * 3);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = st.color;
      ctx.fillRect(consX - pw / 2 + PX * 3 + b * PX * 2.2, consY - PX * 0.8, barW, PX * 1.5);
    }
    ctx.globalAlpha = 1;

    // Label
    ctx.font = `bold ${PX * 2}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = st.color;
    ctx.globalAlpha = 0.65;
    ctx.fillText(st.label, consX, consY + ph / 2 + PX * 2.5);
    ctx.globalAlpha = 1;
  });

  // Center command chair platform
  const chairX = cx, chairY = cy - ry * 0.15;
  const chairRx = PX * 14, chairRy = PX * 5;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(chairX, chairY, chairRx, chairRy, 0, 0, Math.PI * 2);
  const chairGrd = ctx.createRadialGradient(chairX, chairY, 0, chairX, chairY, chairRx);
  chairGrd.addColorStop(0, 'rgba(245,158,11,0.15)');
  chairGrd.addColorStop(0.6, 'rgba(245,158,11,0.06)');
  chairGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = chairGrd;
  ctx.fill();
  ctx.strokeStyle = 'rgba(245,158,11,0.5)';
  ctx.lineWidth = PX * 0.5;
  ctx.shadowColor = '#f59e0b';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── Station console (holographic panel at each agent's desk) ─────────────────
function drawStationConsole(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  color: string, PX: number,
  state: string, tick: number,
  label: string,
) {
  const cw = PX * 18, ch = PX * 8;
  const cx2 = cx - cw / 2, cy2 = cy;

  // Console base
  ctx.fillStyle = '#080f1e';
  ctx.fillRect(cx2, cy2, cw, ch);

  // Glowing border
  ctx.strokeStyle = color;
  ctx.lineWidth = PX * 0.4;
  ctx.globalAlpha = 0.6;
  ctx.shadowColor = color;
  ctx.shadowBlur = state !== 'idle' && state !== 'offline' ? 10 : 3;
  ctx.strokeRect(cx2, cy2, cw, ch);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Screen content
  if (state !== 'idle' && state !== 'offline') {
    // Animated data readout
    const lineCount = 3;
    for (let l = 0; l < lineCount; l++) {
      const active = Math.floor(tick / 5) % lineCount === l;
      const lineW = PX * (3 + (Math.sin(tick * 0.07 + l * 2.1) * 0.5 + 0.5) * 6);
      ctx.globalAlpha = active ? 0.9 : 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(cx2 + PX * 1.5, cy2 + PX * 1.5 + l * PX * 2, lineW, PX);
    }
    ctx.globalAlpha = 1;

    // Active pulse dot
    const pd = Math.sin(tick * 0.15) * 0.4 + 0.6;
    ctx.globalAlpha = pd;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx2 + cw - PX * 2, cy2 + PX * 1.5, PX * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    // Idle — dim flat line
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;
    ctx.fillRect(cx2 + PX, cy2 + ch / 2 - PX * 0.4, cw - PX * 2, PX * 0.8);
    ctx.globalAlpha = 1;
  }

  // Zone label below console
  ctx.font = `${PX * 2}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.fillText(label.toUpperCase(), cx, cy2 + ch + PX * 2.5);
  ctx.globalAlpha = 1;
}

// ─── Particle ─────────────────────────────────────────────────────────────────
interface Particle { x: number; y: number; vx: number; vy: number; life: number; color: string; size: number }

// ─── Main component ───────────────────────────────────────────────────────────
export function MythicCanvas({
  agents, zones, activeZones, focusedAgentId, onFocusAgent, memoryPulseAgentId, isDemo,
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
  const activeZonesRef = useRef(activeZones);

  focusRef.current = focusedAgentId;
  agentsRef.current = agents;
  zonesRef.current = zones;
  activeZonesRef.current = activeZones;

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
    const mx = (e.clientX - rect.left) * (canvas.width / dpr / rect.width);
    const my = (e.clientY - rect.top)  * (canvas.height / dpr / rect.height);

    for (const agent of agentsRef.current) {
      const w = stateRef.current.wander[agent.id];
      if (!w) continue;
      if (Math.hypot(mx - w.x, my - w.y) < 30) {
        onFocusAgent(focusRef.current === agent.id ? null : agent.id);
        return;
      }
    }
    onFocusAgent(null);
  }, [onFocusAgent]);

  // ── Wander update ────────────────────────────────────────────────────────────
  function updateWander(agent: CommandCenterAgent, W: number, H: number) {
    const sr = stateRef.current;

    if (!sr.wander[agent.id]) {
      // Use bridge station positions — guaranteed to be within canvas bounds
      const station = STATION_POSITIONS[agent.id] ?? { fx: 0.5, fy: 0.55 };
      const hx = station.fx * W;
      const hy = station.fy * H;
      sr.wander[agent.id] = {
        x: hx, y: hy,
        targetX: hx, targetY: hy,
        homeX: hx, homeY: hy,
        walkPhase: Math.random() * Math.PI * 2,
        facing: 1,
        wanderTimer: 180,
        isWalking: false,
      };
    }

    const w = sr.wander[agent.id];
    const isIdle = agent.currentState === 'idle' || agent.currentState === 'listening';

    if (isIdle) {
      w.wanderTimer--;
      if (w.wanderTimer <= 0) {
        const goHome = Math.random() < 0.45;
        if (goHome) {
          w.targetX = w.homeX;
          w.targetY = w.homeY;
        } else {
          // Wander within the bridge floor area only (below viewscreen, above bottom edge)
          w.targetX = W * (0.15 + Math.random() * 0.70);
          w.targetY = H * (0.50 + Math.random() * 0.32);
        }
        w.wanderTimer = Math.floor(Math.random() * 240) + 120;
      }
    } else {
      // Active — return to station
      w.targetX = w.homeX;
      w.targetY = w.homeY;
    }

    const dx = w.targetX - w.x;
    const dy = w.targetY - w.y;
    const dist = Math.hypot(dx, dy);
    const speed = isIdle ? 0.9 : 1.6;

    if (dist > 2) {
      w.x += (dx / dist) * speed;
      w.y += (dy / dist) * speed;
      w.facing = dx > 0 ? 1 : -1;
      w.isWalking = true;
      w.walkPhase += 0.09;
    } else {
      w.isWalking = false;
      w.walkPhase += 0.02;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const sr = stateRef.current;
    sr.tick++;
    const t = sr.tick;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;

    // Pixel scale — keep sprites readable but not massive
    // At 800px wide → PX=3, at 1400px → PX=4, min 2
    const PX = Math.max(2, Math.min(4, Math.round(W / 320)));

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── Bridge environment ─────────────────────────────────────────────────────
    drawBridge(ctx, W, H, PX, t);

    // ── Wander positions ───────────────────────────────────────────────────────
    agentsRef.current.forEach(agent => updateWander(agent, W, H));

    // ── Connection lines from Atlas to all agents ──────────────────────────────
    const atlasAgent = agentsRef.current.find(a => a.id === 'atlas');
    if (atlasAgent) {
      const aw = sr.wander['atlas'];
      if (aw) {
        agentsRef.current.filter(a => a.id !== 'atlas').forEach(agent => {
          const bw = sr.wander[agent.id];
          if (!bw) return;
          const isActive = agent.currentState !== 'idle' && agent.currentState !== 'offline';
          ctx.save();
          ctx.globalAlpha = isActive ? 0.30 : 0.08;
          ctx.setLineDash([PX * 2, PX * 4]);
          ctx.lineDashOffset = isActive ? -(t * 1.0) % (PX * 6) : 0;
          ctx.strokeStyle = agent.themeColor;
          ctx.lineWidth = isActive ? PX * 0.6 : PX * 0.3;
          ctx.shadowColor = agent.themeColor;
          ctx.shadowBlur = isActive ? 6 : 0;
          ctx.beginPath();
          ctx.moveTo(aw.x, aw.y);
          ctx.lineTo(bw.x, bw.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          ctx.restore();
        });
      }
    }

    // ── Station consoles (at home positions, behind agents) ───────────────────
    agentsRef.current.forEach(agent => {
      const w = sr.wander[agent.id];
      if (!w) return;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      const zone = zonesRef.current.find(z => z.id === agent.homeZone);
      const zoneLabel = zone?.label ?? agent.displayName;
      drawStationConsole(ctx, w.homeX, w.homeY + PX * 2, pal.body, PX, agent.currentState, t, zoneLabel);
    });

    // ── Zone glow rings on floor ───────────────────────────────────────────────
    zonesRef.current.forEach(zone => {
      const agent = agentsRef.current.find(a => a.homeZone === zone.id);
      const zoneExplicitlyActive = activeZonesRef.current.has(zone.id as SceneZoneId);
      const isActive = zoneExplicitlyActive || (agent && agent.currentState !== 'idle' && agent.currentState !== 'offline');
      const w = agent && sr.wander[agent.id];
      if (!w) return;

      ctx.save();
      ctx.globalAlpha = isActive ? 0.22 : 0.07;
      const grd = ctx.createRadialGradient(w.homeX, w.homeY + PX * 4, 0, w.homeX, w.homeY + PX * 4, PX * 22);
      grd.addColorStop(0, zone.accentColor);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(w.homeX, w.homeY + PX * 6, PX * 18, PX * 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // ── Agents (Y-sorted) ──────────────────────────────────────────────────────
    const focId = focusRef.current;
    const sorted = [...agentsRef.current].sort((a, b) => {
      const wa = sr.wander[a.id], wb = sr.wander[b.id];
      return (wa?.y ?? 0) - (wb?.y ?? 0);
    });

    sorted.forEach(agent => {
      const w = sr.wander[agent.id];
      if (!w) return;
      const pal = AGENT_PALETTE[agent.id] ?? DEFAULT_PAL;
      const focused = focId === agent.id;
      const dimmed = focId !== null && !focused;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.35 : 1;

      // Memory pulse ring
      if (sr.memPulseTimer > 0 && sr.memPulseAgent === agent.id) {
        const pr = PX * 10 + (1 - sr.memPulseTimer / 90) * PX * 8;
        ctx.beginPath();
        ctx.arc(w.x, w.y, pr, 0, Math.PI * 2);
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = PX * 0.75;
        ctx.shadowColor = '#93c5fd';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      drawSprite(ctx, w.x, w.y, pal, agent.currentState, w.walkPhase, w.facing, PX, focused, agent.id);

      // Name label
      ctx.font = `bold ${PX * 3}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = pal.body;
      ctx.shadowColor = pal.body;
      ctx.shadowBlur = 6;
      ctx.fillText(agent.displayName.toUpperCase(), w.x, w.y + PX * 18);
      ctx.shadowBlur = 0;

      // State label
      ctx.font = `${PX * 2.2}px "JetBrains Mono", monospace`;
      ctx.fillStyle = 'rgba(148,163,184,0.75)';
      ctx.fillText(agent.currentState, w.x, w.y + PX * 21);

      // LC/RM badge
      if (agent.localOrRemote === 'local') {
        ctx.font = `bold ${PX * 2}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#4ade80';
        ctx.fillText('LC', w.x + PX * 7, w.y - PX * 12);
      } else if (agent.localOrRemote === 'remote') {
        ctx.font = `bold ${PX * 2}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#facc15';
        ctx.fillText('RM', w.x + PX * 7, w.y - PX * 12);
      }

      ctx.restore();

      // Speech bubble
      if (agent.currentTask && (agent.currentState === 'working' || agent.currentState === 'speaking' || agent.currentState === 'thinking')) {
        const truncated = agent.currentTask.length > 22
          ? agent.currentTask.slice(0, 20) + '…'
          : agent.currentTask;
        drawBubble(ctx, w.x, w.y - PX * 16, truncated, pal.body, PX);
      }

      // Celebration sparks
      if (sr.celebrationAgent === agent.id && sr.celebrationTimer > 0 && Math.random() < 0.5 && sr.particles.length < 80) {
        for (let i = 0; i < 3; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.5 + Math.random() * 2;
          sr.particles.push({
            x: w.x, y: w.y - PX * 8,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
            life: 1, color: pal.body, size: PX * 1.5,
          });
        }
      }
    });

    // ── Particles ──────────────────────────────────────────────────────────────
    sr.particles = sr.particles.filter(pt => pt.life > 0);
    sr.particles.forEach(pt => {
      pt.life -= 0.04;
      pt.x += pt.vx; pt.y += pt.vy;
      pt.vy += 0.1; pt.vx *= 0.95;
      const sz = Math.max(1, Math.round(pt.size * pt.life));
      ctx.globalAlpha = pt.life;
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), sz, sz);
      ctx.globalAlpha = 1;
    });

    // ── Timers ─────────────────────────────────────────────────────────────────
    if (sr.celebrationTimer > 0) sr.celebrationTimer--;
    else sr.celebrationAgent = null;
    if (sr.memPulseTimer > 0) sr.memPulseTimer--;
    else sr.memPulseAgent = null;

    // ── HUD overlay ────────────────────────────────────────────────────────────
    // Scanline overlay (full screen, very subtle)
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.fillStyle = '#000000';
    for (let sy = 0; sy < H; sy += 3) {
      ctx.fillRect(0, sy, W, 1);
    }
    ctx.restore();

    // Top LCARS bar
    ctx.fillStyle = 'rgba(3,6,16,0.88)';
    ctx.fillRect(0, 0, W, H * 0.065);
    ctx.fillStyle = '#c47c2c';
    ctx.fillRect(0, H * 0.065, W, PX * 0.5);

    ctx.font = `bold ${PX * 3.5}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1eaeff';
    ctx.shadowColor = '#1eaeff';
    ctx.shadowBlur = 6;
    ctx.fillText('● KRYTHOR BRIDGE', PX * 3, H * 0.048);
    ctx.shadowBlur = 0;

    // Stardate
    const sd = `SD ${(t / 100).toFixed(1)}`;
    ctx.font = `${PX * 2.5}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,200,80,0.7)';
    ctx.fillText(sd, W * 0.5, H * 0.048);

    if (isDemo) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${PX * 3}px "JetBrains Mono", monospace`;
      ctx.fillText('DEMO MODE', W - PX * 3, H * 0.048);
    }

    const focA = agentsRef.current.find(a => a.id === focId);
    if (focA) {
      ctx.textAlign = 'right';
      ctx.fillStyle = (AGENT_PALETTE[focA.id] ?? DEFAULT_PAL).body;
      ctx.font = `bold ${PX * 3}px "JetBrains Mono", monospace`;
      ctx.fillText(`◉ ${focA.displayName.toUpperCase()}`, W - PX * 3, H * 0.048);
    }

    // Corner brackets (LCARS style)
    const bSz = PX * 6;
    ctx.strokeStyle = 'rgba(30,174,255,0.35)';
    ctx.lineWidth = PX * 0.5;
    const corners: [number, number, number, number][] = [
      [PX * 2, H * 0.075, 1, 1],
      [W - PX * 2, H * 0.075, -1, 1],
      [PX * 2, H - PX * 2, 1, -1],
      [W - PX * 2, H - PX * 2, -1, -1],
    ];
    corners.forEach(([x, y, sx, sy]) => {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * bSz); ctx.lineTo(x, y); ctx.lineTo(x + sx * bSz, y);
      ctx.stroke();
    });
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ctx: CanvasRenderingContext2D | null = null;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Reset wander home positions when canvas resizes so agents reanchor
      const newW = rect.width;
      const newH = rect.height;
      const sr = stateRef.current;
      Object.keys(sr.wander).forEach(id => {
        const station = STATION_POSITIONS[id] ?? { fx: 0.5, fy: 0.55 };
        const hx = station.fx * newW;
        const hy = station.fy * newH;
        sr.wander[id].homeX = hx;
        sr.wander[id].homeY = hy;
        // Snap to home if near it (avoid drift after resize)
        const w = sr.wander[id];
        const dist = Math.hypot(w.x - w.homeX, w.y - w.homeY);
        if (dist > newW * 0.3) {
          w.x = hx; w.y = hy;
          w.targetX = hx; w.targetY = hy;
        }
      });
      // Resize canvas — must set width/height before getting new context scale
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = false;
      }
    };

    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    function loop() {
      const c = ctx ?? canvas!.getContext('2d');
      if (c) render(canvas!, c);
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
