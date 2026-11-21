'use client';
import { useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { meSchema, type Me } from '@nextstep/contracts';
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

// 동일 출처 API 경유 호출. 응답 계약 검증은 호출하는 쪽이 schema로 한다.
export async function call(path: string, init?: RequestInit & { messages?: Record<number, string> }) {
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000), ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}) });
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

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchMe, retry: false, refetchOnWindowFocus: false });
}

export const fieldClass = 'h-control w-full rounded-control border border-border-strong bg-card px-3 text-body-sm focus:border-primary focus-visible:outline focus-visible:outline-focus focus-visible:outline-ring focus-visible:outline-offset-focus';

/** 이 기기 화면 설정(prefs.ts). 바꾸면 이 창과 다른 창이 함께 다시 그린다. */
export const usePrefs = () => useSyncExternalStore(prefsStore.subscribe, prefsStore.get, prefsStore.server);
/** 설정 일반 구역의 시간 표기(상대·절대)를 따르는 시각 문구. */
export function useWhen() {
  const { timeFormat } = usePrefs();
  return (iso: string) => formatWhen(iso, timeFormat);
}

/**
 * 이 기기에 기억하는 보기 조건(추천 필터·정렬, 지원 현황 묶음 등). 로그인 후에만 그리는 화면에서 쓴다
 * (서버 렌더링 값과 어긋나지 않게). 저장 값의 형태가 기본값과 다르면 기본값을 쓴다.
 */
export function useStored<T>(name: string, initial: T) {
  const key = `nextstep:view:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as unknown;
      return saved !== null && (initial === null || typeof saved === typeof initial) ? saved as T : initial;
    } catch { return initial; }
  });
  const set = (next: T) => {
    setValue(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 이번 화면에만 적용 */ }
  };
  return [value, set] as const;
}
