import React from 'react';

export function SceneGrid(): React.ReactElement {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Deep void background */}
      <div className="absolute inset-0" style={{ background: 'var(--cc-scene-bg)' }} />

      {/* Subtle dot grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(30,174,255,0.12) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />

      {/* Vignette overlay */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(9,9,11,0.7) 100%)',
        }}
      />

      {/* Horizontal scan line accent — subtle */}
      <div
        className="absolute left-0 right-0"
        style={{
          top: '33%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(30,174,255,0.06) 20%, rgba(30,174,255,0.06) 80%, transparent)',
        }}
      />
      <div
        className="absolute left-0 right-0"
        style={{
          top: '66%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(30,174,255,0.04) 20%, rgba(30,174,255,0.04) 80%, transparent)',
        }}
      />
    </div>
  );
}
