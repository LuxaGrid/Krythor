// ─── TaskClassifier ────────────────────────────────────────────────────────────
//
// Lightweight heuristic task type classifier.
// Given a short text describing what the user wants to do, returns a task type
// that the ModelRecommender can use to select the best available model.
//
// This is purely pattern-based — no LLM call, no network, no latency.
// The goal is a fast, offline, good-enough classification.
//
// Task types are open strings; the canonical set is defined in TASK_PATTERNS
// but the classifier can return any string — callers should handle unknowns.
//

export type TaskType =
  | 'code'
  | 'debug'
  | 'refactor'
  | 'summarize'
  | 'draft'
  | 'classify'
  | 'vision'
  | 'plan'
  | 'memory_consolidation'
  | 'triage'
  | 'question_answer'
  | 'general';

export interface ClassificationResult {
  taskType: TaskType;
  confidence: 'high' | 'medium' | 'low';
  signals: string[];   // which patterns matched
}

// Each entry: regex patterns to match (any match → this type), with weight.
// Higher weight wins ties. First pass collects all matches, returns highest weight.
interface PatternGroup {
  type:    TaskType;
  weight:  number;
  patterns: RegExp[];
}

const PATTERN_GROUPS: PatternGroup[] = [
  {
    type: 'vision',
    weight: 100,
    patterns: [
      /\b(image|photo|picture|screenshot|ocr|vision|visual|diagram|chart)\b/i,
    ],
  },
  {
    type: 'code',
    weight: 80,
    patterns: [
      /\b(write|generate|implement|create)\b.{0,30}\b(code|function|class|method|script|component|api|endpoint)\b/i,
      /\b(typescript|javascript|python|rust|golang|java|c\+\+|sql|bash)\b/i,
      /\b(code\s+(for|to|that)|write\s+a?\s*(script|function|class))\b/i,
    ],
  },
  {
    type: 'debug',
    weight: 90,
    patterns: [
      /\b(debug|fix|bug|error|crash|exception|broken|failing|not\s+working)\b/i,
      /\b(stack\s+trace|traceback|runtime\s+error|type\s+error)\b/i,
    ],
  },
  {
    type: 'refactor',
    weight: 85,
    patterns: [
      /\b(refactor|rewrite|clean\s*up|simplify|restructure|reorganize|rename)\b/i,
    ],
  },
  {
    type: 'plan',
    weight: 80,
    patterns: [
      /\b(plan|design|architect|strategy|roadmap|approach|how\s+to\s+build|how\s+should\s+I)\b/i,
      /\b(think\s+through|reason\s+about|analyze\s+tradeoffs|what\s+is\s+the\s+best\s+way)\b/i,
    ],
  },
  {
    type: 'draft',
    weight: 70,
    patterns: [
      /\b(write|draft|compose|author)\b.{0,30}\b(email|message|letter|report|document|proposal|announcement)\b/i,
      /\b(professional|formal|polished|final\s+draft)\b/i,
    ],
  },
  {
    type: 'summarize',
    weight: 65,
    patterns: [
      /\b(summar(ize|y)|tldr|condense|shorten|brief|overview|key\s+points)\b/i,
    ],
  },
  {
    type: 'triage',
    weight: 60,
    patterns: [
      /\b(triage|inbox|sort|prioritize|categorize|label|tag|route)\b/i,
    ],
  },
  {
    type: 'classify',
    weight: 55,
    patterns: [
      /\b(classify|categorize|label|detect|identify|is\s+this\s+a|what\s+type)\b/i,
    ],
  },
  {
    type: 'memory_consolidation',
    weight: 50,
    patterns: [
      /\b(consolidat|prune|merge\s+memor|memory\s+hygiene|compress\s+memor)\b/i,
    ],
  },
  {
    type: 'question_answer',
    weight: 30,
    patterns: [
      /\b(what\s+is|who\s+is|when\s+did|where\s+is|how\s+does|explain|describe)\b/i,
    ],
  },
];

export class TaskClassifier {
  classify(text: string): ClassificationResult {
    if (!text || text.trim().length === 0) {
      return { taskType: 'general', confidence: 'low', signals: [] };
    }

    const normalized = text.trim();
    const matched: Array<{ type: TaskType; weight: number; pattern: string }> = [];

    for (const group of PATTERN_GROUPS) {
      for (const pattern of group.patterns) {
        if (pattern.test(normalized)) {
          matched.push({ type: group.type, weight: group.weight, pattern: pattern.source });
        }
      }
    }

    if (matched.length === 0) {
      return { taskType: 'general', confidence: 'low', signals: [] };
    }

    // Sort by weight descending — pick the highest-weight match
    matched.sort((a, b) => b.weight - a.weight);
    const best = matched[0]!;

    // Confidence: high if same type appears multiple times or weight >= 80
    const typeCount = matched.filter(m => m.type === best.type).length;
    const confidence: ClassificationResult['confidence'] =
      typeCount >= 2 || best.weight >= 80 ? 'high' :
      best.weight >= 60 ? 'medium' : 'low';

    return {
      taskType: best.type,
      confidence,
      signals: matched.map(m => m.pattern),
    };
  }
}
