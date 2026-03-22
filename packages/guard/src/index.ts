export { GuardEngine, GuardDeniedError } from './GuardEngine.js';
export { PolicyEngine } from './PolicyEngine.js';
export { PolicyStore } from './PolicyStore.js';
export { GuardAuditLog } from './GuardAuditLog.js';
export type { AuditEntry } from './GuardAuditLog.js';

export type {
  GuardAction,
  OperationType,
  RiskLevel,
  GuardContext,
  GuardVerdict,
  PolicyCondition,
  PolicyRule,
  PolicyConfig,
} from './types.js';

export { SCOPE_TO_RISK, OPERATION_RISK, RISK_ORDER } from './types.js';
