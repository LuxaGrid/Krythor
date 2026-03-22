import React, { useState, useEffect } from 'react';

const TOUR_SEEN_KEY = 'krythor_tour_seen';

interface TourStep {
  tab: string;
  icon: string;
  title: string;
  body: string;
  color: string;
}

const STEPS: TourStep[] = [
  {
    tab: 'Chat',
    icon: '💬',
    title: 'Chat — Talk to your agents',
    body: 'This is your main workspace. Start a conversation with any of your AI agents. Each conversation is saved so you can pick up where you left off. Use Ctrl+N to open a new chat instantly.',
    color: '#60a5fa',
  },
  {
    tab: 'Agents',
    icon: '🤖',
    title: 'Agents — Your AI team',
    body: 'Create and configure AI agents. Each agent has its own name, personality, system prompt, and preferred model. Think of agents as specialists — a researcher, a writer, a coder — each tuned for a specific job.',
    color: '#34d399',
  },
  {
    tab: 'Memory',
    icon: '🧠',
    title: 'Memory — What Krythor remembers',
    body: 'Agents can store and recall information across conversations. Browse everything that\'s been remembered, search by keyword or meaning, pin important entries, and prune outdated ones.',
    color: '#67e8f9',
  },
  {
    tab: 'Models',
    icon: '⚡',
    title: 'Models — Connect AI providers',
    body: 'Connect to AI providers: Ollama runs models locally for free, OpenAI and Anthropic require an API key, and any OpenAI-compatible service (LM Studio, Groq, Together) works too. Use "Discover local" to auto-detect what\'s already running on your machine.',
    color: '#f59e0b',
  },
  {
    tab: 'Command Center',
    icon: '⬡',
    title: 'Command Center — Live agent view',
    body: 'A real-time animated view of your agents at work. Watch agents think, hand off tasks, and retrieve memories. Click an agent to focus on it. Great for monitoring multi-agent workflows in action.',
    color: '#f59e0b',
  },
  {
    tab: 'Dashboard',
    icon: '📊',
    title: 'Dashboard — System health',
    body: 'See token usage, inference history, provider health, and activity stats at a glance. A quick way to check how much you\'ve used each model and whether your providers are healthy.',
    color: '#a78bfa',
  },
  {
    tab: 'Settings',
    icon: '⚙',
    title: 'Settings — Configuration',
    body: 'Change your theme, view gateway info and provider health history, and find your data directory. Everything Krythor stores stays on your machine — no telemetry, no cloud accounts required.',
    color: '#71717a',
  },
  {
    tab: null as unknown as string,
    icon: '🎉',
    title: 'You\'re all set!',
    body: 'Drag the tabs to reorder them to your liking. Click the ? button on any screen for tips on how to use it. Press Ctrl+/ anytime to open the About dialog with keyboard shortcuts.\n\nStart by connecting a model in the Models tab, then chat with your agents.',
    color: '#34d399',
  },
];

interface WalkthroughTourProps {
  onClose: () => void;
}

export function WalkthroughTour({ onClose }: WalkthroughTourProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const [exiting, setExiting] = useState(false);

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (!isLast) setStep(s => s + 1);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isFirst) setStep(s => s - 1);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLast, isFirst]);

  const handleClose = () => {
    if (dontShow) {
      try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* ignore */ }
    }
    setExiting(true);
    setTimeout(onClose, 250);
  };

  const handleFinish = () => {
    try { localStorage.setItem(TOUR_SEEN_KEY, '1'); } catch { /* ignore */ }
    setExiting(true);
    setTimeout(onClose, 250);
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center pb-8 px-4"
      style={{
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
        opacity: exiting ? 0 : 1,
        transition: 'opacity 250ms ease',
      }}
      onClick={e => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Tour card — anchored to bottom-center */}
      <div
        className="w-full max-w-lg flex flex-col"
        style={{
          transform: exiting ? 'translateY(24px)' : 'translateY(0)',
          transition: 'transform 250ms ease',
        }}
      >
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mb-3">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === step ? '20px' : '6px',
                height: '6px',
                background: i === step ? current.color : 'rgba(255,255,255,0.15)',
              }}
            />
          ))}
        </div>

        {/* Card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(15,15,18,0.97)',
            border: `1px solid ${current.color}30`,
            boxShadow: `0 0 40px ${current.color}18, 0 20px 60px rgba(0,0,0,0.6)`,
          }}
        >
          {/* Colored accent bar */}
          <div style={{ height: '3px', background: current.color, opacity: 0.7 }} />

          {/* Body */}
          <div className="px-6 py-5">
            {/* Step label + tab badge */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{current.icon}</span>
                {current.tab && (
                  <span
                    className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded"
                    style={{ background: `${current.color}18`, color: current.color, border: `1px solid ${current.color}30` }}
                  >
                    {current.tab}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-zinc-700">
                {step + 1} / {STEPS.length}
              </span>
            </div>

            <h2 className="text-base font-semibold text-zinc-100 mb-2 leading-snug">{current.title}</h2>
            <p className="text-sm text-zinc-400 leading-relaxed whitespace-pre-line">{current.body}</p>
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 flex items-center justify-between gap-3">
            {/* Don't show again */}
            {!isLast && (
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={dontShow}
                  onChange={e => setDontShow(e.target.checked)}
                  className="accent-zinc-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-zinc-600 group-hover:text-zinc-500 transition-colors">
                  Don't show again
                </span>
              </label>
            )}
            {isLast && <div />}

            {/* Nav buttons */}
            <div className="flex items-center gap-2">
              {!isLast && (
                <button
                  onClick={handleClose}
                  className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1"
                >
                  Skip tour
                </button>
              )}
              {!isFirst && (
                <button
                  onClick={() => setStep(s => s - 1)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                >
                  ← Back
                </button>
              )}
              {!isLast ? (
                <button
                  onClick={() => setStep(s => s + 1)}
                  className="text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                  style={{ background: current.color, color: '#09090b' }}
                >
                  Next →
                </button>
              ) : (
                <button
                  onClick={handleFinish}
                  className="text-sm font-medium px-5 py-1.5 rounded-lg transition-colors"
                  style={{ background: current.color, color: '#09090b' }}
                >
                  Get started
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Keyboard hint */}
        <p className="text-center text-[10px] text-zinc-800 mt-2 font-mono">
          ← → arrow keys to navigate · Esc to close
        </p>
      </div>
    </div>
  );
}

export function shouldShowTour(): boolean {
  try { return !localStorage.getItem(TOUR_SEEN_KEY); } catch { return false; }
}
