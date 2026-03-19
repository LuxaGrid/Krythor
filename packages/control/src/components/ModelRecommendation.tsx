import { useState, useEffect, useRef } from 'react';
import {
  getRecommendation,
  setPreference,
  type ModelRecommendation as ApiRecommendation,
  type ModelInfo,
} from '../api.ts';

// ─── ModelRecommendationBar ────────────────────────────────────────────────────
//
// Inline non-intrusive recommendation chip shown in the command panel.
//
// Behavior:
// - Classifies the user's input text after a 600ms debounce
// - Shows a small bar if a useful recommendation exists (and differs from selected)
// - User can accept (switch model), dismiss, or pin a preference
// - Pinned preferences suppress future recommendations for that task type
// - Disappears gracefully when only one model is available
//

interface ModelRecommendationBarProps {
  inputText:        string;         // current command input — classified on change
  selectedModelId?: string;         // currently selected model
  onAccept:         (modelId: string, providerId: string) => void;
  className?:       string;
}

const DEBOUNCE_MS = 600;
const MIN_INPUT_LENGTH = 8; // don't classify very short inputs

export function ModelRecommendationBar({
  inputText,
  selectedModelId,
  onAccept,
  className = '',
}: ModelRecommendationBarProps) {
  const [recommendation, setRecommendation] = useState<ApiRecommendation | null>(null);
  const [taskType, setTaskType]             = useState<string>('');
  const [dismissed, setDismissed]           = useState(false);
  const [pinning, setPinning]               = useState(false);
  const [pinned, setPinned]                 = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInputRef = useRef('');

  // Debounced classification
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    // Reset state when input is cleared or too short
    if (!inputText || inputText.trim().length < MIN_INPUT_LENGTH) {
      setRecommendation(null);
      setDismissed(false);
      setPinned(false);
      return;
    }

    // Don't re-classify identical input
    if (inputText === lastInputRef.current) return;

    timerRef.current = setTimeout(async () => {
      lastInputRef.current = inputText;
      try {
        const result = await getRecommendation(inputText);
        setTaskType(result.classification.taskType);

        // Don't show if no recommendation, or if already using recommended model
        if (
          !result.recommendation ||
          result.recommendation.modelId === selectedModelId ||
          result.availableModels.length <= 1
        ) {
          setRecommendation(null);
          return;
        }

        setRecommendation(result.recommendation);
        setDismissed(false);
        setPinned(false);
      } catch {
        setRecommendation(null);
      }
    }, DEBOUNCE_MS);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [inputText, selectedModelId]);

  const handleAccept = () => {
    if (!recommendation) return;
    onAccept(recommendation.modelId, recommendation.providerId);
    setRecommendation(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    setRecommendation(null);
  };

  const handlePin = async () => {
    if (!recommendation || !taskType) return;
    setPinning(true);
    try {
      await setPreference(taskType, recommendation.modelId, recommendation.providerId, 'always_use');
      setPinned(true);
      setTimeout(() => {
        setPinned(false);
        setRecommendation(null);
      }, 1500);
    } catch {
      // Non-fatal — preference just won't persist
    } finally {
      setPinning(false);
    }
  };

  if (!recommendation || dismissed) return null;

  const modelName = recommendation.modelId.split('/').pop() ?? recommendation.modelId;
  const localBadge = recommendation.isLocal
    ? <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-900/60 text-emerald-400 border border-emerald-800">local</span>
    : <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-900/60 text-sky-400 border border-sky-800">cloud</span>;

  return (
    <div className={`flex items-start gap-2 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs ${className}`}>
      {/* Left: recommendation content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-zinc-500">Suggested:</span>
          <span className="font-mono text-zinc-200 truncate max-w-[180px]" title={recommendation.modelId}>
            {modelName}
          </span>
          {localBadge}
          {recommendation.confidence === 'high' && (
            <span className="text-zinc-600 text-[10px]">·</span>
          )}
          <span className="text-zinc-600">{recommendation.reason}</span>
        </div>
        {recommendation.tradeoff && (
          <p className="text-zinc-600 mt-0.5 leading-relaxed">{recommendation.tradeoff}</p>
        )}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleAccept}
          className="px-2 py-1 rounded bg-brand-700 hover:bg-brand-600 text-white text-[11px] font-medium transition-colors"
          title={`Switch to ${modelName}`}
        >
          Use
        </button>

        {/* Pin preference */}
        <button
          onClick={handlePin}
          disabled={pinning}
          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-[11px] transition-colors"
          title={`Always use ${modelName} for ${taskType} tasks`}
        >
          {pinned ? 'Pinned!' : pinning ? '…' : 'Always'}
        </button>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
          title="Dismiss recommendation"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ─── ModelSwitcher ─────────────────────────────────────────────────────────────
//
// Compact model selector showing currently active model with badge.
// Appears in the command panel toolbar.
//

interface ModelSwitcherProps {
  selectedModelId?: string;
  providerId?:      string;
  models:           ModelInfo[];
  onChange:         (modelId: string, providerId: string) => void;
}

export function ModelSwitcher({ selectedModelId, models, onChange }: ModelSwitcherProps) {
  const [open, setOpen] = useState(false);

  if (models.length === 0) return null;

  const current = models.find(m => m.id === selectedModelId) ?? models[0];
  const isLocal = current?.badges.includes('local');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 transition-colors"
        title="Switch model"
      >
        {isLocal
          ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
          : <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
        }
        <span className="font-mono truncate max-w-[120px]">
          {current?.id.split('/').pop() ?? 'Select model'}
        </span>
        <span className="text-zinc-600">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 right-0 z-50 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl min-w-[220px] max-h-[280px] overflow-y-auto">
            {models.map(m => {
              const local = m.badges.includes('local');
              const active = m.id === selectedModelId;
              return (
                <button
                  key={`${m.providerId}/${m.id}`}
                  onClick={() => {
                    onChange(m.id, m.providerId);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-800 transition-colors
                    ${active ? 'text-zinc-100' : 'text-zinc-400'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${local ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                  <span className="font-mono truncate">{m.id}</span>
                  {active && <span className="ml-auto text-brand-400">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
