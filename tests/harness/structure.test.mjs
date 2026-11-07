import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyErrors, importErrors } from '../../scripts/check-structure.mjs';
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
