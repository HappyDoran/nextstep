import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const primitives = read('primitives.css');
const semantics = read('tokens.css');
const declarations = source => Object.fromEntries([...source.matchAll(/(--ns-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
const blocks = [...semantics.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({ selectors, values: declarations(body) }));
const valuesFor = mode => Object.assign({}, declarations(primitives), ...blocks.filter(({ selectors }) => selectors.includes(`data-ns-theme="${mode}"`) || (selectors.includes(':root') && !selectors.includes('data-ns-theme'))).map(({ values }) => values));
const base = valuesFor('light');
const dark = valuesFor('dark');
function resolve(name, values, visited = new Set()) {
  assert.ok(!visited.has(name), `토큰 순환: ${name}`);
  assert.ok(name in values, `정의되지 않은 토큰: ${name}`);
  const next = new Set(visited).add(name);
  return values[name].replace(/var\((--ns-[\w-]+)\)/g, (_, ref) => resolve(ref, values, next));
}
// WCAG의 sRGB 상대 휘도 계산으로 텍스트/배경 조합을 확인한다.
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  const channels = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(first, second) {
  const [a, b] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (a + 0.05) / (b + 0.05);
}
test('제품 CSS·Tailwind의 토큰 참조는 존재하며 순환하지 않는다', () => {
  for (const values of [base, dark]) {
    for (const name of Object.keys(values)) resolve(name, values);
    for (const source of [read('styles.css'), read('tailwind-preset.ts')]) {
      for (const [, name] of source.matchAll(/var\((--ns-[\w-]+)\)/g)) resolve(name, values);
    }
  }
});
test('Light·Dark의 본문·피드백은 4.5:1, 포커스는 3:1 이상이다', () => {
  for (const [mode, values] of [['light', base], ['dark', dark]]) {
    const ratio = (text, bg) => contrast(resolve(`--ns-color-${text}`, values), resolve(`--ns-color-${bg}`, values));
    for (const bg of ['background', 'card', 'muted']) {
      for (const text of ['foreground', 'muted-foreground']) assert.ok(ratio(text, bg) >= 4.5, `${mode}: ${text}/${bg}`);
      assert.ok(ratio('ring', bg) >= 3, `${mode}: ring/${bg}`);
    }
    for (const action of ['primary', 'action-hover', 'action-active']) assert.ok(ratio('primary-foreground', action) >= 4.5, `${mode}: ${action}`);
    for (const role of ['success', 'warning', 'destructive', 'info']) assert.ok(ratio(role, `${role}-muted`) >= 4.5, `${mode}: ${role} muted`);
    for (const role of ['primary', 'destructive', 'success', 'warning']) assert.ok(ratio(`${role}-foreground`, role) >= 4.5, `${mode}: ${role} fill`);
    for (const role of ['card', 'popover', 'secondary', 'accent']) assert.ok(ratio(`${role}-foreground`, role) >= 4.5, `${mode}: ${role} surface`);
    assert.ok(ratio('highlight', 'highlight-muted') >= 4.5, `${mode}: highlight`);
  }
});
