import { describe, expect, it } from 'vitest';
import { RuleEngine } from './rule-engine.js';
import { CORE_RULES } from './defaults.js';
import type { ReflexRule } from './types.js';

function rule(overrides: Partial<ReflexRule> = {}): ReflexRule {
  return {
    name: 'test-rule',
    version: 1,
    tier: 'custom',
    category: 'safety',
    description: 'test',
    events: ['bash_command'],
    conditions: [{ field: 'command', op: 'contains', pattern: 'danger' }],
    action: 'block',
    severity: 'high',
    message: 'blocked: {{command}}',
    override: { allow_disable: true, allow_downgrade: true },
    enabled: true,
    ...overrides,
  };
}

describe('RuleEngine.evaluate', () => {
  it('triggers a rule whose conditions all match', () => {
    const engine = new RuleEngine();
    engine.addRule(rule());

    const results = engine.evaluate({ event: 'bash_command', command: 'run danger now' });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ rule: 'test-rule', triggered: true, action: 'block' });
  });

  it('does not trigger when a condition fails', () => {
    const engine = new RuleEngine();
    engine.addRule(rule());

    expect(engine.evaluate({ event: 'bash_command', command: 'ls -la' })).toEqual([]);
  });

  it('requires every condition to match, not just one', () => {
    const engine = new RuleEngine();
    engine.addRule(
      rule({
        conditions: [
          { field: 'command', op: 'contains', pattern: 'rm' },
          { field: 'command', op: 'contains', pattern: '--force' },
        ],
      }),
    );

    expect(engine.evaluate({ event: 'bash_command', command: 'rm file' })).toEqual([]);
    expect(engine.evaluate({ event: 'bash_command', command: 'rm --force file' })).toHaveLength(1);
  });

  it('skips disabled rules', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ enabled: false }));

    expect(engine.evaluate({ event: 'bash_command', command: 'danger' })).toEqual([]);
  });

  it('only fires on the events a rule declares', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ events: ['file_write'] }));

    expect(engine.evaluate({ event: 'bash_command', command: 'danger' })).toEqual([]);
    expect(engine.evaluate({ event: 'file_write', command: 'danger' })).toHaveLength(1);
  });

  it("treats 'any' as a wildcard event", () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ events: ['any'] }));

    expect(engine.evaluate({ event: 'session_start', command: 'danger' })).toHaveLength(1);
  });

  it('ignores a rule with no conditions', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ conditions: [] }));

    expect(engine.evaluate({ event: 'bash_command', command: 'danger' })).toEqual([]);
  });

  it('treats a missing field as an empty string rather than throwing', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ conditions: [{ field: 'file_path', op: 'equals', pattern: '' }] }));

    expect(engine.evaluate({ event: 'bash_command', command: 'danger' })).toHaveLength(1);
  });
});

describe('RuleEngine condition operators', () => {
  const cases: Array<[string, string, string, boolean]> = [
    ['equals', 'abc', 'abc', true],
    ['equals', 'abc', 'abd', false],
    ['not_equals', 'abc', 'abd', true],
    ['contains', 'abcdef', 'cde', true],
    ['not_contains', 'abcdef', 'xyz', true],
    ['starts_with', 'abcdef', 'abc', true],
    ['ends_with', 'abcdef', 'def', true],
    ['regex', 'rm -rf /', 'rm\\s+-rf', true],
    ['matches', 'D:/work/file.ts', 'D:/work*', true],
    ['not_matches', 'C:/other/file.ts', 'D:/work*', true],
  ];

  it.each(cases)('%s(%s, %s) === %s', (op, value, pattern, expected) => {
    const engine = new RuleEngine();
    engine.addRule(
      rule({ conditions: [{ field: 'command', op: op as never, pattern }] }),
    );

    expect(engine.evaluate({ event: 'bash_command', command: value }).length > 0).toBe(expected);
  });

  it('fails closed on an invalid regex instead of throwing', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ conditions: [{ field: 'command', op: 'regex', pattern: '([' }] }));

    expect(() => engine.evaluate({ event: 'bash_command', command: 'anything' })).not.toThrow();
    expect(engine.evaluate({ event: 'bash_command', command: 'anything' })).toEqual([]);
  });

  it('refuses to run a regex over a pathologically long value', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ conditions: [{ field: 'command', op: 'regex', pattern: 'a+' }] }));

    expect(engine.evaluate({ event: 'bash_command', command: 'a'.repeat(10_001) })).toEqual([]);
    expect(engine.evaluate({ event: 'bash_command', command: 'a'.repeat(100) })).toHaveLength(1);
  });
});

describe('RuleEngine templating', () => {
  it('interpolates event fields into the message', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ message: 'blocked {{command}} in {{file_path}}' }));

    const [result] = engine.evaluate({
      event: 'bash_command',
      command: 'danger',
      file_path: 'D:/x.ts',
    });

    expect(result.message).toBe('blocked danger in D:/x.ts');
  });

  it('interpolates engine variables into conditions, including arrays', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/work', 'D:/tmp'] });
    engine.addRule(
      rule({ conditions: [{ field: 'file_path', op: 'not_matches', pattern: '{{allowed_roots}}' }] }),
    );

    expect(engine.evaluate({ event: 'bash_command', file_path: 'D:/work/a.ts' })).toEqual([]);
    expect(engine.evaluate({ event: 'bash_command', file_path: 'C:/windows/a.ts' })).toHaveLength(1);
  });

  it('leaves an unknown placeholder untouched', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ message: 'hi {{nope}}' }));

    expect(engine.evaluate({ event: 'bash_command', command: 'danger' })[0].message).toBe('hi {{nope}}');
  });

  it('setVariable updates a variable after construction', () => {
    const engine = new RuleEngine();
    engine.setVariable('allowed_roots', 'D:/work');
    engine.addRule(
      rule({ conditions: [{ field: 'file_path', op: 'not_matches', pattern: '{{allowed_roots}}' }] }),
    );

    expect(engine.evaluate({ event: 'bash_command', file_path: 'D:/work/a.ts' })).toEqual([]);
  });
});

describe('RuleEngine.getBlocks / isAllowed', () => {
  it('separates blocking results from warnings', () => {
    const engine = new RuleEngine();
    engine.addRules([
      rule({ name: 'warner', action: 'warn' }),
      rule({ name: 'blocker', action: 'block' }),
    ]);

    const event = { event: 'bash_command', command: 'danger' } as const;

    expect(engine.evaluate(event)).toHaveLength(2);
    expect(engine.getBlocks(event).map(r => r.rule)).toEqual(['blocker']);
    expect(engine.isAllowed(event)).toBe(false);
  });

  it('allows an event that only trips warnings', () => {
    const engine = new RuleEngine();
    engine.addRule(rule({ action: 'warn' }));

    expect(engine.isAllowed({ event: 'bash_command', command: 'danger' })).toBe(true);
  });
});

describe('CORE_RULES', () => {
  it('are all core-tier, critical, blocking and non-disableable', () => {
    expect(CORE_RULES.length).toBeGreaterThan(0);
    for (const r of CORE_RULES) {
      expect(r.tier).toBe('core');
      expect(r.action).toBe('block');
      expect(r.severity).toBe('critical');
      expect(r.enabled).toBe(true);
      expect(r.override).toEqual({ allow_disable: false, allow_downgrade: false });
      expect(r.conditions.length).toBeGreaterThan(0);
    }
  });

  it('block a write outside the allowed roots and allow one inside', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/Ida-Fozikio*'] });
    engine.addRules(CORE_RULES);

    expect(engine.isAllowed({ event: 'file_write', file_path: 'D:/Ida-Fozikio/a.ts' })).toBe(true);
    expect(engine.isAllowed({ event: 'file_write', file_path: 'C:/Windows/System32/a.dll' })).toBe(false);
  });

  it('block catastrophic shell commands', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/Ida-Fozikio*'] });
    engine.addRules(CORE_RULES);

    for (const command of ['rm -rf /', 'rm -rf ~', 'diskpart', 'mkfs.ext4 /dev/sda1', 'del /s /q C:\\']) {
      expect(engine.isAllowed({ event: 'bash_command', command })).toBe(false);
    }
  });

  it('allow an ordinary shell command', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/Ida-Fozikio*'] });
    engine.addRules(CORE_RULES);

    expect(engine.isAllowed({ event: 'bash_command', command: 'npm run build' })).toBe(true);
    expect(engine.isAllowed({ event: 'bash_command', command: 'git status' })).toBe(true);
  });

  it('block a hardcoded credential in written content', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/Ida-Fozikio*'] });
    engine.addRules(CORE_RULES);

    const blocked = engine.getBlocks({
      event: 'file_write',
      file_path: 'D:/Ida-Fozikio/config.ts',
      content: 'const API_KEY = "sk0123456789abcdefghijklmnop"',
    });

    expect(blocked.map(r => r.rule)).toContain('credential-protection');
  });

  it('do not flag an env-var reference as a hardcoded credential', () => {
    const engine = new RuleEngine({ allowed_roots: ['D:/Ida-Fozikio*'] });
    engine.addRules(CORE_RULES);

    expect(
      engine.isAllowed({
        event: 'file_write',
        file_path: 'D:/Ida-Fozikio/config.ts',
        content: 'const API_KEY = process.env.API_KEY',
      }),
    ).toBe(true);
  });
});
