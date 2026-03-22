import React from 'react';

interface TaskBubbleProps {
  text: string;
  color: string;
  visible: boolean;
}

export function TaskBubble({ text, color, visible }: TaskBubbleProps): React.ReactElement {
  return (
    <div
      className="absolute pointer-events-none transition-all duration-300 whitespace-nowrap"
      style={{
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        marginBottom: '6px',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        className="px-2 py-0.5 rounded text-[9px] font-mono max-w-[120px] truncate"
        style={{
          background: 'rgba(9,9,11,0.92)',
          border: `1px solid ${color}`,
          color: color,
          boxShadow: `0 0 8px ${color}40`,
        }}
      >
        {text}
      </div>
      {/* Arrow */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0"
        style={{
          top: '100%',
          borderLeft: '4px solid transparent',
          borderRight: '4px solid transparent',
          borderTop: `4px solid ${color}`,
        }}
      />
    </div>
  );
}
