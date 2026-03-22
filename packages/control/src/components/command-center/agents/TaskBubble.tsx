import React from 'react';

interface TaskBubbleProps {
  text: string;
  color: string;
  visible: boolean;
}

export function TaskBubble({ text, color, visible }: TaskBubbleProps): React.ReactElement {
  return (
    <div
      className="absolute pointer-events-none transition-all duration-300 whitespace-nowrap z-30"
      style={{
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '10px',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold max-w-[160px] truncate"
        style={{
          background: 'rgba(9,9,11,0.95)',
          border: `1px solid ${color}`,
          color: color,
          boxShadow: `0 0 12px ${color}50, 0 2px 8px rgba(0,0,0,0.6)`,
          letterSpacing: '0.02em',
        }}
      >
        {text}
      </div>
      {/* Arrow */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          top: '100%',
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `5px solid ${color}`,
        }}
      />
    </div>
  );
}
