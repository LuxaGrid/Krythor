// ─── Memory Scopes ───────────────────────────────────────────────────────────

export type MemoryScope = 'session' | 'user' | 'agent' | 'workspace' | 'skill';

// ─── Risk level for Guard integration ────────────────────────────────────────

export type MemoryWriteRisk = 'SAFE' | 'MODERATE' | 'HIGH';

export const SCOPE_RISK: Record<MemoryScope, MemoryWriteRisk> = {
  session:   'SAFE',
  agent:     'MODERATE',
  workspace: 'MODERATE',
  skill:     'MODERATE',
  user:      'HIGH',
};

// ─── Core record types ────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  scope: MemoryScope;
  scope_id: string | null;   // agent_id, project_id, skill_id depending on scope
  source: string;            // 'user' | 'agent' | 'skill' | 'system'
  importance: number;        // 0.0 – 1.0
  pinned: boolean;
  created_at: number;        // Unix ms
  last_used: number;         // Unix ms
  access_count: number;
}

export interface MemoryTag {
  id: string;
  memory_id: string;
  tag: string;
}

export interface MemoryUsageRecord {
  id: string;
  memory_id: string;
  task_id: string | null;
  timestamp: number;
  reason: string;
}

export interface MemorySource {
  id: string;
  memory_id: string;
  source_type: string;       // 'command' | 'agent_output' | 'user_input' | 'skill_result'
  source_reference: string;  // free-form reference string (e.g. command text, agent id)
}

// ─── Input / query types ──────────────────────────────────────────────────────

export interface CreateMemoryInput {
  title: string;
  content: string;
  scope: MemoryScope;
  scope_id?: string;
  source: string;
  importance?: number;       // defaults to 0.5
  tags?: string[];
  source_type?: string;
  source_reference?: string;
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  importance?: number;
  pinned?: boolean;
  tags?: string[];
}

export interface MemoryQuery {
  text?: string;             // free-text search on title + content
  scope?: MemoryScope;
  scope_id?: string;
  tags?: string[];
  pinned?: boolean;
  minImportance?: number;
  limit?: number;            // defaults to 20
  offset?: number;
}

// ─── Retrieval result ─────────────────────────────────────────────────────────

export interface MemorySearchResult {
  entry: MemoryEntry;
  tags: string[];
  score: number;             // computed relevance score
}

// ─── Embedding interface (pluggable) ─────────────────────────────────────────

export interface EmbeddingVector {
  values: number[];
  model: string;
}

export interface EmbeddingProvider {
  name: string;
  isAvailable(): boolean;
  /** Optional lightweight reachability check. Returns true if provider is now available. */
  probe?(): Promise<boolean>;
  embed(text: string): Promise<EmbeddingVector>;
  similarity(a: EmbeddingVector, b: EmbeddingVector): number;
}
