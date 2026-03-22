import React from 'react';
import type { CommandCenterAgent } from '../types';

interface HandoffArcProps {
  from: CommandCenterAgent;
  to: CommandCenterAgent;
  color: string;
  sceneWidth: number;
  sceneHeight: number;
}

export function HandoffArc({ from, to, color, sceneWidth, sceneHeight }: HandoffArcProps): React.ReactElement {
  const x1 = (from.position.x / 100) * sceneWidth;
  const y1 = (from.position.y / 100) * sceneHeight;
  const x2 = (to.position.x / 100) * sceneWidth;
  const y2 = (to.position.y / 100) * sceneHeight;

  // Control point — arc above midpoint
  const mx = (x1 + x2) / 2;
  const my = Math.min(y1, y2) - 40;

  const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
  const pathLen = 200; // approximate

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={sceneWidth}
      height={sceneHeight}
      style={{ zIndex: 15 }}
    >
      <defs>
        <filter id="arc-glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Ghost trail */}
      <path d={d} fill="none" stroke={color} strokeWidth="1" opacity="0.15" />
      {/* Animated dash */}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.8"
        strokeDasharray={`${pathLen * 0.15} ${pathLen}`}
        filter="url(#arc-glow)"
        style={{
          animation: 'cc-flow-arc 1s linear infinite',
          strokeDashoffset: pathLen,
        }}
      />
      {/* Arrowhead at destination */}
      <circle cx={x2} cy={y2} r="3" fill={color} opacity="0.9" />
    </svg>
  );
}
