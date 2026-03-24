import React from 'react';

interface Props {
  onMouseDown: (e: React.MouseEvent) => void;
}

export function SidebarResizeHandle({ onMouseDown }: Props) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        width: 5,
        flexShrink: 0,
        cursor: 'col-resize',
        background: 'rgba(30,174,255,0.06)',
        transition: 'background 0.15s',
        position: 'relative',
        zIndex: 10,
        alignSelf: 'stretch',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(30,174,255,0.28)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(30,174,255,0.06)')}
    />
  );
}
