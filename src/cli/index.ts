#!/usr/bin/env node
/**
 * reflex CLI — validate, test, and inspect safety rules.
 *
 * Usage:
 *   reflex validate <rules-dir>           Validate all YAML rules for correctness
 *   reflex list [rules-dir]               List loaded rules (includes core rules)
 *   reflex test <rules-dir> <event-json>  Test an event against rules
 *   reflex init [dir]                     Scaffold a rules directory with examples
 *   reflex help                           Show this help message
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { RuleEngine } from '../core/rule-engine.js';
import { loadRuleFile, loadRuleDirectory } from '../core/rule-loader.js';
import { CORE_RULES } from '../core/defaults.js';
import type { ReflexRule, ReflexEventData, EvaluationResult } from '../core/types.js';

const HELP = `
reflex — portable guardrails for any agent runtime

Usage:
  reflex validate <rules-dir>                  Validate YAML rules
  reflex list [rules-dir]                      List all rules (core + custom)
  reflex test <rules-dir> <event.json>         Test event against rules
  reflex test <rules-dir> --event <type> [--field value ...]
                                               Test inline event against rules
  reflex init [dir]                            Scaffold example rules directory
  reflex help                                  Show this help

Options:
  --var key=value       Set a template variable (repeatable)
  --json                Output as JSON
  --no-core             Exclude built-in core rules

Examples:
  reflex validate ./rules
  reflex list ./rules --json
  reflex test ./rules --event bash_command --command "rm -rf /"
  reflex test ./rules event.json --var allowed_roots=D:/projects
  reflex init ./my-rules
`.trim();

// --- Helpers ---

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  vars: Record<string, string>;
} {
  const command = argv[0] ?? 'help';
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const vars: Record<string, string> = {};

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--var' && argv[i + 1]) {
      const [key, ...rest] = argv[i + 1]!.split('=');
      if (key) vars[key] = rest.join('=');
      i += 2;
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[name] = next;
        i += 2;
      } else {
        flags[name] = true;
        i += 1;
      }
    } else {
      positionals.push(arg);
      i += 1;
    }
  }

  return { command, positionals, flags, vars };
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

const TIER_BADGE: Record<string, string> = {
  core: '[core]', recommended: '[recommended]', custom: '[custom]',
};

const ACTION_SYMBOL: Record<string, string> = {
  block: 'BLOCK', warn: 'WARN', log: 'LOG',
};

function formatRule(rule: ReflexRule): string {
  const badge = TIER_BADGE[rule.tier] ?? rule.tier;
  const action = ACTION_SYMBOL[rule.action] ?? rule.action;
  const events = rule.events.join(', ');
  const conditions = rule.conditions.map(c => `${c.field} ${c.op} "${c.pattern}"`).join(' AND ');
  const disableable = rule.override.allow_disable ? 'yes' : 'no';

  return [
    `  ${rule.name} ${badge}`,
    `    ${rule.description}`,
    `    Action: ${action} | Severity: ${rule.severity} | Events: ${events}`,
    `    Conditions: ${conditions}`,
    `    Can disable: ${disableable}`,
  ].join('\n');
}

function formatResult(result: EvaluationResult): string {
  const icon = result.action === 'block' ? 'BLOCKED' : result.action === 'warn' ? 'WARNING' : 'LOG';
  return [
    `  [${icon}] ${result.rule} (${result.severity})`,
    `    ${result.message.trim()}`,
    `    Matched: ${result.matched_conditions.join(', ')}`,
  ].join('\n');
}

// --- Commands ---

async function cmdValidate(dir: string, asJson: boolean): Promise<void> {
  const absDir = resolve(dir);
  const { readdir } = await import('node:fs/promises');
  const { extname, join } = await import('node:path');

  const errors: { file: string; error: string }[] = [];
  const valid: { file: string; name: string }[] = [];

  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (extname(entry.name) === '.yaml' || extname(entry.name) === '.yml')) {
        try {
          const rule = await loadRuleFile(fullPath);
          // Validate required fields
          const missing: string[] = [];
          if (!rule.name) missing.push('name');
          if (!rule.events.length) missing.push('events');
          if (!rule.conditions.length) missing.push('conditions');
          if (!rule.message) missing.push('message');

          if (missing.length > 0) {
            errors.push({ file: relative(absDir, fullPath), error: `Missing fields: ${missing.join(', ')}` });
          } else {
            valid.push({ file: relative(absDir, fullPath), name: rule.name });
          }
        } catch (e) {
          errors.push({ file: relative(absDir, fullPath), error: String(e) });
        }
      }
    }
  }

  await walk(absDir);

  if (asJson) {
    console.log(JSON.stringify({ valid: valid.length, errors: errors.length, details: { valid, errors } }, null, 2));
  } else {
    console.log(`\nValidated ${valid.length + errors.length} rule files in ${dir}\n`);
    if (valid.length > 0) {
      console.log(`  ${valid.length} valid:`);
      for (const v of valid) console.log(`    OK  ${v.file} (${v.name})`);
    }
    if (errors.length > 0) {
      console.log(`\n  ${errors.length} errors:`);
      for (const e of errors) console.log(`    ERR ${e.file}: ${e.error}`);
    }
    console.log('');
  }

  process.exit(errors.length > 0 ? 1 : 0);
}

async function cmdList(dir: string | undefined, includeCore: boolean, asJson: boolean): Promise<void> {
  const rules: ReflexRule[] = [];

  if (includeCore) {
    rules.push(...CORE_RULES);
  }

  if (dir) {
    const customRules = await loadRuleDirectory(resolve(dir));
    rules.push(...customRules);
  }

  if (rules.length === 0) {
    console.log('No rules loaded.');
    return;
  }

  // Sort by tier (core first), then severity
  rules.sort((a, b) => {
    const tierOrder = { core: 0, recommended: 1, custom: 2 };
    const td = (tierOrder[a.tier] ?? 2) - (tierOrder[b.tier] ?? 2);
    if (td !== 0) return td;
    return (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4);
  });

  if (asJson) {
    console.log(JSON.stringify(rules, null, 2));
  } else {
    console.log(`\n${rules.length} rules loaded:\n`);
    for (const rule of rules) {
      console.log(formatRule(rule));
      console.log('');
    }
  }
}

async function cmdTest(
  dir: string,
  eventSource: string | undefined,
  flags: Record<string, string | boolean>,
  vars: Record<string, string>,
  includeCore: boolean,
  asJson: boolean,
): Promise<void> {
  // Build the event
  let event: ReflexEventData;

  if (eventSource && !eventSource.startsWith('--')) {
    // It's a file path
    const content = await readFile(resolve(eventSource), 'utf-8');
    event = JSON.parse(content) as ReflexEventData;
  } else {
    // Build from flags
    const eventType = flags['event'];
    if (typeof eventType !== 'string') {
      die('Provide an event JSON file or use --event <type> --field value');
    }
    event = { event: eventType } as ReflexEventData;
    for (const [key, value] of Object.entries(flags)) {
      if (key === 'event' || key === 'json' || key === 'no-core') continue;
      event[key] = value;
    }
  }

  // Load rules
  const engine = new RuleEngine(vars);
  if (includeCore) engine.addRules(CORE_RULES);
  const customRules = await loadRuleDirectory(resolve(dir));
  engine.addRules(customRules);

  // Evaluate
  const results = engine.evaluate(event);
  const blocks = results.filter(r => r.action === 'block');
  const warnings = results.filter(r => r.action === 'warn');
  const logs = results.filter(r => r.action === 'log');

  if (asJson) {
    console.log(JSON.stringify({
      event,
      allowed: blocks.length === 0,
      blocks: blocks.length,
      warnings: warnings.length,
      logs: logs.length,
      results,
    }, null, 2));
  } else {
    console.log(`\nTesting event: ${event.event}`);
    for (const [key, value] of Object.entries(event)) {
      if (key === 'event') continue;
      const display = typeof value === 'string' && value.length > 80 ? value.slice(0, 77) + '...' : value;
      console.log(`  ${key}: ${display}`);
    }
    console.log('');

    if (results.length === 0) {
      console.log('  No rules triggered. Event is allowed.\n');
    } else {
      if (blocks.length > 0) {
        console.log(`  ${blocks.length} BLOCKED:`);
        for (const r of blocks) console.log(formatResult(r));
        console.log('');
      }
      if (warnings.length > 0) {
        console.log(`  ${warnings.length} WARNINGS:`);
        for (const r of warnings) console.log(formatResult(r));
        console.log('');
      }
      if (logs.length > 0) {
        console.log(`  ${logs.length} LOGGED:`);
        for (const r of logs) console.log(formatResult(r));
        console.log('');
      }

      const verdict = blocks.length > 0 ? 'BLOCKED' : 'ALLOWED';
      console.log(`  Verdict: ${verdict}\n`);
    }
  }

  process.exit(blocks.length > 0 ? 2 : 0);
}

async function cmdInit(dir: string): Promise<void> {
  const absDir = resolve(dir);
  await mkdir(absDir, { recursive: true });

  const exampleRule = `name: warn-debug-code
version: 1
tier: recommended
category: quality
description: Warn when debug statements are left in code
events: [file_write, file_edit]
conditions:
  - field: content
    op: regex
    pattern: "(console\\\\.log|debugger|TODO.*HACK)"
action: warn
severity: low
message: "Debug code detected in {{file_path}}"
override:
  allow_disable: true
  allow_downgrade: true
`;

  const blockExample = `name: block-env-commit
version: 1
tier: recommended
category: safety
description: Block writing secrets to .env files that might get committed
events: [file_write]
conditions:
  - field: file_path
    op: regex
    pattern: "\\\\.env$"
  - field: content
    op: regex
    pattern: "(API_KEY|SECRET|TOKEN|PASSWORD)\\\\s*=\\\\s*[^$]"
action: block
severity: high
message: "Potential secret in {{file_path}} — use environment variables instead"
override:
  allow_disable: true
  allow_downgrade: true
`;

  await writeFile(resolve(absDir, 'warn-debug-code.yaml'), exampleRule);
  await writeFile(resolve(absDir, 'block-env-commit.yaml'), blockExample);

  console.log(`\nInitialized reflex rules directory: ${dir}\n`);
  console.log('  Created:');
  console.log('    warn-debug-code.yaml   (recommended, quality)');
  console.log('    block-env-commit.yaml  (recommended, safety)');
  console.log('');
  console.log('  Next steps:');
  console.log('    reflex validate ' + dir);
  console.log('    reflex list ' + dir);
  console.log('    reflex test ' + dir + ' --event file_write --file_path app.ts --content "console.log(x)"');
  console.log('');
}

// --- Main ---

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const { command, positionals, flags, vars } = parseArgs(args);
  const asJson = flags['json'] === true;
  const includeCore = flags['no-core'] !== true;

  switch (command) {
    case 'validate': {
      const dir = positionals[0];
      if (!dir) die('Usage: reflex validate <rules-dir>');
      await cmdValidate(dir, asJson);
      break;
    }

    case 'list': {
      const dir = positionals[0];
      await cmdList(dir, includeCore, asJson);
      break;
    }

    case 'test': {
      const dir = positionals[0];
      if (!dir) die('Usage: reflex test <rules-dir> [event.json] [--event <type> --field value]');
      const eventSource = positionals[1];
      await cmdTest(dir, eventSource, flags, vars, includeCore, asJson);
      break;
    }

    case 'init': {
      const dir = positionals[0] ?? './reflex-rules';
      await cmdInit(dir);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;

    default:
      die(`Unknown command: ${command}. Run "reflex help" for usage.`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
