'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mailConnectionSchema, meSchema, type Me } from '@nextstep/contracts';
import { formatWhen, prefsStore } from './prefs';

export const ME_KEY = ['auth', 'me'];
const MESSAGES: Record<number, string> = {
  400: '입력값을 확인하세요.',
  401: '로그인이 필요합니다.',
  404: '찾을 수 없습니다. 목록을 새로 고치세요.',
  429: '요청이 반복되었습니다. 잠시 후 다시 시도하세요.',
};

export class RequestError extends Error {
  constructor(readonly status: number, messages: Record<number, string> = {}) {
    super(messages[status] ?? MESSAGES[status] ?? '요청을 처리하지 못했습니다. 서버 연결을 확인하고 다시 시도하세요.');
  }
}

/** 로컬 LLM·메일함을 기다리는 요청의 제한 시간. 동일 출처 경유 route의 API 대기 시간(120초)과 같다. */
export const SLOW = 120_000;

// 동일 출처 API 경유 호출. 응답 계약 검증은 호출하는 쪽이 schema로 한다. 기본 10초, 오래 걸리는 요청은 timeout으로 늘린다.
export async function call(path: string, init?: RequestInit & { messages?: Record<number, string>; timeout?: number }) {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(init?.timeout ?? 10_000), ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}) });
  } catch {
    throw new RequestError(0);
  }
  if (!response.ok) throw new RequestError(response.status, init?.messages);
  return response.status === 204 ? null : (response.json() as Promise<unknown>);
}

async function fetchMe(): Promise<Me | null> {
  try {
    return meSchema.parse(await call('auth/me'));
  } catch (error) {
    if (error instanceof RequestError && error.status === 401) return null;
    throw error;
  }
}

/** 있으면 값, 없으면(404) null인 조회. */
export async function optional(path: string) {
  try { return await call(path); } catch (error) { if (error instanceof RequestError && error.status === 404) return null; throw error; }
}

/** 네이버 메일 연결(없으면 null). 상태바·설정·시작 단계가 같은 캐시를 같은 형태로 쓴다. poll이면 동기화 작업 중에 3초마다, 아니면 1분마다 다시 읽는다. */
export function useMailConnection(me: Me, poll = false) {
  const client = useQueryClient();
  const key = ['mail', 'connection', me.id];
  return useQuery({
    // 메일 설정 화면(poll)은 창으로 돌아오면 다시 읽고, 상태바는 1분 조회에 맡긴다.
    queryKey: key, retry: false, refetchOnWindowFocus: poll,
    queryFn: async () => {
      const data = await optional('mail/connection');
      const next = data === null ? null : mailConnectionSchema.parse(data);
      // 메일 확인 작업(설정·트레이·예약 어느 쪽이든)이 새로 끝났으면 메일이 바꾼 지원 현황·확인 목록을 다시 읽는다.
      const before = client.getQueryData<typeof next>(key)?.lastJob;
      const job = next?.lastJob;
      if (client.getQueryData(key) !== undefined && job && !ACTIVE_JOB.includes(job.status) && (before?.id !== job.id || before.status !== job.status)) {
        void client.invalidateQueries({ queryKey: ['applications', me.id] });
        void client.invalidateQueries({ queryKey: ['reviews', me.id] });
      }
      return next;
    },
    refetchInterval: q => (poll && q.state.data?.lastJob && ACTIVE_JOB.includes(q.state.data.lastJob.status) ? 3000 : 60_000),
  });
}

/** 처리 중인 작업 상태. */
export const ACTIVE_JOB: string[] = ['대기', '실행중'];
export const SOURCE_NAMES = { saramin: '사람인', jobkorea: '잡코리아', jasoseol: '자소설닷컴', wanted: '원티드', jumpit: '점핏' } as const;
/** 목록·창의 버튼 아이콘 크기. */
export const buttonIcon = 'size-icon-base shrink-0 stroke-emphasis';
export const monthDay = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, refetchOnWindowFocus: false });
}


/** 이 기기 화면 설정(prefs.ts). 바꾸면 이 창과 다른 창이 함께 다시 그린다. */
export const usePrefs = () => useSyncExternalStore(prefsStore.subscribe, prefsStore.get, prefsStore.server);
/** 설정 일반 구역의 시간 표기(상대·절대)를 따르는 시각 문구. */
export function useWhen() {
  const { timeFormat } = usePrefs();
  // 상대 표기는 시간이 지나면 바뀌므로 1분마다 다시 그린다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timeFormat !== 'relative') return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [timeFormat]);
  return (iso: string) => formatWhen(iso, timeFormat, now);
}

/**
 * 이 기기에 기억하는 보기 조건(추천 필터·정렬, 지원 현황 묶음 등). 사용자별 키에 두고 로그아웃·계정 삭제 때 지운다.
 * 로그인 후에만 그리는 화면에서 쓴다(서버 렌더링 값과 어긋나지 않게). valid를 통과하지 못한 저장 값은 버린다.
 */
export function useStored<T>(me: Me, name: string, initial: T, valid: (value: unknown) => boolean) {
  const key = `nextstep:view:${me.id}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
      return saved !== null && valid(saved) ? saved as T : initial;
    } catch { return initial; }
  });
  const set = (next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 이번 화면에만 적용 */ }
  };
  return [value, set] as const;
}
