import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, matches } from '../dist/recommend/classify.js';

// 규칙 분류만 확인한다(모델 호출 없음). 합성 지원자·공고.
const at = '2026-11-07T09:00:00+09:00';
const seeker = { jobFamilies: ['프론트엔드'], regions: ['서울'], remoteOk: true };
const cand = { careers: [{ family: '프론트엔드', months: 36, stack: ['React', 'TypeScript'] }, { family: 'QA', months: 12, stack: [] }], skills: ['React Native'], experiences: ['디자인 시스템', '사용성 테스트'], roles: [], education: '대졸' };
const base = { families: ['프론트엔드'], required: [], preferred: [], careers: [{ type: 'EXPERIENCED', fromYears: 2, toYears: null }], location: '서울 강남구', remote: '없음', deadline: '2026-12-01T23:59:59+09:00', alwaysHire: false, companyType: '중소기업', bodyNote: null };
const req = (type, keys, extra = {}) => ({ text: keys.join(' 또는 '), type, keys, years: null, practical: false, ...extra });
const run = p => classify(at, seeker, cand, { ...base, ...p }).classification;

test('제외 > 도전 > 미확인 > 기본 순으로 분류한다', () => {
  assert.equal(run({}), '기본');
  assert.equal(run({ families: ['백엔드'] }), '제외');
  assert.equal(run({ families: ['기타'] }), '제외');
  assert.equal(run({ deadline: '2026-11-07T08:59:00+09:00' }), '제외');
  assert.equal(run({ location: '경기 성남시', remote: '부분' }), '제외');
  assert.equal(run({ location: '부산', remote: '전면' }), '기본');
  assert.equal(run({ location: null, remote: null }), '미확인');
  // 총 경력 4년이어도 직무 경력 3년이면 요구 4년에 도전. 같은 공고에 마감이 지났으면 제외가 우선.
  assert.equal(run({ careers: [{ type: 'EXPERIENCED', fromYears: 4, toYears: null }] }), '도전');
  assert.equal(run({ careers: [{ type: 'EXPERIENCED', fromYears: 4, toYears: null }], deadline: '2026-11-01T00:00:00+09:00' }), '제외');
  assert.equal(run({ careers: [{ type: 'NEWBIE', fromYears: null, toYears: null }, { type: 'EXPERIENCED', fromYears: 5, toYears: null }] }), '기본');
});

test('필수 조건 종류별 규칙: 실무 기술·다른 성격 경력·서류 미기재·포트폴리오', () => {
  assert.equal(run({ required: [req('skill', ['Vue'], { practical: true, years: 2 })] }), '제외');
  assert.equal(run({ required: [req('skill', ['React Native'], { practical: true, years: 1 })] }), '제외', '사이드 프로젝트 기술은 실무가 아님');
  // 연차 없이 '실무'만 붙은 기술(작은 모델이 자주 붙임)은 보유 기술이면 충족, 없으면 미확인으로 본다.
  assert.equal(run({ required: [req('skill', ['React Native'], { practical: true })] }), '기본');
  assert.equal(classify(at, seeker, { ...cand, text: '결제 화면 UI 개선과 QA 협업' }, { ...base, required: [req('experience', ['UI'])] }).classification, '미확인', '세 글자 미만 키는 원문 대조 안 함');
  assert.equal(classify(at, seeker, { ...cand, text: '웹 접근성 개선 프로젝트 리딩' }, { ...base, required: [req('experience', ['웹 접근성'])] }).classification, '기본');
  assert.equal(run({ title: '가상그룹 사업기획 담당', families: ['기획'] }), '제외');
  assert.equal(run({ required: [req('skill', ['React'], { practical: true, years: 4 })] }), '도전');
  assert.equal(run({ required: [req('skill', ['ReactJS'], { practical: true }), req('skill', ['TS'])] }), '기본');
  assert.equal(run({ required: [req('skill', ['RxJS'])] }), '미확인');
  assert.equal(run({ required: [req('career', ['UX 리서치'], { years: 2, practical: true })] }), '제외');
  assert.equal(run({ required: [req('career', ['프론트엔드'], { years: 4, practical: true })] }), '도전');
  assert.equal(run({ required: [req('experience', ['사용성 테스트', '사용자 조사'])] }), '기본');
  assert.equal(run({ required: [req('experience', ['웹 접근성'])] }), '미확인');
  assert.equal(run({ required: [req('portfolio', ['포트폴리오'])] }), '미확인');
  assert.equal(run({ required: null, bodyNote: '본문 조건 미확인(body_image_only)' }), '미확인');
});

test('기술 이름은 정확히, 한글 업무 경험은 포함 관계로 맞춘다', () => {
  assert.equal(matches(['React'], ['React Native']), false);
  assert.equal(matches(['Next.js'], ['NextJS']), true);
  assert.equal(matches(['앱 서비스 기획'], ['서비스 기획']), true);
  assert.equal(matches(['UI'], ['UI/UX']), false);
  assert.equal(matches(['이슈 리포팅'], ['결함(이슈) 리포팅']), true);
});

test('작은 모델 보정: 조건 원문의 기술 실무 연차·직무 이름·기본 업무로 판정한다', () => {
  // 모델이 "Vue.js 실무 경력 2년 이상"을 직무 경력(키: 프론트엔드)으로 잘못 분류해도 원문으로 기술 실무 요구로 본다.
  assert.equal(run({ required: [{ text: 'Vue.js 실무 경력 2년 이상', type: 'career', keys: ['프론트엔드'], years: 2, practical: true }] }), '제외');
  // 직무·역할 이름(QA)은 기술로 보지 않고, 깨진 키('프론트엔:엔드')라도 원문의 직무 이름으로 같은 직무 경력 부족(도전)으로 본다.
  assert.equal(run({ required: [{ text: '프론트엔드 경력 4년 이상', type: 'career', keys: ['프론트엔:엔드'], years: 4, practical: true }] }), '도전');
  // 경력이 있는 직무의 기본 업무·기본기는 서류에 없어도 갖춘 것으로 본다(프론트엔드 3년 → HTML·Git).
  assert.equal(run({ required: [req('skill', ['HTML']), req('skill', ['Git'])] }), '기본');
  // 원문의 영문 기술명이 모두 보유 기술이면 충족(React·TypeScript 운영 경험).
  assert.equal(run({ required: [req('experience', ['서비스 운영'], { text: 'React·TypeScript 기반 서비스 운영 경험' })] }), '기본');
  assert.equal(run({ title: '가상데이터 데이터 엔지니어', families: ['백엔드'] }), '제외');
});
