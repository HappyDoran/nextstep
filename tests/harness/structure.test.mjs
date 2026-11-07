import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dependencyErrors, frontmatterErrors, importErrors, parseFrontmatter } from '../../scripts/check-structure.mjs';
test('서버에서 UI 의존을 차단하고 웹의 공통 계약 소비는 허용한다', () => {
  assert.equal(dependencyErrors('apps/server', { '@nextstep/design-system': 'workspace:*' }).length, 1);
  assert.deepEqual(dependencyErrors('apps/web', { '@nextstep/contracts': 'workspace:*' }), []);
});
test('정적·동적·재수출 경로에서 workspace 탈출과 src 참조를 거부한다', () => {
  for (const source of ["import x from '../../server/src/app.js'", "export * from '@nextstep/contracts/src/index'", "await import('@nextstep/server')", "require('node:fs')", "import fs from 'fs'", "require('child_process')", "import x from 'fastify/types/instance'", "import x from '@nextstep/design-system/missing'", "import(path)"]) {
    assert.ok(importErrors('apps/web', 'apps/web/src/test.ts', source).length > 0, source);
  }
  assert.deepEqual(importErrors('apps/server', 'apps/server/src/app.ts', "import { openDatabase } from './database.js'"), []);
  assert.deepEqual(importErrors('apps/web', 'apps/web/src/test.ts', "import { healthSchema } from '@nextstep/contracts'"), []);
  assert.deepEqual(importErrors('apps/web', 'apps/web/src/test.ts', "import preset from '@nextstep/design-system/tailwind-preset'"), []);
});
test('규범 문서·skill·agent frontmatter 누락과 이름 불일치를 잡는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-'));
  try {
    writeFileSync(join(root, 'AGENTS.md'), '---\ntitle: 규범\nkind: rule\nlast_verified: 2026-01-01\n---\n# 규범\n');
    writeFileSync(join(root, 'TECH_RULES.md'), '---\ntitle: 기술\nkind: 메모\nlast_verified: 2026-01-01\n---\n');
    mkdirSync(join(root, 'docs/spec'), { recursive: true });
    writeFileSync(join(root, 'docs/spec/a.md'), '# frontmatter 없음\n');
    mkdirSync(join(root, '.codex/skills/good'), { recursive: true });
    writeFileSync(join(root, '.codex/skills/good/SKILL.md'), '---\nname: other\ndescription: 설명\n---\n');
    mkdirSync(join(root, '.codex/agents'));
    writeFileSync(join(root, '.codex/agents/x-planner.md'), '---\nname: x-planner\ndescription: 기획\ntools: Read\n---\n');
    const errors = frontmatterErrors(root);
    assert.equal(errors.length, 4, errors.join('\n'));
    assert.deepEqual(parseFrontmatter('---\nname: a\n---\n'), { name: 'a' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
