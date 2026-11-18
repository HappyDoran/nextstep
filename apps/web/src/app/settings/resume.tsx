'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@nextstep/design-system';
import { resumeSchema, resumeFailureSchema, type DocumentKind, type Me, type Resume } from '@nextstep/contracts';
import { call, RequestError } from '../api-client';

const FAILURES: Record<string, string> = {
  unsupported_type: 'PDF·MD·Notion ZIP 파일만 등록할 수 있습니다.',
  too_large: '파일이 너무 큽니다(PDF·MD 20MB, ZIP 50MB·해제 후 200MB·500개 이하).',
  encrypted: '암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제한 PDF나 MD로 다시 등록하세요.',
  damaged: '손상되었거나 지원하지 않는 형식입니다(암호 ZIP 등). 다시 저장한 파일로 등록하세요.',
  scanned_or_empty: '글자를 읽을 수 없습니다. 이미지 글자 인식(OCR)으로도 읽지 못했습니다. MD로 다시 등록하세요.',
  timeout: '처리 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.',
};
export const DOCUMENT_NAMES: Record<DocumentKind, string> = { resume: '이력서', portfolio: '포트폴리오', career: '경력기술서' };

// 새 파일 변환이 성공해야 교체되고, 실패하면 기존 서류가 그대로 남는다.
async function upload(kind: DocumentKind, file: File) {
  const name = file.name.toLowerCase();
  const response = await fetch(`/api/documents/${kind}`, {
    method: 'PUT',
    headers: { 'content-type': name.endsWith('.pdf') ? 'application/pdf' : name.match(/\.(md|markdown)$/) ? 'text/markdown' : name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
    body: file,
    // 이미지 쪽 글자 인식(OCR)이 있으면 오래 걸린다.
    signal: AbortSignal.timeout(120_000),
  });
  const keep = `기존 ${DOCUMENT_NAMES[kind]}는 유지됩니다.`;
  if (response.status === 422 || response.status === 415) {
    const code = resumeFailureSchema.safeParse(((await response.json()) as { code?: string }).code).data ?? 'unsupported_type';
    throw new Error(`${FAILURES[code]} ${keep}`);
  }
  if (response.status === 413) throw new Error(`${FAILURES.too_large} ${keep}`);
  if (!response.ok) throw new RequestError(response.status);
  return resumeSchema.parse(await response.json());
}

export function ResumeSetting({ me, kind = 'resume' }: { me: Me; kind?: DocumentKind }) {
  const label = DOCUMENT_NAMES[kind];
  const client = useQueryClient();
  const key = ['documents', kind, me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => {
      try { return resumeSchema.parse(await call(`documents/${kind}`)); } catch (error) { if (error instanceof RequestError && error.status === 404) return null; throw error; }
    },
  });
  const [file, setFile] = useState<File | null>(null);
  const doc = query.data;
  const save = useMutation({ mutationFn: (f: File) => upload(kind, f), onSuccess: data => { client.setQueryData(key, data); setFile(null); } });
  const edit = useMutation({ mutationFn: async (text: string) => resumeSchema.parse(await call(`documents/${kind}/text`, { method: 'PUT', body: JSON.stringify({ text }) })), onSuccess: data => client.setQueryData(key, data) });
  const remove = useMutation({ mutationFn: () => call(`documents/${kind}`, { method: 'DELETE' }), onSuccess: () => client.setQueryData(key, null) });
  const error = save.error ?? edit.error ?? remove.error;
  return <div className="flex flex-col gap-4">
    <p role="status" className="text-muted-foreground">
      {query.isPending ? `${label}를 확인하고 있습니다.` : query.isError ? `${label}를 불러오지 못했습니다.`
        : doc ? `등록된 ${label}: ${doc.filename} (${Math.ceil(doc.size / 1024)}KB, ${new Date(doc.createdAt).toLocaleString('ko-KR')})${doc.edited ? ' · MD 수정함' : ''}` : `등록한 ${label}가 없습니다.`}
    </p>
    <label className="flex flex-col gap-2 text-body-sm">{label} 파일 (PDF·MD·Notion ZIP. 이미지 쪽은 글자 인식으로 MD 변환)
      <input type="file" accept=".pdf,.md,.markdown,.zip,application/pdf,text/markdown,application/zip" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-body" />
    </label>
    <div className="flex flex-wrap gap-3">
      <Button disabled={!file || save.isPending} onClick={() => { if (file) save.mutate(file); }}>{save.isPending ? '변환 중…' : `${label} ${doc ? '교체' : '등록'}`}</Button>
      {doc && <Button disabled={remove.isPending} variant="danger" onClick={() => { if (window.confirm(`${label} 원본과 MD를 삭제합니다.`)) remove.mutate(); }}>{label} 삭제</Button>}
    </div>
    {doc && doc.ocrPages.length > 0 && <p role="status" className="text-body-sm text-warning">
      {doc.ocrPages.join('·')}쪽은 이미지라 글자 인식(OCR)으로 읽었습니다. 아래 MD에서 잘못 읽은 글자를 고쳐 주세요.
    </p>}
    {doc && doc.emptyPages.length > 0 && <p role="status" className="text-body-sm text-warning">
      {doc.emptyPages.join('·')}쪽에서 글자를 읽지 못했습니다. 그 쪽 내용은 추천에 쓰이지 않습니다. 아래 MD에 직접 적거나 MD로 교체하세요.
    </p>}
    {error && <p role="alert" className="text-body-sm text-destructive">{error.message}</p>}
    {/* 저장된 본문이 바뀌면 편집 상자를 새 본문으로 다시 연다. */}
    {doc && <MdEditor key={doc.text} doc={doc} label={label} saving={edit.isPending} onSave={text => edit.mutate(text)} />}
  </div>;
}

function MdEditor({ doc, label, saving, onSave }: { doc: Resume; label: string; saving: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(doc.text);
  return <details className="rounded-control border border-border p-4">
    <summary className="cursor-pointer text-body-sm">변환된 MD 확인·수정</summary>
    <label className="mt-3 flex flex-col gap-2 text-body-sm">{label} MD
      <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={14} className="rounded-control border border-border bg-background p-3 font-mono text-body-sm" />
    </label>
    <Button className="mt-3" disabled={saving || draft.trim() === doc.text.trim() || !draft.trim()} onClick={() => onSave(draft)}>MD 저장</Button>
  </details>;
}
