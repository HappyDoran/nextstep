'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { resumeSchema, resumeFailureSchema, type Me } from '@nextstep/contracts';
import { call, RequestError } from '../api-client';

const FAILURES: Record<string, string> = {
  unsupported_type: 'PDF 또는 MD 파일만 등록할 수 있습니다.',
  too_large: '파일이 20MB를 넘습니다.',
  encrypted: '암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제한 PDF나 MD로 다시 등록하세요.',
  damaged: '손상된 파일입니다. 다시 저장한 PDF나 MD로 등록하세요.',
  scanned_or_empty: '글자를 읽을 수 없습니다(스캔 PDF 등). 텍스트 PDF나 MD로 다시 등록하세요.',
  timeout: '처리 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.',
};

// 새 파일 확인이 성공해야 교체되고, 실패하면 기존 이력서가 그대로 남는다.
async function upload(file: File) {
  const response = await fetch('/api/documents/resume', {
    method: 'PUT',
    headers: { 'content-type': file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : file.name.toLowerCase().match(/\.(md|markdown)$/) ? 'text/markdown' : 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
    body: file,
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 422 || response.status === 415) {
    const code = resumeFailureSchema.safeParse(((await response.json()) as { code?: string }).code).data ?? 'unsupported_type';
    throw new Error(`${FAILURES[code]} 기존 이력서는 유지됩니다.`);
  }
  if (response.status === 413) throw new Error(`${FAILURES.too_large} 기존 이력서는 유지됩니다.`);
  if (!response.ok) throw new RequestError(response.status);
  return resumeSchema.parse(await response.json());
}

export function ResumeSetting({ me }: { me: Me }) {
  const client = useQueryClient();
  const key = ['documents', 'resume', me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => {
      try { return resumeSchema.parse(await call('documents/resume')); } catch (error) { if (error instanceof RequestError && error.status === 404) return null; throw error; }
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({ mutationFn: upload, onSuccess: data => { client.setQueryData(key, data); setFile(null); } });
  const remove = useMutation({ mutationFn: () => call('documents/resume', { method: 'DELETE' }), onSuccess: () => client.setQueryData(key, null) });
  const resume = query.data;
  return <div className="flex flex-col gap-4">
    <p role="status" className="text-muted-foreground">
      {query.isPending ? '이력서를 확인하고 있습니다.' : query.isError ? '이력서를 불러오지 못했습니다.'
        : resume ? `등록된 이력서: ${resume.filename} (${Math.ceil(resume.size / 1024)}KB, ${new Date(resume.createdAt).toLocaleString('ko-KR')})` : '등록한 이력서가 없습니다.'}
    </p>
    <label className="flex flex-col gap-2 text-body-sm">이력서 파일 (텍스트 PDF 또는 MD, 20MB 이하)
      <input type="file" accept=".pdf,.md,.markdown,application/pdf,text/markdown" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-body" />
    </label>
    <div className="flex flex-wrap gap-3">
      <Button disabled={!file || save.isPending} onClick={() => { if (file) save.mutate(file); }}>{resume ? '교체' : '등록'}</Button>
      {resume && <Button disabled={remove.isPending} className="border-destructive !bg-transparent !text-destructive" onClick={() => { if (window.confirm('이력서 원본과 추출 본문을 삭제합니다.')) remove.mutate(); }}>이력서 삭제</Button>}
    </div>
    {resume && resume.emptyPages.length > 0 && <p role="status" className="text-body-sm text-warning">
      {resume.emptyPages.join('·')}쪽에서 글자를 읽지 못했습니다(이미지 쪽). 그 쪽 내용은 추천에 쓰이지 않습니다. 텍스트 PDF나 MD로 교체하세요.
    </p>}
    {(save.isError || remove.isError) && <p role="alert" className="text-body-sm text-destructive">{(save.error ?? remove.error)?.message}</p>}
    {resume && <details className="rounded-control border border-border p-4">
      <summary className="cursor-pointer text-body-sm">추출된 본문 확인</summary>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-body-sm">{resume.text}</pre>
    </details>}
  </div>;
}
