# Reflex

**Portable guardrails for any agent runtime.**

Safety rules as data, not code. Define what your agent can and can't do in YAML, and Reflex enforces it -- across Claude Code, MCP servers, Cursor, or any runtime with an adapter.

## Why Reflex

Agent safety shouldn't be hardcoded into a single platform's hook system. Reflex separates **what** the rules are from **where** they run:

- **Rules are YAML files.** Readable, versionable, shareable.
- **Core rules can't be disabled.** Tier enforcement prevents agents from weakening their own guardrails.
- **One rule set, many runtimes.** Write rules once, enforce them everywhere your agent operates.

## Install

```bash
npm install @fozikio/reflex
```

## Quick Start

```typescript
import { RuleEngine, CORE_RULES, loadRuleDirectory } from '@fozikio/reflex';

// Initialize with core safety rules
const engine = new RuleEngine({ allowed_roots: 'D:/projects, /home/user' });
engine.addRules(CORE_RULES);

// Load custom rules from YAML files
const customRules = await loadRuleDirectory('./rules');
engine.addRules(customRules);

// Evaluate an event
const results = engine.evaluate({
  event: 'file_write',
  file_path: '/etc/passwd',
  content: 'something dangerous',
});

// Check if an action is allowed
if (!engine.isAllowed({ event: 'bash_command', command: 'rm -rf /' })) {
  console.log('Blocked by reflex');
}
```

## Rule Format

Rules are YAML files with a flat, declarative structure:

```yaml
name: block-dangerous-rm
version: 1
tier: core
category: safety
description: Block catastrophic shell commands
events: [bash_command]
conditions:
  - field: command
    op: regex
    pattern: 'rm\s+-rf\s+[/~.]'
action: block
severity: critical
message: "Destructive command blocked: {{command}}"
override:
  allow_disable: false
  allow_downgrade: false
```

### Rule Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique rule identifier |
| `version` | number | Rule version (for evolution tracking) |
| `tier` | `core` \| `recommended` \| `custom` | Enforcement tier |
| `category` | `safety` \| `quality` \| `style` \| `cognitive` | Rule category |
| `description` | string | Human-readable description |
| `events` | array | Events that trigger evaluation |
| `conditions` | array | All must match for rule to trigger |
| `action` | `block` \| `warn` \| `log` | What happens when triggered |
| `severity` | `critical` \| `high` \| `medium` \| `low` \| `info` | Severity level |
| `message` | string | Message shown when triggered (supports `{{var}}` templates) |
| `override` | object | Whether the rule can be disabled or downgraded |

### Events

| Event | Triggers on |
|-------|-------------|
| `bash_command` | Shell command execution |
| `file_write` | New file creation |
| `file_edit` | Existing file modification |
| `file_delete` | File deletion |
| `prompt_submit` | User prompt submission |
| `session_stop` | Agent session ending |
| `tool_call` | Any tool invocation |
| `post_tool` | After a tool completes |
| `any` | All events |

### Condition Operators

| Operator | Behavior |
|----------|----------|
| `matches` | Glob-style matching (comma-separated patterns, `*` wildcards) |
| `not_matches` | Inverse of matches |
| `contains` | Substring check |
| `not_contains` | Inverse of contains |
| `equals` | Exact string match |
| `not_equals` | Inverse of equals |
| `starts_with` | Prefix check |
| `ends_with` | Suffix check |
| `regex` | Full regex match |

### Template Variables

Rule messages and condition patterns support `{{variable}}` templates. Variables are set at engine initialization and can reference event data:

```typescript
const engine = new RuleEngine({
  allowed_roots: 'D:/projects, /home/user',
  owner: 'idapixl',
});
```

```yaml
message: "Write blocked: {{file_path}} is outside {{allowed_roots}}"
```

## Tier Enforcement

Rules have three tiers with different enforcement guarantees:

| Tier | Can disable? | Can downgrade? | Use case |
|------|-------------|----------------|----------|
| `core` | No | No | Safety invariants (write boundaries, destructive command blocking) |
| `recommended` | Yes | Yes | Best practices (credential checks, style rules) |
| `custom` | Yes | Yes | User-defined rules |

Core rules ship with the package and cannot be weakened by configuration:

```typescript
import { CORE_RULES } from '@fozikio/reflex';
// write-boundary, destructive-commands, path-traversal, credential-protection
```

## API

### `RuleEngine`

```typescript
const engine = new RuleEngine(variables?: Record<string, string | string[]>);

engine.addRule(rule: ReflexRule): void;
engine.addRules(rules: ReflexRule[]): void;
engine.setVariable(key: string, value: string | string[]): void;

// Returns all triggered rules
engine.evaluate(event: ReflexEventData): EvaluationResult[];

// Returns only blocking results
engine.getBlocks(event: ReflexEventData): EvaluationResult[];

// Returns true if no blocking rules trigger
engine.isAllowed(event: ReflexEventData): boolean;
```

### `loadRuleFile` / `loadRuleDirectory`

```typescript
// Load a single YAML rule
const rule = await loadRuleFile('./rules/my-rule.yaml');

// Load all .yaml/.yml files from a directory (recursive)
const rules = await loadRuleDirectory('./rules', config?);
```

The optional `ReflexConfig` lets you disable specific rules by name (respecting tier enforcement):

```typescript
const config: ReflexConfig = {
  allowed_roots: ['D:/projects'],
  disabled_rules: ['warn-debug-code'],  // only works for recommended/custom tier
  rule_dirs: ['./rules', './extra-rules'],
};
```

## Background

Reflex is the successor to [Hookify](https://github.com/anthropics/claude-code-plugins), a Claude Code plugin that used markdown files with YAML frontmatter for hook rules. Reflex takes the same idea -- rules as data -- and makes it portable, typed, and enforceable across any agent runtime.

Part of the [Fozikio](https://github.com/Fozikio) agent toolkit.

## License

MIT
