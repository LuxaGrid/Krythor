export { MemoryEngine } from './MemoryEngine.js';
export { ConversationStore } from './db/ConversationStore.js';
export type { Conversation, Message } from './db/ConversationStore.js';
export { MemoryStore } from './db/MemoryStore.js';
export { GuardDecisionStore } from './db/GuardDecisionStore.js';
export { AgentRunStore } from './db/AgentRunStore.js';
export type { PersistedRun } from './db/AgentRunStore.js';
export { LearningRecordStore } from './db/LearningRecordStore.js';
export type { LearningRecord, NewLearningRecord, LearningStats } from './db/LearningRecordStore.js';
export type { GuardDecision, GuardContextInput, GuardVerdictInput } from './db/GuardDecisionStore.js';
export { MemoryWriter } from './MemoryWriter.js';
export { MemoryRetriever } from './MemoryRetriever.js';
export { MemoryScorer } from './MemoryScorer.js';
export { EmbeddingRegistry, StubEmbeddingProvider } from './embedding/EmbeddingProvider.js';
export { EmbeddingCache } from './embedding/EmbeddingCache.js';
export { MigrationRunner } from './db/MigrationRunner.js';
export type { MigrationResult } from './db/MigrationRunner.js';
export { DbJanitor } from './db/DbJanitor.js';
export type { JanitorResult, DbJanitorConfig, LogFn } from './db/DbJanitor.js';
export { applySchema } from './db/schema.js';
export type { StartupCheckResult } from './db/schema.js';
export { OllamaEmbeddingProvider } from './embedding/OllamaEmbeddingProvider.js';

export type {
  MemoryEntry,
  MemoryTag,
  MemoryUsageRecord,
  MemorySource,
  MemoryScope,
  MemoryWriteRisk,
  MemoryQuery,
  MemorySearchResult,
  CreateMemoryInput,
  UpdateMemoryInput,
  EmbeddingProvider,
  EmbeddingVector,
} from './types.js';

export type { WriteResult } from './MemoryWriter.js';
export { HeartbeatInsightStore } from './db/HeartbeatInsightStore.js';
export type { PersistedInsight } from './db/HeartbeatInsightStore.js';
export { SessionStore, resolveSessionKey } from './db/SessionStore.js';
export type {
  SessionEntry,
  SessionKind,
  DmScope,
  ChatType,
  SendPolicy,
  SendPolicyRule,
  SendPolicyConfig,
  ResolveSessionKeyParams,
} from './db/SessionStore.js';
