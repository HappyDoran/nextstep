'use client';
import { useId, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { Button, Segmented, Tag, Textarea } from '@nextstep/design-system';
import { documentVersionSchema, resumeSchema, resumeFailureSchema, DOCUMENT_VERSION_MAX, type DocumentKind, type Me, type Resume } from '@nextstep/contracts';
import { call, optional, RequestError, SLOW, useWhen } from '../api-client';

const FAILURES: Record<string, string> = {
  unsupported_type: 'PDF·MD·Notion ZIP 파일만 등록할 수 있습니다.',
  too_large: '파일이 너무 큽니다(PDF·MD 20MB, ZIP 50MB·해제 후 200MB·500개 이하).',
  encrypted: '암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제한 PDF나 MD로 다시 등록하세요.',
  damaged: '손상되었거나 지원하지 않는 형식입니다(암호 ZIP 등). 다시 저장한 파일로 등록하세요.',
  scanned_or_empty: '글자를 읽을 수 없습니다. 이미지 글자 인식(OCR)으로도 읽지 못했습니다. MD로 다시 등록하세요.',
  timeout: '처리 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.',
};
const DOCUMENT_NAMES: Record<DocumentKind, string> = { resume: '이력서', portfolio: '포트폴리오', career: '경력기술서' };
const KINDS = (['resume', 'career', 'portfolio'] as const).map(value => ({ value, label: value === 'resume' ? '이력서 (필수)' : DOCUMENT_NAMES[value] }));
const ACCEPT = '.pdf,.md,.markdown,.zip,application/pdf,text/markdown,application/zip';
const icon = 'size-icon-base shrink-0 stroke-icon';
const kb = (size: number) => size < 1024 * 1024 ? `${Math.ceil(size / 1024)}KB` : `${(size / 1024 / 1024).toFixed(1)}MB`;

// 새 파일 변환이 성공하면 새 버전이 사용 중이 되고, 실패하면 기존 서류가 그대로 남는다.
async function upload(kind: DocumentKind, file: File) {
  const name = file.name.toLowerCase();
  const response = await fetch(`/api/documents/${kind}`, {
    method: 'PUT',
    headers: { 'content-type': name.endsWith('.pdf') ? 'application/pdf' : name.match(/\.(md|markdown)$/) ? 'text/markdown' : name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) },
    body: file,
    // 이미지 쪽 글자 인식(OCR)이 있으면 오래 걸린다.
    signal: AbortSignal.timeout(SLOW),
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

/** 서류 구역: 종류를 고르고, 그 종류의 사용 중 버전·버전 목록·올리기를 한곳에서 다룬다. */
export function DocumentsSetting({ me }: { me: Me }) {
  const [kind, setKind] = useState<DocumentKind>('resume');
  return <div className="grid gap-5">
    <Segmented label="서류 종류" value={kind} onChange={setKind} options={KINDS} />
    <DocumentPanel key={kind} me={me} kind={kind} />
  </div>;
}

function DocumentPanel({ me, kind }: { me: Me; kind: DocumentKind }) {
  const when = useWhen();
  const label = DOCUMENT_NAMES[kind];
  const client = useQueryClient();
  const key = ['documents', kind, me.id];
  const query = useQuery({
    queryKey: key, retry: false,
    queryFn: async () => {
      const doc = await optional(`documents/${kind}`);
      return doc === null ? null : resumeSchema.parse(doc);
    },
  });
  const versions = useQuery({ queryKey: ['documents', kind, 'versions', me.id], retry: false, queryFn: async () => documentVersionSchema.array().parse(await call(`documents/${kind}/versions`)) });
  const refresh = () => client.invalidateQueries({ queryKey: ['documents', kind] });
  const doc = query.data;
  const save = useMutation({ mutationFn: (f: File) => upload(kind, f), onSuccess: refresh });
  const edit = useMutation({ mutationFn: async (text: string) => resumeSchema.parse(await call(`documents/${kind}/text`, { method: 'PUT', body: JSON.stringify({ text }) })), onSuccess: refresh });
  const activate = useMutation({ mutationFn: async (id: string) => resumeSchema.parse(await call(`documents/${kind}/versions/${id}/active`, { method: 'PUT' })), onSuccess: refresh });
  const drop = useMutation({ mutationFn: (id: string) => call(`documents/${kind}/versions/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const removeAll = useMutation({ mutationFn: () => call(`documents/${kind}`, { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? edit.error ?? activate.error ?? drop.error ?? removeAll.error;
  const busy = activate.isPending || drop.isPending || removeAll.isPending;

  return <div className="grid gap-5">
    <Dropzone label={label} uploading={save.isPending} replacing={Boolean(doc)} onFile={file => save.mutate(file)} />
    {error && <p role="alert" className="text-body-sm text-destructive">{error.message}</p>}
    {query.isPending ? <p role="status" className="text-body-sm text-muted-foreground">{label}를 불러오고 있어요.</p>
      : query.isError ? <p role="alert" className="text-body-sm text-destructive">{label}를 불러오지 못했어요.</p>
        : doc && <section aria-labelledby={`current-${kind}`} className="grid gap-3 rounded-surface border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <FileText className="mt-0.5 size-icon-md shrink-0 stroke-icon text-primary" aria-hidden="true" focusable="false" />
            <div className="min-w-0 flex-1">
              <h4 id={`current-${kind}`} className="truncate text-body-sm font-bold">{doc.filename}</h4>
              <p className="text-caption text-muted-foreground">{when(doc.createdAt)} · {kb(doc.size)}{doc.edited ? ' · 내용 고침' : ''}</p>
            </div>
            <Tag>사용 중</Tag>
          </div>
          {doc.ocrPages.length > 0 && <p className="text-body-sm text-warning">{doc.ocrPages.join('·')}쪽은 이미지에서 글자를 읽었어요. 아래에서 잘못 읽은 글자를 고쳐 주세요.</p>}
          {doc.emptyPages.length > 0 && <p className="text-body-sm text-warning">{doc.emptyPages.join('·')}쪽에서 글자를 읽지 못했어요. 아래에 직접 적거나 다른 파일로 올려 주세요.</p>}
          {/* 저장된 본문이 바뀌면 편집 상자를 새 본문으로 다시 연다. */}
          <TextEditor key={doc.text} doc={doc} saving={edit.isPending} onSave={text => edit.mutate(text)} />
        </section>}
    {versions.data && versions.data.length > 1 && <section aria-labelledby={`versions-${kind}`} className="grid gap-2">
      <h4 id={`versions-${kind}`} className="text-body-sm font-extrabold">이전 버전 <span className="font-normal text-muted-foreground">· 최근 {DOCUMENT_VERSION_MAX}개까지 보관</span></h4>
      <ul className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
        {versions.data.filter(v => !v.active).map(v => <li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1"><p className="truncate text-body-sm">{v.filename}</p><p className="text-caption text-muted-foreground">{when(v.createdAt)} · {kb(v.size)}{v.edited ? ' · 내용 고침' : ''}</p></div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => activate.mutate(v.id)}>이 버전 사용</Button>
          <Button size="sm" variant="danger" disabled={busy} aria-label={`${v.filename} 버전 삭제`} onClick={() => { if (window.confirm(`${v.filename} 버전을 삭제합니다.`)) drop.mutate(v.id); }}><Trash2 className={icon} aria-hidden="true" focusable="false" /></Button>
        </li>)}
      </ul>
    </section>}
    {doc && <div><Button variant="danger" disabled={busy} onClick={() => { if (window.confirm(`${label}의 모든 버전을 삭제합니다.`)) removeAll.mutate(); }}>{label} 모두 삭제</Button></div>}
  </div>;
}

/** 파일 놓는 곳: 끌어다 놓거나 눌러서 고르면 바로 올린다. 실제 입력은 화면에서 숨기고 라벨이 버튼 역할을 한다. */
function Dropzone({ label, uploading, replacing, onFile }: { label: string; uploading: boolean; replacing: boolean; onFile: (file: File) => void }) {
  const id = useId();
  const [over, setOver] = useState(false);
  const take = (file: File | undefined) => { if (file && !uploading) onFile(file); };
  const onDrop = (event: DragEvent) => { event.preventDefault(); setOver(false); take(event.dataTransfer.files[0]); };
  return <label htmlFor={id} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
    className={`flex cursor-pointer flex-col items-center gap-2 rounded-surface border-2 border-dashed px-6 py-7 text-center transition-colors duration-fast has-[:focus-visible]:outline has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-ring motion-reduce:transition-none ${over ? 'border-primary bg-secondary' : 'border-border-strong bg-background hover:border-primary hover:bg-muted'} ${uploading ? 'pointer-events-none opacity-70' : ''}`}>
    <input id={id} type="file" accept={ACCEPT} className="sr-only" disabled={uploading} onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }} />
    {uploading ? <LoaderCircle className="size-icon-lg shrink-0 animate-spin stroke-icon text-primary motion-reduce:animate-none" aria-hidden="true" focusable="false" /> : <Upload className="size-icon-lg shrink-0 stroke-icon text-primary" aria-hidden="true" focusable="false" />}
    <span className="text-body-sm font-semibold">{uploading ? `${label}를 읽는 중이에요` : replacing ? `새 ${label} 버전 올리기` : `${label} 올리기`}</span>
    <span className="text-caption text-muted-foreground">{uploading ? '스캔한 쪽이 있으면 조금 더 걸려요' : '파일을 끌어다 놓거나 눌러서 고르세요 · PDF, MD, Notion ZIP'}</span>
  </label>;
}

function TextEditor({ doc, saving, onSave }: { doc: Resume; saving: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(doc.text);
  return <details>
    <summary className="cursor-pointer text-body-sm font-semibold text-primary">읽어 들인 내용 확인·고치기</summary>
    <Textarea aria-label="읽어 들인 내용" value={draft} onChange={e => setDraft(e.target.value)} rows={14} className="mt-3 font-mono text-caption" />
    <Button className="mt-3" size="sm" disabled={saving || draft.trim() === doc.text.trim() || !draft.trim()} onClick={() => onSave(draft)}>내용 저장</Button>
  </details>;
}
