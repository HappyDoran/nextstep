import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 추천 정답 사례의 구조만 검사한다. 모델 제공자가 정해지면 같은 사례로 출력 분류를 비교한다.
const data = JSON.parse(readFileSync(new URL('./recommendation-cases.json', import.meta.url), 'utf8'));
const CLASSES = ['기본', '도전', '미확인', '제외'];
const FAMILIES = ['프론트엔드', '앱 개발'];
const MIN_PER_FAMILY = 8;
const CAREER_TYPES = ['NEWBIE', 'EXPERIENCED', 'ANY'];
const REMOTE = ['전면', '부분', '없음', null];
const isStrings = v => Array.isArray(v) && v.every(s => typeof s === 'string' && s.length > 0);
const nullableYears = v => v === null || (Number.isInteger(v) && v >= 0);

test('기준 시각과 프로필이 유효하다', () => {
  assert.ok(!Number.isNaN(Date.parse(data.evaluatedAt)));
  const ids = data.profiles.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, '프로필 ID 중복');
  for (const p of data.profiles) {
    assert.ok(Number.isInteger(p.totalCareerMonths) && p.totalCareerMonths >= 0, p.id);
    assert.ok(isStrings(p.skills) && isStrings(p.experiences) && isStrings(p.locations), p.id);
    assert.ok(p.desiredFamilies.length > 0 && p.desiredFamilies.every(f => FAMILIES.includes(f)), p.id);
    for (const r of p.roleCareers) assert.ok(typeof r.family === 'string' && Number.isInteger(r.months) && isStrings(r.stack), p.id);
  }
});

test('사례마다 필수 필드·분류 값·직무 값이 유효하고 ID가 중복되지 않는다', () => {
  const profiles = new Set(data.profiles.map(p => p.id));
  const ids = data.cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, '사례 ID 중복');
  for (const c of data.cases) {
    const { posting: p, expected: e } = c;
    assert.ok(FAMILIES.includes(c.jobFamily), `${c.id} 직무`);
    assert.ok(profiles.has(c.profileId), `${c.id} 프로필`);
    assert.ok(isStrings(c.tags), `${c.id} tags`);
    assert.ok(p.title && p.company, `${c.id} 제목·회사`);
    assert.ok(p.deadline === null || !Number.isNaN(Date.parse(p.deadline)), `${c.id} 마감`);
    assert.equal(typeof p.alwaysHire, 'boolean', `${c.id} 상시채용`);
    assert.ok(p.alwaysHire || p.deadline !== null, `${c.id} 마감 없음이면 상시채용`);
    assert.ok(isStrings(p.workFields) && p.workFields.length > 0, `${c.id} 직무 분야`);
    assert.ok(p.careers.length > 0, `${c.id} 경력`);
    for (const k of p.careers) assert.ok(CAREER_TYPES.includes(k.type) && nullableYears(k.fromYears) && nullableYears(k.toYears), `${c.id} 경력 형식`);
    for (const k of ['required', 'preferred', 'unstated']) assert.ok(Array.isArray(p.conditions[k]) && (p.conditions[k].length === 0 || isStrings(p.conditions[k])), `${c.id} ${k}`);
    assert.ok(p.location === null || typeof p.location === 'string', `${c.id} 근무지`);
    assert.ok(REMOTE.includes(p.remote), `${c.id} 원격`);
    assert.ok(p.companyType === null || typeof p.companyType === 'string', `${c.id} 기업 유형`);
    assert.ok(p.employeeCount === null || (Number.isInteger(p.employeeCount) && p.employeeCount > 0), `${c.id} 직원 수(0은 null)`);
    assert.ok(CLASSES.includes(e.classification), `${c.id} 분류`);
    for (const k of ['met', 'unmet', 'unknown']) assert.ok(Array.isArray(e[k]) && (e[k].length === 0 || isStrings(e[k])), `${c.id} ${k}`);
    // 근거 없는 분류를 막는다: 제외·도전은 미충족, 미확인은 미확인 근거가 있어야 한다.
    if (e.classification === '제외' || e.classification === '도전') assert.ok(e.unmet.length > 0, `${c.id} 미충족 근거`);
    if (e.classification === '미확인') assert.ok(e.unknown.length > 0 && e.unmet.length === 0, `${c.id} 미확인 근거`);
    if (e.classification === '기본') assert.equal(e.unmet.length, 0, `${c.id} 기본인데 미충족`);
  }
});

test('직무마다 최소 사례 수와 주입 사례가 있다', () => {
  for (const f of FAMILIES) {
    const cases = data.cases.filter(c => c.jobFamily === f);
    assert.ok(cases.length >= MIN_PER_FAMILY, `${f} ${cases.length}건`);
    const injected = cases.filter(c => c.tags.includes('주입'));
    assert.ok(injected.length > 0, `${f} 주입 사례`);
    for (const c of injected) assert.ok(c.posting.body && isStrings(c.expected.mustIgnore), `${c.id} 주입 본문·무시 근거`);
  }
});
