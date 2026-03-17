export { MemoryEngine } from './MemoryEngine.js';
export { ConversationStore } from './db/ConversationStore.js';
export type { Conversation, Message } from './db/ConversationStore.js';
export { MemoryStore } from './db/MemoryStore.js';
export { GuardDecisionStore } from './db/GuardDecisionStore.js';
export { AgentRunStore } from './db/AgentRunStore.js';
export type { PersistedRun } from './db/AgentRunStore.js';
export type { GuardDecision, GuardContextInput, GuardVerdictInput } from './db/GuardDecisionStore.js';
export { MemoryWriter } from './MemoryWriter.js';
export { MemoryRetriever } from './MemoryRetriever.js';
export { MemoryScorer } from './MemoryScorer.js';
export { EmbeddingRegistry, StubEmbeddingProvider } from './embedding/EmbeddingProvider.js';
export { MigrationRunner } from './db/MigrationRunner.js';
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
