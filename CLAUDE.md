# reflex

Portable guardrails for any agent runtime — safety rules as data, not code. Published as `@fozikio/reflex`.

## Commands

```bash
npm run build        # tsc → dist/
npm run dev          # tsc --watch
npm run test         # vitest run
npx reflex validate  # Validate rule files
npx reflex list      # List loaded rules
npx reflex test      # Run rule tests
npx reflex init      # Scaffold new rule file
```

## Architecture

```
src/
├── cli/            # CLI commands (validate, list, test, init)
├── core/
│   ├── rule-engine.ts   # Rule evaluation engine (supports cognitive rules)
│   └── rule-loader.ts   # YAML rule file discovery and parsing
└── index.ts        # Main entry
rules/
├── cognitive/      # Cognitive rule definitions (correction-capture, etc.)
└── ...             # Additional rule categories
```

## Key Patterns

- Rules are YAML files — no code needed to define guardrails
- Rule loader discovers rules from `rules/` directory tree
- ESM only, Target: ES2022, Module: NodeNext
- Strict TypeScript — same settings as cortex-engine
- Single dependency: `yaml` for rule parsing
