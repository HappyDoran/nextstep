import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, matches, norm } from '../dist/recommend/classify.js';

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

test('직무 없이 지원 자격만 말하는 필수 문구는 다른 직무 경력으로 제외하지 않는다(2026-11-15 실제 흐름)', () => {
  for (const text of ['신입 가능', '경력무관', '신입 / 경력 3년 이하', '신입·주니어도 지원할 수 있습니다.', '2026년 11월 수시채용', '경력 2년 이상']) {
    assert.equal(run({ required: [{ text, type: 'career', keys: [text], years: null, practical: false }] }), '기본', text);
  }
  assert.equal(run({ required: [{ text: '경력: 2년 이상', type: 'career', keys: ['경력'], years: 2, practical: false }] }), '기본');
  assert.equal(run({ required: [{ text: '경력 3년 이하', type: 'experience', keys: ['경력'], years: null, practical: false }] }), '기본');
  // 실제 이력서 확인(2026-11-15): 신입이 들어간 범위·상한, 학력무관, 동일경력 범위.
  for (const [text, type] of [['Android 개발 신입/경력 1~3년(회사 근무 경력)', 'career'], ['경력: 신입/ 경력 ( ~3 년 이하)', 'career'], ['경력 : 신입·경력', 'career'], ['학력무관', 'skill'], ['동일경력 2~3년차', 'career']]) {
    assert.equal(run({ required: [{ text, type, keys: [text], years: null, practical: false }] }), '기본', text);
  }
  assert.equal(run({ required: [{ text: '동일경력 5~7년차', type: 'career', keys: ['동일경력'], years: null, practical: false }] }), '도전');
  assert.equal(run({ required: [{ text: '경력 5년 이상', type: 'career', keys: ['경력'], years: 5, practical: false }] }), '도전');
  // 직무가 붙은 다른 성격 경력은 그대로 제외.
  assert.equal(run({ required: [{ text: '정보보호 경력 3년 이하', type: 'career', keys: ['정보보호'], years: null, practical: false }] }), '제외');
  // 조사: 3년으로, 0년으로, 6개월로
  const reason = c => classify(at, seeker, { ...cand, careers: c }, { ...base, careers: [{ type: 'EXPERIENCED', fromYears: 4, toYears: null }] }).reason;
  assert.equal(reason(cand.careers), '직무 경력 3년으로 요구 4년보다 부족');
  // 제외 사유는 제외를 만든 항목(앞선 도전 항목이 아님).
  const j = classify(at, seeker, cand, { ...base, careers: [{ type: 'EXPERIENCED', fromYears: 4, toYears: null }], required: [{ text: '보안 솔루션 개발', type: 'career', keys: ['보안 솔루션'], years: null, practical: false }] });
  assert.deepEqual([j.classification, j.reason], ['제외', '필수 보안 솔루션 개발 없음(유사 경험으로 대체하지 않음)']);
  assert.equal(reason([{ family: '프론트엔드', months: 30, stack: [] }]), '직무 경력 2년 6개월로 요구 4년보다 부족');
});

test('JS·TS 같은 줄임말은 별칭으로 맞추고, 비어 버린 키끼리는 같다고 보지 않는다', () => {
  assert.equal(norm('JS'), 'javascript');
  assert.equal(norm('React.js'), 'react');
  assert.equal(norm('Node.js'), 'node');
  assert.equal(matches(['JS'], ['JavaScript']), true);
  assert.equal(matches(['(필수)'], ['(우대)']), false);
  assert.equal(matches(['JS'], ['TypeScript']), false);
});

test('제목에 직무가 분명하면 모델 직무 분류를 보정한다(앱 공고를 프론트엔드로 본 경우 등)', async () => {
  const { withTitleFamilies } = await import('../dist/recommend/classify.js');
  assert.deepEqual(withTitleFamilies('iOS 개발자 (iOS SDK)', ['프론트엔드']), ['앱 개발']);
  assert.deepEqual(withTitleFamilies('크로스플랫폼 앱 개발자(Flutter) 채용', ['기타']), ['앱 개발']);
  assert.deepEqual(withTitleFamilies('[AI 클라우드 SW] 백엔드/프론트엔드/앱 개발자 채용', ['백엔드']), ['백엔드', '앱 개발', '프론트엔드']);
  assert.deepEqual(withTitleFamilies('플랫폼개발실 InDSP TF 서버개발자', ['기타']), ['백엔드']);
  assert.deepEqual(withTitleFamilies('[알라미] Product Manager', ['기타']), ['기획']);
  // 직무 이름이 없으면 모델 결과 그대로, 본문 추출이 없으면 제목 직무만.
  assert.deepEqual(withTitleFamilies('ERP 회계 컨설턴트', ['기타']), ['기타']);
  assert.deepEqual(withTitleFamilies('웹프론트엔드 엔지니어', null), ['프론트엔드']);
  // 영문 단어 안의 글자(Pos, Spoon, iOSX 등)는 직무로 보지 않는다.
  assert.deepEqual(withTitleFamilies('Flutter 개발자 (바로더 POS/테이블오더)', ['앱 개발']), ['앱 개발']);
  assert.equal(withTitleFamilies('Responsive Designer', null), null);
});
