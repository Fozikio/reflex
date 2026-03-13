export type ReflexEvent =
  | 'bash_command'
  | 'file_write'
  | 'file_edit'
  | 'file_delete'
  | 'prompt_submit'
  | 'session_stop'
  | 'tool_call'
  | 'post_tool'
  | 'any';

export type RuleTier = 'core' | 'recommended' | 'custom';
export type RuleCategory = 'safety' | 'quality' | 'style' | 'cognitive';
export type RuleAction = 'block' | 'warn' | 'log';
export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ConditionOp =
  | 'matches'
  | 'not_matches'
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'starts_with'
  | 'ends_with'
  | 'regex';

export interface ReflexCondition {
  field: string;
  op: ConditionOp;
  pattern: string;
}

export interface RuleOverride {
  allow_disable: boolean;
  allow_downgrade: boolean;
}

export interface ReflexRule {
  name: string;
  version: number;
  tier: RuleTier;
  category: RuleCategory;
  description: string;
  events: ReflexEvent[];
  conditions: ReflexCondition[];
  action: RuleAction;
  severity: RuleSeverity;
  message: string;
  override: RuleOverride;
  enabled: boolean;
}

export interface ReflexEventData {
  event: ReflexEvent;
  tool_name?: string;
  file_path?: string;
  command?: string;
  content?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface EvaluationResult {
  rule: string;
  triggered: boolean;
  action: RuleAction;
  severity: RuleSeverity;
  message: string;
  matched_conditions: string[];
}

export interface ReflexConfig {
  allowed_roots?: string[];
  variables?: Record<string, string | string[]>;
  disabled_rules?: string[];
  rule_dirs?: string[];
}
