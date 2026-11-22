import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AuthLayout } from '../frame';

export const metadata: Metadata = { title: '개인정보처리방침 · NextStep' };

// 구글 로그인 동의 화면이 연결하는 개인정보처리방침(기술 설계 보호 정책의 사용자 안내). 로그인 없이 연다.
const SECTIONS: { title: string; body: string }[] = [
  { title: '서비스', body: 'NextStep은 운영자가 초대한 사람만 쓰는 비공개·무료 서비스이며 운영자의 홈서버에서만 동작합니다.' },
  { title: '처리하는 정보', body: '구글 로그인의 이메일과 계정 식별자, 사용자가 올린 서류(이력서·경력기술서·포트폴리오)와 그 변환 본문, 프로필·희망 조건, 지원 현황, 연결한 네이버 메일의 채용 관련 메일 일부(수신 시각·제목 앞부분·짧은 발췌)와 메일 연결 정보(암호화 저장).' },
  { title: '이용 목적', body: '로그인, 맞춤 공고 추천, 지원 관리에만 씁니다.' },
  { title: '처리 위치와 전달', body: '자료는 운영자 홈서버에 저장하고 홈서버의 로컬 AI로 처리하며 외부 AI 서비스로 보내지 않습니다. 등록되지 않은 구글 계정으로 로그인하면 가입 요청으로 그 이메일과 초대 코드가 운영자의 Discord 알림으로 전달됩니다. 그 밖의 제3자에게 제공하지 않습니다.' },
  { title: '보관과 삭제', body: '설정 > 계정의 계정 삭제로 계정과 자료를 바로 지웁니다. 서버 백업에는 최대 14일 동안 남을 수 있습니다. 끝난 작업 기록은 30일 뒤 지웁니다.' },
  { title: '문의', body: 'kirin0044@gmail.com' },
];

export default function PrivacyPage() {
  return <AuthLayout>
    <article className="grid gap-6">
      {/* 데스크톱 앱에는 브라우저 뒤로 가기가 없으므로 화면 안에 돌아갈 길을 둔다. */}
      <Link href="/" className="inline-flex items-center gap-1.5 justify-self-start text-body-sm font-semibold"><ArrowLeft className="size-icon-sm" aria-hidden="true" focusable="false" />처음 화면으로</Link>
      <h1 className="text-title-lg">개인정보처리방침</h1>
      {SECTIONS.map(section => <section key={section.title} className="grid gap-1.5">
        <h2 className="text-body font-semibold">{section.title}</h2>
        <p className="text-body-sm text-muted-foreground">{section.body}</p>
      </section>)}
      <p className="text-caption text-muted-foreground">시행일: 2026-11-21</p>
    </article>
  </AuthLayout>;
}
