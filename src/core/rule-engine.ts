import type { ReflexRule, ReflexEventData, EvaluationResult, ConditionOp } from './types.js';

export class RuleEngine {
  private rules: ReflexRule[] = [];
  private variables: Record<string, string | string[]> = {};

  constructor(variables?: Record<string, string | string[]>) {
    this.variables = variables ?? {};
  }

  addRule(rule: ReflexRule): void {
    this.rules.push(rule);
  }

  addRules(rules: ReflexRule[]): void {
    this.rules.push(...rules);
  }

  setVariable(key: string, value: string | string[]): void {
    this.variables[key] = value;
  }

  evaluate(event: ReflexEventData): EvaluationResult[] {
    const results: EvaluationResult[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (!rule.events.includes(event.event) && !rule.events.includes('any')) continue;

      const matchedConditions: string[] = [];
      let allMatch = true;

      for (const condition of rule.conditions) {
        const fieldValue = this.resolveField(event, condition.field);
        const pattern = this.resolveTemplate(condition.pattern);

        if (this.evaluateCondition(fieldValue, condition.op, pattern)) {
          matchedConditions.push(`${condition.field} ${condition.op} ${pattern}`);
        } else {
          allMatch = false;
          break;
        }
      }

      if (allMatch && rule.conditions.length > 0) {
        const message = this.resolveTemplate(rule.message, event);
        results.push({
          rule: rule.name,
          triggered: true,
          action: rule.action,
          severity: rule.severity,
          message,
          matched_conditions: matchedConditions,
        });
      }
    }

    return results;
  }

  /** Get blocking results only */
  getBlocks(event: ReflexEventData): EvaluationResult[] {
    return this.evaluate(event).filter(r => r.action === 'block');
  }

  /** Check if an event is allowed (no blocking rules trigger) */
  isAllowed(event: ReflexEventData): boolean {
    return this.getBlocks(event).length === 0;
  }

  private resolveField(event: ReflexEventData, field: string): string {
    const value = event[field];
    if (value === undefined || value === null) return '';
    return String(value);
  }

  private resolveTemplate(template: string, event?: ReflexEventData): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      // Check event data first
      if (event && key in event) return String(event[key]);
      // Then check variables
      const value = this.variables[key];
      if (Array.isArray(value)) return value.join(', ');
      return value ?? `{{${key}}}`;
    });
  }

  private evaluateCondition(value: string, op: ConditionOp, pattern: string): boolean {
    switch (op) {
      case 'equals': return value === pattern;
      case 'not_equals': return value !== pattern;
      case 'contains': return value.includes(pattern);
      case 'not_contains': return !value.includes(pattern);
      case 'starts_with': return value.startsWith(pattern);
      case 'ends_with': return value.endsWith(pattern);
      case 'regex': return new RegExp(pattern).test(value);
      case 'matches': {
        const patterns = pattern.split(',').map(p => p.trim());
        return patterns.some(p => {
          if (p.includes('*')) {
            const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
            return regex.test(value);
          }
          return value.startsWith(p);
        });
      }
      case 'not_matches': {
        const patterns = pattern.split(',').map(p => p.trim());
        return !patterns.some(p => {
          if (p.includes('*')) {
            const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$');
            return regex.test(value);
          }
          return value.startsWith(p);
        });
      }
      default: return false;
    }
  }
}
