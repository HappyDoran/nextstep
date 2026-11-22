// 서버의 마지막 공고 갱신 결과를 보고 알릴지 정한다. 같은 작업은 한 번만, 끝난 작업만 알린다.
export type LatestRefresh = {
  job: { id: string; status: string; errorCode: string | null; result: Record<string, unknown> | null; finishedAt: string | null } | null;
  counts: { basic: number; challenge: number } | null;
};
export type Notice = { id: string; title: string; body: string; failed: boolean; basic: number };
/** 웹 설정 일반 구역의 갱신 알림 조건(창의 저장소 nextstep:prefs). */
export type NotifyPrefs = { notify?: 'all' | 'basic' | 'failures' | 'off'; sound?: boolean };

export function noticeFor(latest: LatestRefresh, lastNotifiedId: string | undefined): Notice | null {
  const job = latest.job;
  if (!job || !job.finishedAt || job.id === lastNotifiedId) return null;
  const judged = typeof job.result?.judged === 'number' ? job.result.judged : 0;
  const counts = latest.counts ? `기본 ${latest.counts.basic}건 · 도전 ${latest.counts.challenge}건` : '';
  const basic = latest.counts?.basic ?? 0;
  if (job.status === '실패') return { id: job.id, title: '공고 가져오기 실패', body: '추천 화면에서 원인을 확인하세요.', failed: true, basic };
  const body = !judged ? '새로 판정한 공고가 없습니다.' : counts ? `이번에 판정한 공고 ${judged}건 중 ${counts}` : `이번에 판정한 공고 ${judged}건`;
  return { id: job.id, title: job.status === '일부 실패' ? '공고 가져오기 끝(일부 실패)' : '공고 가져오기 끝', body, failed: job.status === '일부 실패', basic };
}

/** 사용자가 고른 조건으로 이 알림을 보일지 정한다. 안 보이는 알림도 알린 것으로 적어 나중에 다시 뜨지 않게 한다. */
export function wanted(notice: Notice, prefs: NotifyPrefs): boolean {
  const mode = prefs.notify ?? 'all';
  return mode === 'all' || (mode === 'failures' && notice.failed) || (mode === 'basic' && notice.basic > 0);
}
