import { readFileSync, readdirSync, lstatSync, readlinkSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import ts from 'typescript';

export const graph = {
  'apps/web': ['@nextstep/contracts', '@nextstep/design-system'],
  'apps/server': ['@nextstep/contracts'],
  'apps/desktop': [],
  'packages/contracts': [],
  'packages/design-system': [],
};
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// 내부 패키지의 subpath는 해당 package.json exports에 공개된 경로만 허용한다.
function isExported(name, value) {
  if (value === name) return true;
  const manifest = join(repoRoot, 'packages', name.split('/')[1], 'package.json');
  return existsSync(manifest) && Object.hasOwn(JSON.parse(readFileSync(manifest, 'utf8')).exports ?? {}, `.${value.slice(name.length)}`);
}
const serverRuntime = new Set([...builtinModules, 'electron', 'fastify']);
export function dependencyErrors(owner, dependencies) {
  return Object.keys(dependencies).filter(name => name.startsWith('@nextstep/') && !graph[owner]?.includes(name)).map(name => `${owner}: 허용하지 않는 의존 ${name}`);
}
export function importErrors(owner, filename, source) {
  const errors = [];
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const check = value => {
    if (value.startsWith('.')) {
      const target = resolve(dirname(filename), value);
      const boundary = resolve(owner);
      if (target !== boundary && !target.startsWith(boundary + '/')) errors.push(`${filename}: workspace 밖 상대 참조 ${value}`);
    }
    if (value.startsWith('@nextstep/')) {
      const name = value.split('/').slice(0, 2).join('/');
      if (!graph[owner]?.includes(name) || !isExported(name, value)) errors.push(`${filename}: 허용하지 않는 내부 참조 ${value}`);
    }
    if ((owner.startsWith('packages/') || owner === 'apps/web') && (value.startsWith('node:') || serverRuntime.has(value.split('/')[0]))) errors.push(`${filename}: 런타임 경계 위반 ${value}`);
  };
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) check(arg.text);
      else errors.push(`${filename}: 동적 모듈 경로를 검토해야 합니다.`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return errors;
}
const ignored = new Set(['node_modules', '.git', '.next', '.turbo', 'dist', 'storybook-static', 'playwright-report', 'test-results', '.data']);
function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    if (ignored.has(name)) return [];
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    return stat.isDirectory() ? walk(path) : [path];
  });
}
export function checkRepository(root) {
  const errors = [];
  for (const [owner] of Object.entries(graph)) {
    const manifest = JSON.parse(readFileSync(join(root, owner, 'package.json'), 'utf8'));
    errors.push(...dependencyErrors(owner, { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies }));
    for (const path of walk(join(root, owner, 'src'))) {
      if (/\.[cm]?[jt]sx?$/.test(path)) errors.push(...importErrors(owner, relative(root, path), readFileSync(path, 'utf8')));
    }
  }
  const expectedLinks = ['CLAUDE.md', ...Object.keys(graph).map(owner => `${owner}/CLAUDE.md`)];
  for (const name of readdirSync(join(root, '.codex/skills'))) expectedLinks.push(`.claude/skills/${name}/SKILL.md`);
  for (const path of expectedLinks) {
    const canonical = path.startsWith('.claude/') ? path.replace('.claude/', '.codex/') : path.replace('CLAUDE.md', 'AGENTS.md');
    const absolute = join(root, path);
    if (!existsSync(absolute) || !lstatSync(absolute).isSymbolicLink() || resolve(dirname(absolute), readlinkSync(absolute)) !== resolve(root, canonical)) errors.push(`${path}: canonical symlink가 필요합니다.`);
  }
  for (const path of walk(root)) {
    if (extname(path) !== '.md') continue;
    const source = readFileSync(path, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of source.matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const local = decodeURIComponent(target.split('#')[0]);
      if (!existsSync(resolve(dirname(path), local))) errors.push(`${relative(root, path)}: 깨진 문서 링크 ${target}`);
    }
  }
  const tracked = spawnSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' });
  if (tracked.status !== 0) errors.push('Git 추적 파일을 확인하지 못했습니다.');
  for (const path of (tracked.stdout ?? '').split('\0').filter(Boolean)) {
    if (/(^|\/)(\.env(?:\..*)?|\.data|uploads|\.private)(\/|$)/.test(path) && !path.endsWith('.env.example')) errors.push(`${path}: 비공개 파일 추적 금지`);
    if (/\.(db|sqlite|sqlite3)(-|$)/.test(path) || /(^|\/)LLM_REPORT\.md$/i.test(path)) errors.push(`${path}: 금지 파일 추적`);
  }
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkRepository(process.cwd());
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.info('구조·의존 경계·symlink·문서 링크·추적 파일 검사 통과');
}
