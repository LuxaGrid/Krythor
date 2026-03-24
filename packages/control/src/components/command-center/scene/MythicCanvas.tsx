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

// ─── Archetype metadata ────────────────────────────────────────────────────────
// Drives unique silhouette features per agent
type Archetype = 'titan' | 'water' | 'mage' | 'wraith' | 'fire';
const AGENT_ARCHETYPE: Record<string, Archetype> = {
  atlas:    'titan',
  voltaris: 'water',
  aethon:   'mage',
  thyros:   'wraith',
  pyron:    'fire',
};

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
  agentId: string,
) {
  const working   = state === 'working';
  const thinking  = state === 'thinking';
  const speaking  = state === 'speaking';
  const offline   = state === 'offline';
  const handoff   = state === 'handoff';
  void state; // listening/handoff used per-archetype branch
  const archetype = AGENT_ARCHETYPE[agentId] ?? 'titan';

  const bob      = Math.abs(Math.sin(walkPhase * 3)) * PX * 0.5;
  const legSwing = Math.sin(walkPhase * 6);
  const breathe  = Math.sin(walkPhase * 2) * PX * 0.3; // gentle ethereal float

  // Sprite anchor
  const bx = cx - 4 * PX;
  const by = cy - 16 * PX - bob - (archetype === 'wraith' ? breathe : 0);

  ctx.save();
  if (facing === -1) {
    ctx.scale(-1, 1);
    ctx.translate(-cx * 2, 0);
  }
  if (offline) ctx.globalAlpha = 0.22;

  // ── Aura / ambient glow beneath figure ────────────────────────────────────
  if (!offline) {
    ctx.save();
    const auraIntensity = (working || speaking) ? 0.22 : thinking ? 0.14 : 0.08;
    const auraGrd = ctx.createRadialGradient(cx, cy, 0, cx, cy, PX * 10);
    auraGrd.addColorStop(0, pal.body);
    auraGrd.addColorStop(1, 'transparent');
    ctx.globalAlpha = auraIntensity;
    ctx.fillStyle = auraGrd;
    ctx.beginPath();
    ctx.ellipse(cx, cy - PX * 2, PX * 9, PX * 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── ATLAS — TITAN / ORACLE ────────────────────────────────────────────────
  // Golden armored giant with crown horns and a glowing third eye
  if (archetype === 'titan') {
    // Crown horns
    ctx.save();
    ctx.fillStyle = pal.accent;
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = PX * 3;
    // Left horn
    ctx.beginPath();
    ctx.moveTo(bx + PX, by);
    ctx.lineTo(bx, by - PX * 3);
    ctx.lineTo(bx + PX * 2, by - PX);
    ctx.fill();
    // Right horn
    ctx.beginPath();
    ctx.moveTo(bx + PX * 6, by);
    ctx.lineTo(bx + PX * 8, by - PX * 3);
    ctx.lineTo(bx + PX * 5, by - PX);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Head — bronzed titan skin
    p(ctx, bx + PX, by, 6 * PX, 6 * PX, pal.skin);
    p(ctx, bx, by + PX, PX, PX * 4, pal.skin); // left cheek
    p(ctx, bx + 7 * PX, by + PX, PX, PX * 4, pal.skin); // right cheek
    // Brow ridge
    p(ctx, bx + PX, by, 6 * PX, PX, '#b45309');
    // Eyes — glowing gold
    ctx.save();
    ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 3;
    p(ctx, bx + 2 * PX, by + PX * 2, PX * 1.5, PX, pal.accent);
    p(ctx, bx + 5 * PX, by + PX * 2, PX * 1.5, PX, pal.accent);
    ctx.shadowBlur = 0; ctx.restore();
    // Third eye — center forehead
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, by + PX, PX * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#fde68a'; ctx.shadowBlur = PX * 5;
    ctx.fill(); ctx.shadowBlur = 0; ctx.restore();
    // Jaw
    p(ctx, bx + PX * 2, by + PX * 5, PX * 4, PX, '#b45309');

    // Armored torso — golden plate
    const bodyY = by + 6 * PX;
    p(ctx, bx, bodyY, 8 * PX, 6 * PX, pal.body);
    // Plate highlights
    p(ctx, bx + PX, bodyY, 6 * PX, PX, '#fde68a', 0.6);
    p(ctx, bx + PX * 3, bodyY + PX, 2 * PX, PX * 4, '#fde68a', 0.25);
    // Shoulder pauldrons
    p(ctx, bx - PX, bodyY, PX * 2, PX * 2, pal.accent);
    p(ctx, bx + 7 * PX, bodyY, PX * 2, PX * 2, pal.accent);

    // Arms — armored gauntlets
    const armSwing = working ? Math.sin(walkPhase * 8) * PX : handoff ? -PX * 2 : 0;
    p(ctx, bx - PX, bodyY + PX + armSwing, PX, PX * 3, pal.body);
    p(ctx, bx + 8 * PX, bodyY + PX - armSwing, PX, PX * 3, pal.body);
    // Gauntlet cuffs
    p(ctx, bx - PX, bodyY + PX * 3 + armSwing, PX, PX, pal.accent);
    p(ctx, bx + 8 * PX, bodyY + PX * 3 - armSwing, PX, PX, pal.accent);

    // Legs — golden greaves
    const legY = bodyY + 6 * PX;
    p(ctx, bx + PX, legY, 6 * PX, PX * 2, pal.body);
    const lLx = bx + PX + legSwing * PX * 0.8;
    p(ctx, lLx, legY + 2 * PX, 2 * PX, 3 * PX, pal.body);
    p(ctx, lLx - PX * 0.5, legY + 5 * PX, 3 * PX, PX, '#b45309');
    const rLx = bx + 5 * PX - legSwing * PX * 0.8;
    p(ctx, rLx, legY + 2 * PX, 2 * PX, 3 * PX, pal.body);
    p(ctx, rLx - PX * 0.5, legY + 5 * PX, 3 * PX, PX, '#b45309');

  // ─── VOLTARIS — WATER ELEMENTAL ────────────────────────────────────────────
  // Translucent teal being — fluid, no solid edges, wave crest head
  } else if (archetype === 'water') {
    const wave = Math.sin(walkPhase * 4) * PX * 0.5;
    // Wave crest crown
    ctx.save();
    ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 4;
    for (let w = 0; w < 4; w++) {
      ctx.beginPath();
      ctx.arc(bx + PX * (1.5 + w * 1.5), by - PX * (1 + (w % 2) * 1.5) + wave, PX * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.restore();

    // Fluid head — semi-transparent
    ctx.save(); ctx.globalAlpha = 0.75;
    p(ctx, bx + PX, by, 6 * PX, 6 * PX, pal.body);
    p(ctx, bx, by + PX, PX, PX * 4, pal.body);
    p(ctx, bx + 7 * PX, by + PX, PX, PX * 4, pal.body);
    ctx.restore();
    // Inner glow core
    ctx.save();
    const coreGrd = ctx.createRadialGradient(cx, by + PX * 3, 0, cx, by + PX * 3, PX * 3);
    coreGrd.addColorStop(0, pal.accent); coreGrd.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.5; ctx.fillStyle = coreGrd;
    ctx.beginPath(); ctx.ellipse(cx, by + PX * 3, PX * 3, PX * 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Eyes — deep swirling voids
    p(ctx, bx + 2 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#0e7490');
    p(ctx, bx + 5 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#0e7490');
    ctx.save(); ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 2;
    p(ctx, bx + 2 * PX, by + PX * 2, PX, PX, pal.accent);
    p(ctx, bx + 5 * PX, by + PX * 2, PX, PX, pal.accent);
    ctx.shadowBlur = 0; ctx.restore();

    // Fluid body
    const bodyY = by + 6 * PX;
    ctx.save(); ctx.globalAlpha = 0.65;
    p(ctx, bx, bodyY, 8 * PX, 6 * PX, pal.body);
    ctx.restore();
    // Wave ripples across torso
    ctx.save(); ctx.strokeStyle = pal.accent; ctx.lineWidth = PX * 0.5; ctx.globalAlpha = 0.5;
    ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 2;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.moveTo(bx + PX, bodyY + PX * (1.5 + r * 1.5) + wave * (r % 2 === 0 ? 1 : -1));
      ctx.lineTo(bx + 7 * PX, bodyY + PX * (1.5 + r * 1.5) - wave * (r % 2 === 0 ? 1 : -1));
      ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.restore();

    // Fluid arms
    const armSwing = working ? Math.sin(walkPhase * 8) * PX : 0;
    ctx.save(); ctx.globalAlpha = 0.6;
    p(ctx, bx - PX, bodyY + PX + armSwing, PX, PX * 3, pal.body);
    p(ctx, bx + 8 * PX, bodyY + PX - armSwing, PX, PX * 3, pal.body);
    ctx.restore();

    // Flowing lower body (no distinct legs — dissolves)
    ctx.save();
    for (let d = 0; d < 4; d++) {
      ctx.globalAlpha = 0.5 - d * 0.1;
      p(ctx, bx + PX + d * PX * 0.3, bodyY + 6 * PX + d * PX, 6 * PX - d * PX * 0.6, PX, pal.body);
    }
    ctx.restore();

  // ─── AETHON — ARCANE MAGE ──────────────────────────────────────────────────
  // Purple robed scholar — tall pointed hat, star runes, staff hand
  } else if (archetype === 'mage') {
    // Pointed wizard/arcane hat
    ctx.save();
    ctx.fillStyle = '#4c1d95'; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 2;
    ctx.beginPath();
    ctx.moveTo(cx, by - PX * 5);
    ctx.lineTo(bx + PX * 0.5, by);
    ctx.lineTo(bx + PX * 7.5, by);
    ctx.closePath(); ctx.fill();
    // Hat brim
    p(ctx, bx - PX * 0.5, by, PX * 9, PX, '#6d28d9');
    // Star on hat
    ctx.fillStyle = pal.accent; ctx.shadowBlur = PX * 4;
    ctx.beginPath(); ctx.arc(cx, by - PX * 3, PX * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.restore();

    // Head — pale arcane skin
    p(ctx, bx + PX, by, 6 * PX, 6 * PX, pal.skin);
    p(ctx, bx, by + PX, PX, PX * 4, pal.skin);
    p(ctx, bx + 7 * PX, by + PX, PX, PX * 4, pal.skin);
    // Eyes — glowing arcane violet
    ctx.save(); ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 3;
    p(ctx, bx + 2 * PX, by + PX * 2, PX * 1.5, PX * 1.5, pal.accent);
    p(ctx, bx + 5 * PX, by + PX * 2, PX * 1.5, PX * 1.5, pal.accent);
    ctx.shadowBlur = 0; ctx.restore();
    // Beard / rune markings
    p(ctx, bx + PX * 2, by + PX * 5, PX * 4, PX, '#6d28d9', 0.6);
    // Arcane rune on cheek
    ctx.save(); ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 2;
    p(ctx, bx + PX, by + PX * 3, PX * 0.5, PX * 2, pal.accent, 0.7);
    ctx.shadowBlur = 0; ctx.restore();

    // Robed torso
    const bodyY = by + 6 * PX;
    p(ctx, bx, bodyY, 8 * PX, 6 * PX, '#3b0764');
    // Robe highlights
    p(ctx, bx + PX, bodyY, 6 * PX, PX, '#6d28d9', 0.5);
    p(ctx, bx + PX * 3, bodyY + PX, 2 * PX, PX * 5, '#6d28d9', 0.2);
    // Arcane sigil on chest
    ctx.save();
    ctx.strokeStyle = pal.accent; ctx.lineWidth = PX * 0.4;
    ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 3;
    ctx.beginPath(); ctx.arc(cx, bodyY + PX * 2.5, PX * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, bodyY + PX); ctx.lineTo(cx, bodyY + PX * 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - PX * 1.5, bodyY + PX * 2.5); ctx.lineTo(cx + PX * 1.5, bodyY + PX * 2.5); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();

    // Arms — robed sleeves
    const armSwing = working ? Math.sin(walkPhase * 8) * PX : handoff ? -PX * 2 : 0;
    p(ctx, bx - PX, bodyY + PX + armSwing, PX * 1.5, PX * 3, '#3b0764');
    p(ctx, bx + 7 * PX, bodyY + PX - armSwing, PX * 1.5, PX * 3, '#3b0764');
    // Staff hand (right) when working/thinking
    if (working || thinking) {
      ctx.save(); ctx.strokeStyle = pal.accent; ctx.lineWidth = PX * 0.5;
      ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 4;
      ctx.beginPath();
      ctx.moveTo(bx + 9 * PX, bodyY + PX - armSwing);
      ctx.lineTo(bx + 9 * PX, by - PX * 2);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(bx + 9 * PX, by - PX * 2, PX, 0, Math.PI * 2);
      ctx.fillStyle = pal.accent; ctx.fill();
      ctx.shadowBlur = 0; ctx.restore();
    }

    // Robed legs
    const legY = bodyY + 6 * PX;
    p(ctx, bx + PX, legY, 6 * PX, PX * 2, '#3b0764');
    const lLx = bx + PX + legSwing * PX * 0.5;
    p(ctx, lLx, legY + 2 * PX, 2 * PX, 3 * PX, '#3b0764');
    const rLx = bx + 5 * PX - legSwing * PX * 0.5;
    p(ctx, rLx, legY + 2 * PX, 2 * PX, 3 * PX, '#3b0764');

  // ─── THYROS — FROST WRAITH ─────────────────────────────────────────────────
  // Ice-blue spectral ghost — jagged crown, translucent, trailing wisps
  } else if (archetype === 'wraith') {
    const shimmer = Math.sin(walkPhase * 5) * 0.15;
    ctx.save(); ctx.globalAlpha = 0.82 + shimmer;

    // Jagged ice crown
    ctx.fillStyle = pal.accent; ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 5;
    for (let sp = 0; sp < 5; sp++) {
      const spH = sp % 2 === 0 ? PX * 3 : PX * 1.5;
      ctx.beginPath();
      ctx.moveTo(bx + PX * (sp * 1.4 + 0.5), by);
      ctx.lineTo(bx + PX * (sp * 1.4 + 1), by - spH);
      ctx.lineTo(bx + PX * (sp * 1.4 + 1.5), by);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Head — pale spectral face
    p(ctx, bx + PX, by, 6 * PX, 6 * PX, '#dbeafe');
    p(ctx, bx, by + PX, PX, PX * 4, '#dbeafe');
    p(ctx, bx + 7 * PX, by + PX, PX, PX * 4, '#dbeafe');
    // Hollow eye sockets — deep blue voids
    p(ctx, bx + 2 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#1e3a8a');
    p(ctx, bx + 5 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#1e3a8a');
    // Soul glow in sockets
    ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 4;
    p(ctx, bx + 2 * PX, by + PX * 2, PX, PX, pal.accent);
    p(ctx, bx + 5 * PX, by + PX * 2, PX, PX, pal.accent);
    ctx.shadowBlur = 0;
    // Gaunt mouth
    p(ctx, bx + PX * 2, by + PX * 4, PX * 4, PX * 0.5, '#93c5fd', 0.7);

    // Spectral robe
    const bodyY = by + 6 * PX;
    p(ctx, bx, bodyY, 8 * PX, 6 * PX, '#1e3a8a', 0.75);
    // Ice crystal veins
    ctx.strokeStyle = pal.accent; ctx.lineWidth = PX * 0.4;
    ctx.shadowColor = pal.accent; ctx.shadowBlur = PX * 2;
    ctx.beginPath(); ctx.moveTo(cx, bodyY); ctx.lineTo(cx - PX, bodyY + PX * 3); ctx.lineTo(cx + PX, bodyY + PX * 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, bodyY); ctx.lineTo(cx + PX, bodyY + PX * 3); ctx.lineTo(cx - PX, bodyY + PX * 5); ctx.stroke();
    ctx.shadowBlur = 0;

    // Spectral arms — wispy, no hands
    const armSwing = working ? Math.sin(walkPhase * 8) * PX : 0;
    p(ctx, bx - PX, bodyY + PX + armSwing, PX, PX * 3, '#3b82f6', 0.55);
    p(ctx, bx + 8 * PX, bodyY + PX - armSwing, PX, PX * 3, '#3b82f6', 0.55);

    // Wispy lower body — fades into nothing
    for (let d = 0; d < 5; d++) {
      ctx.globalAlpha = (0.65 - d * 0.12) + shimmer;
      p(ctx, bx + PX + d * PX * 0.3, bodyY + 6 * PX + d * PX, 6 * PX - d * PX * 0.6, PX, '#3b82f6');
    }
    ctx.restore();

  // ─── PYRON — FIRE ELEMENTAL ────────────────────────────────────────────────
  // Red/orange blazing warrior — flame crown, ember skin, burning outline
  } else {
    const flicker = Math.sin(walkPhase * 7) * PX * 0.4;

    // Flame crown — animated spikes
    ctx.save(); ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = PX * 5;
    const flameColors = ['#fbbf24', '#f97316', '#dc2626'];
    for (let fl = 0; fl < 5; fl++) {
      ctx.fillStyle = flameColors[fl % 3];
      const fh = PX * (2 + (fl % 3)) + (fl % 2 === 0 ? flicker : -flicker);
      ctx.beginPath();
      ctx.moveTo(bx + PX * (fl * 1.5 + 0.5), by);
      ctx.lineTo(bx + PX * (fl * 1.5 + 1), by - fh);
      ctx.lineTo(bx + PX * (fl * 1.5 + 1.8), by);
      ctx.fill();
    }
    ctx.shadowBlur = 0; ctx.restore();

    // Head — ember-dark skin with heat cracks
    p(ctx, bx + PX, by, 6 * PX, 6 * PX, '#7f1d1d');
    p(ctx, bx, by + PX, PX, PX * 4, '#7f1d1d');
    p(ctx, bx + 7 * PX, by + PX, PX, PX * 4, '#7f1d1d');
    // Lava cracks
    ctx.save(); ctx.strokeStyle = '#f97316'; ctx.lineWidth = PX * 0.4;
    ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = PX * 3;
    ctx.beginPath(); ctx.moveTo(bx + PX * 2, by); ctx.lineTo(bx + PX * 3, by + PX * 3); ctx.lineTo(bx + PX * 2, by + PX * 5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + PX * 6, by); ctx.lineTo(bx + PX * 5, by + PX * 2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
    // Burning eyes
    ctx.save(); ctx.fillStyle = '#fbbf24'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = PX * 5;
    p(ctx, bx + 2 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#fbbf24');
    p(ctx, bx + 5 * PX, by + PX * 2, PX * 1.5, PX * 1.5, '#fbbf24');
    ctx.shadowBlur = 0; ctx.restore();

    // Blazing torso
    const bodyY = by + 6 * PX;
    p(ctx, bx, bodyY, 8 * PX, 6 * PX, '#7f1d1d');
    // Magma core
    ctx.save();
    const magmaGrd = ctx.createRadialGradient(cx, bodyY + PX * 3, 0, cx, bodyY + PX * 3, PX * 3);
    magmaGrd.addColorStop(0, '#fbbf24'); magmaGrd.addColorStop(0.4, '#f97316'); magmaGrd.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.5 + Math.sin(walkPhase * 6) * 0.15;
    ctx.fillStyle = magmaGrd;
    ctx.beginPath(); ctx.ellipse(cx, bodyY + PX * 3, PX * 3, PX * 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Flame fringe on shoulders
    ctx.save(); ctx.fillStyle = '#f97316'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = PX * 4;
    p(ctx, bx - PX, bodyY + flicker, PX, PX * 2, '#f97316');
    p(ctx, bx + 8 * PX, bodyY - flicker, PX, PX * 2, '#f97316');
    ctx.shadowBlur = 0; ctx.restore();

    // Arms — ember-charred
    const armSwing = working ? Math.sin(walkPhase * 8) * PX : handoff ? -PX * 2 : 0;
    p(ctx, bx - PX, bodyY + PX + armSwing, PX, PX * 3, '#92400e');
    p(ctx, bx + 8 * PX, bodyY + PX - armSwing, PX, PX * 3, '#92400e');
    // Flame hands
    ctx.save(); ctx.fillStyle = '#f97316'; ctx.shadowColor = '#fbbf24'; ctx.shadowBlur = PX * 3;
    p(ctx, bx - PX, bodyY + PX * 3.5 + armSwing, PX, PX, '#f97316');
    p(ctx, bx + 8 * PX, bodyY + PX * 3.5 - armSwing, PX, PX, '#fbbf24');
    ctx.shadowBlur = 0; ctx.restore();

    // Legs — scorched stone
    const legY = bodyY + 6 * PX;
    p(ctx, bx + PX, legY, 6 * PX, PX * 2, '#92400e');
    const lLx = bx + PX + legSwing * PX * 0.8;
    p(ctx, lLx, legY + 2 * PX, 2 * PX, 3 * PX, '#7f1d1d');
    p(ctx, lLx - PX * 0.5, legY + 5 * PX, 3 * PX, PX, '#44403c');
    const rLx = bx + 5 * PX - legSwing * PX * 0.8;
    p(ctx, rLx, legY + 2 * PX, 2 * PX, 3 * PX, '#7f1d1d');
    p(ctx, rLx - PX * 0.5, legY + 5 * PX, 3 * PX, PX, '#44403c');
  }

  // ── Focus glow ────────────────────────────────────────────────────────────
  if (focused) {
    ctx.save();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = PX * 0.5;
    ctx.shadowColor = pal.accent;
    ctx.shadowBlur = 16;
    ctx.strokeRect(bx - PX, by - PX * 6, 10 * PX, 24 * PX);
    ctx.shadowBlur = 28;
    ctx.globalAlpha = 0.15;
    ctx.strokeRect(bx - PX * 2, by - PX * 7, 12 * PX, 27 * PX);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── State dot ─────────────────────────────────────────────────────────────
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

  // Planet / nebula in viewscreen
  const nebX = vsX + vsW * 0.5, nebY = vsY + vsH * 0.5;
  const nebGrd = ctx.createRadialGradient(nebX, nebY, 0, nebX, nebY, vsW * 0.28);
  nebGrd.addColorStop(0, 'rgba(30,100,180,0.18)');
  nebGrd.addColorStop(0.5, 'rgba(80,30,140,0.10)');
  nebGrd.addColorStop(1, 'transparent');
  ctx.fillStyle = nebGrd;
  ctx.beginPath();
  ctx.ellipse(nebX, nebY, vsW * 0.28, vsH * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // Planet sphere
  const pGrd = ctx.createRadialGradient(nebX - vsW * 0.04, nebY - vsH * 0.08, 0, nebX, nebY, vsW * 0.09);
  pGrd.addColorStop(0, '#4fb3e8');
  pGrd.addColorStop(0.4, '#1a5fa0');
  pGrd.addColorStop(1, '#0a1e3a');
  ctx.fillStyle = pGrd;
  ctx.beginPath();
  ctx.arc(nebX, nebY, vsW * 0.09, 0, Math.PI * 2);
  ctx.fill();

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
