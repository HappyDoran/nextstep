import { test } from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import preset from '../dist/tailwind-preset.js';

const raw = 'text-body text-foreground size-icon-md stroke-icon focus-visible:outline-focus focus-visible:outline-ring duration-fast ease-out animate-spin motion-reduce:animate-none';
const result = await postcss([tailwindcss({ presets: [preset], content: [{ raw }], corePlugins: { preflight: false } })]).process('@tailwind utilities;', { from: undefined });
const declarationsFor = selector => {
  const values = {};
  result.root.walkRules(selector, rule => rule.walkDecls(({ prop, value }) => { values[prop] = value; }));
  return values;
};

test('타입 역할은 크기·줄간격·굵기·자간을 함께 생성하고 글자색과 공존한다', () => {
  const body = declarationsFor('.text-body');
  for (const property of ['font-size', 'line-height', 'font-weight', 'letter-spacing']) assert.ok(body[property], `본문 타입의 ${property} 누락`);
  assert.ok(declarationsFor('.text-foreground').color);
});
test('아이콘·포커스·모션 유틸리티가 CSS 토큰을 소비한다', () => {
  const size = declarationsFor('.size-icon-md');
  assert.equal(size.width, size.height);
  assert.match(size.width, /var\(--ns-icon-size-md\)/);
  assert.match(declarationsFor('.stroke-icon')['stroke-width'], /var\(--ns-icon-stroke-width\)/);
  assert.match(declarationsFor('.duration-fast')['transition-duration'], /var\(--ns-duration-fast\)/);
  assert.match(declarationsFor('.ease-out')['transition-timing-function'], /var\(--ns-ease-out\)/);
  let reducesMotion = false;
  result.root.walkAtRules('media', media => {
    if (media.params === '(prefers-reduced-motion: reduce)') media.walkDecls('animation', declaration => { if (declaration.value === 'none') reducesMotion = true; });
  });
  assert.equal(reducesMotion, true);
});
