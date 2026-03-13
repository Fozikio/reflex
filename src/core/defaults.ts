import type { ReflexRule } from './types.js';

/** Core safety rules — hardcoded, non-disableable, ship with every agent. */
export const CORE_RULES: ReflexRule[] = [
  {
    name: 'write-boundary',
    version: 1,
    tier: 'core',
    category: 'safety',
    description: 'Block file writes outside allowed locations',
    events: ['file_write', 'file_edit'],
    conditions: [
      { field: 'file_path', op: 'not_matches', pattern: '{{allowed_roots}}' },
    ],
    action: 'block',
    severity: 'critical',
    message: 'Write boundary violation: {{file_path}} is outside allowed roots ({{allowed_roots}})',
    override: { allow_disable: false, allow_downgrade: false },
    enabled: true,
  },
  {
    name: 'destructive-commands',
    version: 1,
    tier: 'core',
    category: 'safety',
    description: 'Block catastrophic shell commands',
    events: ['bash_command'],
    conditions: [
      {
        field: 'command',
        op: 'regex',
        pattern: '(rm\\s+-rf\\s+[/~.]|format\\s|diskpart|fdisk|mkfs|del\\s+/s\\s+/q)',
      },
    ],
    action: 'block',
    severity: 'critical',
    message: 'Destructive command blocked: {{command}}',
    override: { allow_disable: false, allow_downgrade: false },
    enabled: true,
  },
  {
    name: 'path-traversal',
    version: 1,
    tier: 'core',
    category: 'safety',
    description: 'Block delete commands with tilde or parent traversal in paths',
    events: ['bash_command', 'file_delete'],
    conditions: [
      { field: 'command', op: 'regex', pattern: '(rm|del|Remove-Item).*[~]|\\.\\.' },
    ],
    action: 'block',
    severity: 'critical',
    message: 'Path traversal in delete command blocked: {{command}}',
    override: { allow_disable: false, allow_downgrade: false },
    enabled: true,
  },
  {
    name: 'credential-protection',
    version: 1,
    tier: 'core',
    category: 'safety',
    description: 'Block hardcoded secrets in source files',
    events: ['file_write', 'file_edit'],
    conditions: [
      {
        field: 'content',
        op: 'regex',
        pattern: '(API_KEY|SECRET|TOKEN|PASSWORD)\\s*=\\s*["\'][A-Za-z0-9]{20,}',
      },
    ],
    action: 'block',
    severity: 'critical',
    message: 'Potential hardcoded credential detected in {{file_path}}',
    override: { allow_disable: false, allow_downgrade: false },
    enabled: true,
  },
];
