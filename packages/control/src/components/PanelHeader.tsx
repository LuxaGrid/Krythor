import React, { useState } from 'react';

interface PanelHeaderProps {
  title: string;
  description: string;
  tip?: string;
  actions?: React.ReactNode;
}

export function PanelHeader({ title, description, tip, actions }: PanelHeaderProps): React.ReactElement {
  const [tipOpen, setTipOpen] = useState(false);

  return (
    <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-950/60 px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-sm font-semibold text-zinc-100 tracking-wide">{title}</h1>
            {tip && (
              <button
                onClick={() => setTipOpen(o => !o)}
                className="flex-shrink-0 w-4 h-4 rounded-full border border-zinc-700 text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 text-[10px] font-bold leading-none flex items-center justify-center transition-colors"
                title="How to use this screen"
              >
                ?
              </button>
            )}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
          {tip && tipOpen && (
            <div className="mt-2 text-xs text-zinc-400 leading-relaxed bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 max-w-2xl">
              {tip}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex-shrink-0 flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
