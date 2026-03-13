export { RuleEngine } from './core/rule-engine.js';
export { loadRuleFile, loadRuleDirectory } from './core/rule-loader.js';
export { CORE_RULES } from './core/defaults.js';
export type {
  ReflexRule,
  ReflexEventData,
  EvaluationResult,
  ReflexCondition,
  ReflexConfig,
  ReflexEvent,
  RuleTier,
  RuleCategory,
  RuleAction,
  RuleSeverity,
  ConditionOp,
  RuleOverride,
} from './core/types.js';
