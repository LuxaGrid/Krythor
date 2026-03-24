import React from 'react';

/**
 * SceneGrid — Dark deep-space command network background.
 *
 * Matches image 4 aesthetic:
 *   - Near-black void with faint blue radial atmospheric glow (Atlas-centric)
 *   - Subtle perspective grid lines (very faint, receding)
 *   - No furniture — pure sci-fi network topology
 *   - Vignette border for depth
 */
export function SceneGrid(): React.ReactElement {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">

      {/* ── Base void ───────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(160deg, #070a12 0%, #080b14 50%, #06090f 100%)' }}
      />

      {/* ── Atlas ambient aura — warm amber glow at top-center ─────────── */}
      <div
        className="absolute"
        style={{
          left: '50%',
          top: '30%',
          transform: 'translate(-50%, -50%)',
          width: '55%',
          height: '55%',
          background: 'radial-gradient(ellipse at center, rgba(245,158,11,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* ── Blue atmosphere — overall cool tint ────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(30,174,255,0.04) 0%, transparent 65%)',
        }}
      />

      {/* ── Perspective grid — horizontal scan lines ────────────────────── */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ opacity: 0.18 }}
      >
        {/* Horizontal lines — denser near bottom (receding floor) */}
        {[20, 35, 48, 58, 66, 73, 79, 84, 89, 93, 97].map((y, i) => (
          <line
            key={`h-${i}`}
            x1="0" y1={y} x2="100" y2={y}
            stroke="rgba(30,174,255,0.6)"
            strokeWidth={i < 3 ? '0.08' : '0.12'}
          />
        ))}

        {/* Vertical perspective lines — converging toward top-center vanishing point */}
        {[-60, -30, -10, 0, 10, 30, 60].map((offset, i) => (
          <line
            key={`v-${i}`}
            x1={50 + offset * 0.3}
            y1={15}
            x2={50 + offset}
            y2={100}
            stroke="rgba(30,174,255,0.35)"
            strokeWidth="0.08"
          />
        ))}
      </svg>

      {/* ── Corner scan-line indicators (HUD feel) ─────────────────────── */}
      {/* Top-left */}
      <div className="absolute" style={{ top: 10, left: 10 }}>
        <div style={{ width: 16, height: 1, background: 'rgba(30,174,255,0.3)' }} />
        <div style={{ width: 1, height: 16, background: 'rgba(30,174,255,0.3)', marginTop: -1 }} />
      </div>
      {/* Top-right */}
      <div className="absolute" style={{ top: 10, right: 10 }}>
        <div style={{ width: 16, height: 1, background: 'rgba(30,174,255,0.3)', marginLeft: 'auto' }} />
        <div style={{ width: 1, height: 16, background: 'rgba(30,174,255,0.3)', marginLeft: 'auto', marginTop: -1 }} />
      </div>
      {/* Bottom-left */}
      <div className="absolute" style={{ bottom: 10, left: 10 }}>
        <div style={{ width: 1, height: 16, background: 'rgba(30,174,255,0.3)' }} />
        <div style={{ width: 16, height: 1, background: 'rgba(30,174,255,0.3)', marginTop: -1 }} />
      </div>
      {/* Bottom-right */}
      <div className="absolute" style={{ bottom: 10, right: 10 }}>
        <div style={{ width: 1, height: 16, background: 'rgba(30,174,255,0.3)', marginLeft: 'auto' }} />
        <div style={{ width: 16, height: 1, background: 'rgba(30,174,255,0.3)', marginTop: -1, marginLeft: 'auto' }} />
      </div>

      {/* ── Vignette ───────────────────────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%)',
        }}
      />
    </div>
  );
}
