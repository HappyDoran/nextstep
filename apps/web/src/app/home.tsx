'use client';
import { Account } from './account';
import { Applications } from './applications';
import { SignedIn } from './frame';

export function Home() {
  return <SignedIn signedOut={<>
    <div><h1 className="text-title-lg">NextStep 시작하기</h1><p className="mt-2 text-body-sm text-muted-foreground">나에게 맞는 공고를 살펴보고, 직접 지원한 이후의 과정을 한곳에서 확인합니다.</p></div>
    <Account />
  </>}>{me => <Applications me={me} />}</SignedIn>;
}
