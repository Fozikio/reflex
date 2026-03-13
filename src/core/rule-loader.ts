import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ReflexRule, ReflexConfig } from './types.js';

const TIER_ENFORCEMENT: Record<string, { allow_disable: boolean; allow_downgrade: boolean }> = {
  core: { allow_disable: false, allow_downgrade: false },
  recommended: { allow_disable: true, allow_downgrade: true },
  custom: { allow_disable: true, allow_downgrade: true },
};

export async function loadRuleFile(path: string): Promise<ReflexRule> {
  const content = await readFile(path, 'utf-8');
  const raw = parseYaml(content) as Record<string, unknown>;

  const tier = (raw['tier'] as string) ?? 'custom';
  const enforcement = TIER_ENFORCEMENT[tier] ?? TIER_ENFORCEMENT['custom']!;

  type RawCondition = { field: string; op: string; pattern: string };

  return {
    name: (raw['name'] as string) ?? '',
    version: (raw['version'] as number) ?? 1,
    tier: tier as ReflexRule['tier'],
    category: ((raw['category'] as string) ?? 'safety') as ReflexRule['category'],
    description: (raw['description'] as string) ?? '',
    events: (raw['events'] as ReflexRule['events']) ?? [],
    conditions: ((raw['conditions'] as RawCondition[]) ?? []).map(c => ({
      field: c.field,
      op: c.op as ReflexRule['conditions'][number]['op'],
      pattern: c.pattern,
    })),
    action: ((raw['action'] as string) ?? 'warn') as ReflexRule['action'],
    severity: ((raw['severity'] as string) ?? 'medium') as ReflexRule['severity'],
    message: (raw['message'] as string) ?? '',
    override: {
      allow_disable:
        (raw['override'] as { allow_disable?: boolean } | undefined)?.allow_disable ??
        enforcement.allow_disable,
      allow_downgrade:
        (raw['override'] as { allow_downgrade?: boolean } | undefined)?.allow_downgrade ??
        enforcement.allow_downgrade,
    },
    enabled: true,
  };
}

export async function loadRuleDirectory(dir: string, config?: ReflexConfig): Promise<ReflexRule[]> {
  const rules: ReflexRule[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subRules = await loadRuleDirectory(fullPath, config);
      rules.push(...subRules);
    } else if (
      entry.isFile() &&
      (extname(entry.name) === '.yaml' || extname(entry.name) === '.yml')
    ) {
      const rule = await loadRuleFile(fullPath);

      // Apply config overrides — silently ignore disable attempts on core rules
      if (config?.disabled_rules?.includes(rule.name)) {
        if (rule.override.allow_disable) {
          rule.enabled = false;
        }
      }

      rules.push(rule);
    }
  }

  return rules;
}
