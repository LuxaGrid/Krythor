import React from 'react';

/**
 * SceneGrid — the mythical office background.
 *
 * Layout:
 *   Top 30%  — deep wall with sconce lights and a subtle stone texture
 *   Bottom 70% — floor with perspective grid lines (vanishing-point style)
 *
 * Furniture silhouettes are rendered here as pure CSS/SVG so agents float on top.
 */
export function SceneGrid(): React.ReactElement {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">

      {/* ── Wall ───────────────────────────────────────────────────────────── */}
      <div
        className="absolute left-0 right-0 top-0"
        style={{
          height: '32%',
          background: 'linear-gradient(180deg, #0c1018 0%, #111827 100%)',
          borderBottom: '2px solid rgba(30,174,255,0.12)',
        }}
      />

      {/* Wall stone-block texture (subtle horizontal courses) */}
      {[8, 16, 24].map(pct => (
        <div
          key={pct}
          className="absolute left-0 right-0"
          style={{
            top: `${pct}%`,
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.03) 20%, rgba(255,255,255,0.03) 80%, transparent)',
          }}
        />
      ))}

      {/* Wall sconce lights — 3 along the wall */}
      {[20, 50, 80].map((xPct, i) => (
        <g key={i}>
          {/* Sconce bracket */}
          <div
            className="absolute"
            style={{
              left: `${xPct}%`,
              top: '18%',
              transform: 'translateX(-50%)',
              width: '12px',
              height: '8px',
              background: 'rgba(245,158,11,0.15)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: '2px',
            }}
          />
          {/* Glow cone downward */}
          <div
            className="absolute"
            style={{
              left: `${xPct}%`,
              top: '22%',
              transform: 'translateX(-50%)',
              width: '40px',
              height: '28px',
              background: 'radial-gradient(ellipse at top, rgba(245,158,11,0.08) 0%, transparent 70%)',
            }}
          />
          {/* Sconce dot */}
          <div
            className="absolute rounded-full"
            style={{
              left: `${xPct}%`,
              top: '18%',
              transform: 'translateX(-50%)',
              width: '4px',
              height: '4px',
              background: '#f59e0b',
              boxShadow: '0 0 8px 4px rgba(245,158,11,0.4)',
            }}
          />
        </g>
      ))}

      {/* ── Floor ──────────────────────────────────────────────────────────── */}
      <div
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: '32%',
          background: 'linear-gradient(180deg, #0d1220 0%, #0a0e18 100%)',
        }}
      />

      {/* Floor perspective grid — horizontal lines (receding) */}
      {[0, 1, 2, 3, 4, 5, 6].map(i => {
        const pct = 32 + (i / 6) * 68; // distribute from wall-line to bottom
        const opacity = 0.04 + i * 0.02;
        return (
          <div
            key={`h-${i}`}
            className="absolute left-0 right-0"
            style={{
              top: `${pct}%`,
              height: '1px',
              background: `rgba(30,174,255,${opacity})`,
            }}
          />
        );
      })}

      {/* Floor vertical grid lines (perspective — wider at bottom) */}
      {[-3, -2, -1, 0, 1, 2, 3].map(i => {
        const vanishX = 50; // vanishing point %
        const spreadBottom = 16 * i; // spread at bottom
        return (
          <svg
            key={`v-${i}`}
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <line
              x1={vanishX}
              y1={32}
              x2={vanishX + spreadBottom}
              y2={100}
              stroke="rgba(30,174,255,0.05)"
              strokeWidth="0.15"
            />
          </svg>
        );
      })}

      {/* ── Furniture silhouettes ────────────────────────────────────────── */}

      {/* Bookshelf — far right wall */}
      <div
        className="absolute"
        style={{ right: '2%', top: '8%', width: '5%', height: '22%' }}
      >
        <div style={{ width: '100%', height: '100%', background: 'rgba(90,58,26,0.35)', border: '1px solid rgba(90,58,26,0.5)', borderRadius: '2px', display: 'flex', flexDirection: 'column', gap: '3px', padding: '3px' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', gap: '2px' }}>
              <div style={{ flex: 1, background: `rgba(${[96,74,120,180][i] ?? 96},${[60,120,80,60][i] ?? 60},${[100,60,60,200][i] ?? 100},0.5)`, borderRadius: '1px' }} />
              <div style={{ flex: 1.3, background: `rgba(${[74,96,180,60][i] ?? 74},${[120,60,60,120][i] ?? 120},${[60,100,80,100][i] ?? 60},0.5)`, borderRadius: '1px' }} />
              <div style={{ flex: 0.8, background: `rgba(${[180,60,96,120][i] ?? 180},${[60,180,74,60][i] ?? 60},${[60,60,120,96][i] ?? 60},0.5)`, borderRadius: '1px' }} />
            </div>
          ))}
        </div>
        <div className="text-center mt-0.5" style={{ fontSize: '7px', color: 'rgba(90,58,26,0.7)', fontFamily: 'monospace', letterSpacing: '0.1em' }}>ARCHIVE</div>
      </div>

      {/* Water cooler — left wall */}
      <div
        className="absolute"
        style={{ left: '3%', top: '14%', width: '3%' }}
      >
        {/* Body */}
        <div style={{ height: '40px', background: 'rgba(136,170,204,0.3)', border: '1px solid rgba(136,170,204,0.4)', borderRadius: '2px 2px 1px 1px', position: 'relative' }}>
          {/* Water bottle top */}
          <div style={{ position: 'absolute', top: '-8px', left: '25%', width: '50%', height: '10px', background: 'rgba(68,170,255,0.3)', border: '1px solid rgba(68,170,255,0.4)', borderRadius: '2px 2px 0 0' }} />
          {/* Spigot */}
          <div style={{ position: 'absolute', bottom: '8px', left: '20%', width: '60%', height: '4px', background: 'rgba(100,140,180,0.4)', borderRadius: '1px' }} />
        </div>
        <div style={{ fontSize: '6px', color: 'rgba(68,170,255,0.5)', fontFamily: 'monospace', textAlign: 'center', marginTop: '2px' }}>H₂O</div>
      </div>

      {/* Server rack — bottom left area */}
      <div
        className="absolute"
        style={{ left: '4%', bottom: '8%', width: '4%', height: '18%' }}
      >
        <div style={{ width: '100%', height: '100%', background: 'rgba(26,30,46,0.8)', border: '1px solid rgba(30,174,255,0.2)', borderRadius: '2px', display: 'flex', flexDirection: 'column', gap: '2px', padding: '2px' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ flex: 1, background: 'rgba(30,174,255,0.08)', border: '1px solid rgba(30,174,255,0.12)', borderRadius: '1px', display: 'flex', alignItems: 'center', paddingLeft: '2px', gap: '1px' }}>
              <div style={{ width: '3px', height: '3px', borderRadius: '50%', background: i % 2 === 0 ? '#4ade80' : '#1eaeff', boxShadow: `0 0 3px ${i % 2 === 0 ? '#4ade80' : '#1eaeff'}` }} />
            </div>
          ))}
        </div>
        <div style={{ fontSize: '6px', color: 'rgba(30,174,255,0.4)', fontFamily: 'monospace', textAlign: 'center', marginTop: '2px' }}>SRV</div>
      </div>

      {/* Coffee machine — bottom right corner */}
      <div
        className="absolute"
        style={{ right: '3%', bottom: '6%', width: '4%' }}
      >
        <div style={{ height: '36px', background: 'rgba(50,50,50,0.6)', border: '1px solid rgba(100,100,100,0.3)', borderRadius: '2px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'rgba(255,68,34,0.6)', boxShadow: '0 0 4px rgba(255,68,34,0.5)' }} />
          {/* Steam */}
          <div style={{ position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)', fontSize: '8px', color: 'rgba(200,200,200,0.3)' }}>≋</div>
        </div>
        <div style={{ fontSize: '6px', color: 'rgba(150,100,50,0.5)', fontFamily: 'monospace', textAlign: 'center', marginTop: '2px' }}>BREW</div>
      </div>

      {/* Round table — center bottom area (huddle spot) */}
      <div
        className="absolute"
        style={{ left: '50%', bottom: '5%', transform: 'translateX(-50%)', width: '10%' }}
      >
        <div style={{ height: '8px', background: 'rgba(90,74,58,0.5)', border: '1px solid rgba(90,74,58,0.6)', borderRadius: '50%', boxShadow: '0 0 12px rgba(245,158,11,0.04)' }} />
        <div style={{ fontSize: '6px', color: 'rgba(90,74,58,0.6)', fontFamily: 'monospace', textAlign: 'center', marginTop: '1px', letterSpacing: '0.1em' }}>LOUNGE</div>
      </div>

      {/* Whiteboard — on the wall, center-left */}
      <div
        className="absolute"
        style={{ left: '28%', top: '4%', width: '18%', height: '14%' }}
      >
        <div style={{ width: '100%', height: '100%', background: 'rgba(30,35,50,0.8)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '2px', padding: '3px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <div style={{ fontSize: '5px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', textTransform: 'uppercase' }}>IDLE</div>
              <div style={{ width: '60%', height: '2px', background: 'rgba(245,158,11,0.3)', borderRadius: '1px' }} />
            </div>
            <div style={{ flex: 1, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <div style={{ fontSize: '5px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', textTransform: 'uppercase' }}>DOING</div>
              <div style={{ width: '80%', height: '2px', background: 'rgba(30,174,255,0.4)', borderRadius: '1px' }} />
              <div style={{ width: '50%', height: '2px', background: 'rgba(129,140,248,0.3)', borderRadius: '1px' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1px' }}>
              <div style={{ fontSize: '5px', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', textTransform: 'uppercase' }}>DONE</div>
              <div style={{ width: '70%', height: '2px', background: 'rgba(74,222,128,0.3)', borderRadius: '1px' }} />
            </div>
          </div>
        </div>
        <div style={{ fontSize: '6px', color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', textAlign: 'center', marginTop: '2px', letterSpacing: '0.1em' }}>MISSION BOARD</div>
      </div>

      {/* Plants — corner decorations */}
      {/* Left plant */}
      <div className="absolute" style={{ left: '10%', top: '22%', fontSize: '18px', opacity: 0.4, lineHeight: 1 }}>🌿</div>
      {/* Right plant */}
      <div className="absolute" style={{ right: '10%', top: '22%', fontSize: '18px', opacity: 0.4, lineHeight: 1, transform: 'scaleX(-1)' }}>🌿</div>

      {/* Vignette overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.5) 100%)',
        }}
      />
    </div>
  );
}
