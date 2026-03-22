import React from 'react';
import type { AgentRole } from '../types';

interface AgentGlyphProps {
  role: AgentRole;
  color: string;
  animState: string;
}

export function AgentGlyph({ role, color, animState }: AgentGlyphProps): React.ReactElement {
  // Inner symbol per role — all original geometric designs
  const glyphs: Record<AgentRole, React.ReactElement> = {
    orchestrator: (
      // Crown / star — central authority
      <g>
        <polygon points="12,3 14.5,9 21,9 15.5,13.5 17.5,20 12,16 6.5,20 8.5,13.5 3,9 9.5,9"
          fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.5" fill={color} opacity="0.8" />
      </g>
    ),
    builder: (
      // Interlocked triangles — construction / forge
      <g>
        <polygon points="12,4 20,18 4,18" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
        <polygon points="12,20 4,6 20,6" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" opacity="0.6" />
      </g>
    ),
    researcher: (
      // Eye / lens — knowledge / research
      <g>
        <ellipse cx="12" cy="12" rx="8" ry="5" fill="none" stroke={color} strokeWidth="1.3" />
        <circle cx="12" cy="12" r="2.8" fill={color} opacity="0.7" />
        <circle cx="12" cy="12" r="1.2" fill={color} />
      </g>
    ),
    archivist: (
      // Layered rectangles — archive / memory stacks
      <g>
        <rect x="5" y="5" width="14" height="3" rx="1" fill="none" stroke={color} strokeWidth="1.2" />
        <rect x="5" y="10.5" width="14" height="3" rx="1" fill="none" stroke={color} strokeWidth="1.2" />
        <rect x="5" y="16" width="14" height="3" rx="1" fill="none" stroke={color} strokeWidth="1.2" opacity="0.6" />
      </g>
    ),
    monitor: (
      // Alert diamond with inner pulse — watchful
      <g>
        <polygon points="12,3 21,12 12,21 3,12" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
        <polygon points="12,7 17,12 12,17 7,12" fill={color} opacity="0.3" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2" fill={color} opacity={animState === 'working' ? '1' : '0.6'} />
      </g>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
      {glyphs[role]}
    </svg>
  );
}
