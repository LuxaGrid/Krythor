import type { ModelEngine } from './ModelEngine.js';
import type { ModelInfo } from './types.js';
import type { TaskType } from './TaskClassifier.js';
import type { PreferenceStore } from './PreferenceStore.js';

// ─── ModelRecommender ─────────────────────────────────────────────────────────
//
// Suggests the best currently-configured model for a given task type.
//
// Design principles (from MASTER Prompt Phase 5 + SOUL.md):
//   - Only recommends models the user has actually added and enabled
//   - Never forces a choice — recommendations are advisory
//   - Biases toward local/cheaper models when sufficient for the task
//   - Preserves user-pinned preferences unconditionally
//   - Falls back gracefully if no ideal match exists
//

// ── Capability profiles ──────────────────────────────────────────────────────

/** What capability tier a task needs. */
type CapabilityTier = 'vision' | 'premium' | 'mid' | 'fast' | 'any';

/** Cost/speed preference for a task. */
type CostTier = 'local_preferred' | 'cost_aware' | 'quality_first';

interface TaskProfile {
  capabilityTier: CapabilityTier;
  costTier:       CostTier;
  localOk:        boolean;    // can a local model handle this?
  reasoning:      string;     // why this profile was chosen
}

const TASK_PROFILES: Record<TaskType | 'general', TaskProfile> = {
  vision:               { capabilityTier: 'vision',  costTier: 'quality_first',  localOk: false, reasoning: 'Requires vision capability' },
  plan:                 { capabilityTier: 'premium', costTier: 'quality_first',  localOk: true,  reasoning: 'Architecture planning benefits from stronger reasoning' },
  code:                 { capabilityTier: 'premium', costTier: 'quality_first',  localOk: true,  reasoning: 'Code generation benefits from a capable coding model' },
  debug:                { capabilityTier: 'premium', costTier: 'quality_first',  localOk: true,  reasoning: 'Debugging requires accurate reasoning' },
  refactor:             { capabilityTier: 'mid',     costTier: 'cost_aware',     localOk: true,  reasoning: 'Refactoring is well-suited to mid-tier models' },
  draft:                { capabilityTier: 'mid',     costTier: 'quality_first',  localOk: true,  reasoning: 'Quality drafting benefits from a capable language model' },
  question_answer:      { capabilityTier: 'mid',     costTier: 'cost_aware',     localOk: true,  reasoning: 'General Q&A is suitable for mid-tier models' },
  summarize:            { capabilityTier: 'fast',    costTier: 'local_preferred', localOk: true, reasoning: 'Summarization is suitable for fast, low-cost models' },
  classify:             { capabilityTier: 'fast',    costTier: 'local_preferred', localOk: true, reasoning: 'Classification is well-suited to local or fast models' },
  triage:               { capabilityTier: 'fast',    costTier: 'local_preferred', localOk: true, reasoning: 'Inbox triage needs speed over quality' },
  memory_consolidation: { capabilityTier: 'fast',    costTier: 'local_preferred', localOk: true, reasoning: 'Memory consolidation is a background task' },
  general:              { capabilityTier: 'any',     costTier: 'cost_aware',     localOk: true,  reasoning: 'No specific task profile' },
};

// ── Recommendation output ────────────────────────────────────────────────────

export interface ModelRecommendation {
  modelId:     string;
  providerId:  string;
  isLocal:     boolean;
  reason:      string;
  tradeoff?:   string;      // e.g. "faster but lower quality than premium option"
  confidence:  'high' | 'medium' | 'low';
}

// ── User preferences ─────────────────────────────────────────────────────────

export type RecommendationPreference =
  | 'always_use'   // pinned — skip recommendations, just use this
  | 'ask'          // always ask before using a recommendation
  | 'auto';        // accept recommendations silently

export interface TaskPreference {
  taskType:    string;
  modelId:     string;
  providerId:  string;
  preference:  RecommendationPreference;
}

// ── ModelRecommender ─────────────────────────────────────────────────────────

export class ModelRecommender {
  private preferences = new Map<string, TaskPreference>(); // taskType → preference (in-memory)
  private store: PreferenceStore | null = null;

  constructor(private readonly engine: ModelEngine, store?: PreferenceStore) {
    if (store) {
      this.store = store;
      // Seed in-memory map from persisted preferences
      for (const pref of store.getAll()) {
        this.preferences.set(pref.taskType, pref);
      }
    }
  }

  /**
   * Recommend a model for the given task type.
   * Returns null if only one model is available (no point recommending).
   * Returns null if the user has `never_recommend` behavior (preference = 'always_use' already set).
   */
  recommend(taskType: TaskType | string): ModelRecommendation | null {
    // Check pinned preference — if pinned, honor it without a recommendation display
    const pinned = this.preferences.get(taskType);
    if (pinned && pinned.preference === 'always_use') {
      return {
        modelId:    pinned.modelId,
        providerId: pinned.providerId,
        isLocal:    this.isLocal(pinned.providerId),
        reason:     'Using your pinned preference for this task type.',
        confidence: 'high',
      };
    }

    const available = this.engine.listModels().filter(m => m.isAvailable && m.circuitState !== 'open');
    if (available.length === 0) return null;
    if (available.length === 1) return null; // no choice to make

    const profile = TASK_PROFILES[taskType as TaskType] ?? TASK_PROFILES.general;
    const ranked  = this.rankModels(available, profile);

    if (ranked.length === 0) return null;

    const top = ranked[0]!;
    const isLocal = this.isLocal(top.providerId);

    const tradeoff = this.buildTradeoff(top, ranked, profile);

    return {
      modelId:    top.id,
      providerId: top.providerId,
      isLocal,
      reason:     profile.reasoning,
      tradeoff,
      confidence: ranked.length >= 2 ? 'high' : 'low',
    };
  }

  /** Set a persistent task-type preference. */
  setPreference(pref: TaskPreference): void {
    this.preferences.set(pref.taskType, pref);
    this.store?.set(pref);
  }

  /** Clear the preference for a task type. */
  clearPreference(taskType: string): void {
    this.preferences.delete(taskType);
    this.store?.delete(taskType);
  }

  /** Get the current preference for a task type. */
  getPreference(taskType: string): TaskPreference | null {
    return this.preferences.get(taskType) ?? null;
  }

  /** All current preferences (for settings UI). */
  listPreferences(): TaskPreference[] {
    return Array.from(this.preferences.values());
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private rankModels(models: ModelInfo[], profile: TaskProfile): ModelInfo[] {
    // Hard filter: vision tasks require vision badge (heuristic: model name suggests it)
    let candidates = models;
    if (profile.capabilityTier === 'vision') {
      candidates = candidates.filter(m => this.appearsVisionCapable(m));
      if (candidates.length === 0) candidates = models; // fallback to any if none qualify
    }

    return candidates.slice().sort((a, b) => {
      const aScore = this.score(a, profile);
      const bScore = this.score(b, profile);
      return bScore - aScore;
    });
  }

  private score(model: ModelInfo, profile: TaskProfile): number {
    let score = 0;
    const isLocal = this.isLocal(model.providerId);

    // Local preference
    if (profile.localOk && isLocal) {
      if (profile.costTier === 'local_preferred') score += 30;
      else if (profile.costTier === 'cost_aware')  score += 10;
    }

    // Capability tier match (heuristic by model name)
    if (profile.capabilityTier === 'premium') {
      if (this.appearsPremium(model)) score += 40;
    } else if (profile.capabilityTier === 'fast') {
      if (this.appearsFast(model))    score += 30;
      if (isLocal)                    score += 10; // local is always faster
    } else if (profile.capabilityTier === 'mid') {
      if (!this.appearsPremium(model) && !this.appearsFast(model)) score += 20;
    } else {
      score += 10; // 'any' — all models get baseline
    }

    // Default provider preference
    if (model.badges.includes('default')) score += 5;

    return score;
  }

  /** Heuristic: does the model ID suggest a premium/large model? */
  private appearsPremium(model: ModelInfo): boolean {
    const id = model.id.toLowerCase();
    return /claude-(opus|sonnet)|gpt-4|o1|o3|llama[\w.-]*70b|llama[\w.-]*405b|mixtral/.test(id);
  }

  /** Heuristic: does the model ID suggest a fast/small model? */
  private appearsFast(model: ModelInfo): boolean {
    const id = model.id.toLowerCase();
    return /haiku|mini|flash|3b|7b|8b|tiny|small|phi|gemma/.test(id);
  }

  /** Heuristic: does the model appear vision-capable? */
  private appearsVisionCapable(model: ModelInfo): boolean {
    const id = model.id.toLowerCase();
    return /vision|llava|bakllava|clip|gpt-4o|claude-3|gemini/.test(id);
  }

  private isLocal(providerId: string): boolean {
    const configs = this.engine.listProviders();
    const p = configs.find(c => c.id === providerId);
    return p?.type === 'ollama' || p?.type === 'gguf';
  }

  private buildTradeoff(
    top: ModelInfo,
    ranked: ModelInfo[],
    profile: TaskProfile,
  ): string | undefined {
    if (ranked.length < 2) return undefined;

    const topIsLocal  = this.isLocal(top.providerId);
    const topIsFast   = this.appearsFast(top);
    const topIsPremium = this.appearsPremium(top);

    if (profile.costTier === 'local_preferred' && topIsLocal) {
      const remote = ranked.find(m => !this.isLocal(m.providerId));
      if (remote) return `Faster and free to run locally — ${remote.id} may produce higher quality output.`;
    }
    if (profile.capabilityTier === 'premium' && !topIsPremium) {
      return 'Best available model selected — adding a larger model may improve results.';
    }
    if (profile.costTier === 'quality_first' && topIsFast) {
      return 'Only fast/small models available — quality may be limited for this task type.';
    }
    return undefined;
  }
}
