// 서버의 마지막 공고 갱신 결과를 보고 알릴지 정한다. 같은 작업은 한 번만, 끝난 작업만 알린다.
export type LatestRefresh = {
  job: { id: string; status: string; errorCode: string | null; result: Record<string, unknown> | null; finishedAt: string | null } | null;
  counts: { basic: number; challenge: number } | null;
};
export type Notice = { id: string; title: string; body: string };

export function noticeFor(latest: LatestRefresh, lastNotifiedId: string | undefined): Notice | null {
  const job = latest.job;
  if (!job || !job.finishedAt || job.id === lastNotifiedId) return null;
  const judged = typeof job.result?.judged === 'number' ? job.result.judged : 0;
  const counts = latest.counts ? `기본 ${latest.counts.basic}건 · 도전 ${latest.counts.challenge}건` : '';
  if (job.status === '실패') return { id: job.id, title: '공고 가져오기 실패', body: '추천 화면에서 원인을 확인하세요.' };
  const body = judged ? `이번에 판정한 공고 ${judged}건 중 ${counts}` : '새로 판정한 공고가 없습니다.';
  return { id: job.id, title: job.status === '일부 실패' ? '공고 가져오기 끝(일부 실패)' : '공고 가져오기 끝', body };
}
