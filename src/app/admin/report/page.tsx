'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { listSessions, getCountRecords, updateComment, updateRecountOk } from '@/lib/db';
import type { InventorySession, CountRecord } from '@/types';
import {
  Badge, Button, Card, Select, StatCard, Modal,
  Textarea, Loading, EmptyState, Alert
} from '@/components/ui';

type Filter = 'all' | 'plus' | 'minus' | 'nocomment' | 'added';

const CAUSE_OPTIONS = [
  '計数ミス（再カウント済）',
  '入庫処理漏れ',
  '出庫処理漏れ',
  'ロケーション誤配置',
  '破損・廃棄処理漏れ',
  'その他',
];

function DiffValue({ diff }: { diff: number }) {
  if (diff === 0) return <span className="text-stone-400 text-xs">±0</span>;
  return (
    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded
      ${diff > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
      {diff > 0 ? '+' : ''}{diff}
    </span>
  );
}

function ReportContent() {
  const params = useSearchParams();
  const [sessions, setSessions] = useState<InventorySession[]>([]);
  const [selectedId, setSelectedId] = useState(params.get('session') ?? '');
  const [records, setRecords] = useState<CountRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [modalRec, setModalRec] = useState<CountRecord | null>(null);
  const [causeCategory, setCauseCategory] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 100;

  useEffect(() => {
    listSessions().then(list => {
      setSessions(list);
      if (!selectedId && list.length > 0) setSelectedId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    getCountRecords(selectedId)
      .then(setRecords)
      .finally(() => setLoading(false));
  }, [selectedId]);

  // 差異あり、または実数量が0のレコードを対象とする（0個は必ず記録）
  const diffRecords = records.filter(r => r.hasDiff || r.actualQty === 0);
  const noComment   = diffRecords.filter(r => r.hasDiff && !r.comment);

  const addedRecords = records.filter(r => r.isAdded);

  const filtered = records.filter(r => {
    if (filter === 'plus')      return r.diff > 0;
    if (filter === 'minus')     return r.diff < 0;
    if (filter === 'nocomment') return r.hasDiff && !r.comment;
    if (filter === 'added')     return r.isAdded;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openComment(rec: CountRecord) {
    setModalRec(rec);
    setCauseCategory(rec.causeCategory ?? '');
    setComment(rec.comment ?? '');
  }

  async function saveComment() {
    if (!modalRec) return;
    setSaving(true);
    await updateComment(modalRec.id, causeCategory, comment);
    setRecords(prev => prev.map(r =>
      r.id === modalRec.id ? { ...r, causeCategory, comment } : r
    ));
    setSaving(false);
    setModalRec(null);
  }

  async function toggleRecountOk(rec: CountRecord) {
    const newVal = !rec.recountOk;
    await updateRecountOk(rec.id, newVal);
    setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, recountOk: newVal } : r));
  }

  function exportCsv() {
    const okRecords = diffRecords.filter(r => r.recountOk);
    if (okRecords.length === 0) { alert('リカウントOKの件数が0件です。'); return; }
    const filterLabel = filter === 'all' ? 'すべて' : filter === 'plus' ? '数量超過' : filter === 'minus' ? '数量不足' : 'コメント未記入';
    const bikou = `${session?.name ?? ''}_${filterLabel}`;
    const header = '倉庫ID,商品コード,強制出庫,ロケーション,出荷期限日,ロット番号,強制出庫,備考\n';
    const rows = okRecords.map(r => {
      const qty = Math.abs(r.diff);
      const flag = r.diff < 0 ? 1 : '';
      return [1114, r.productCd, qty, r.location,
              r.masterExpiryDate ?? '', r.masterLotNumber ?? '',
              flag, `"${bikou}"`].join(',');
    }).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tanaoroshi_${selectedId.slice(0,8)}.csv`;
    a.click();
  }

  const session = sessions.find(s => s.id === selectedId);
  const pct = session && session.totalItems > 0
    ? Math.round((session.completedItems / session.totalItems) * 100)
    : 0;

  return (
    <>
      <div className="bg-white border-b border-stone-200 px-8 h-14 flex items-center justify-between">
        <span className="font-semibold text-stone-900">棚卸しレポート</span>
        <div className="flex items-center gap-3">
          <Select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="w-52 text-sm"
          >
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          <Button onClick={exportCsv} disabled={diffRecords.length === 0}>⬇ CSV（リカウントOKのみ）</Button>
        </div>
      </div>

      <div className="p-8 space-y-6">
        {/* 計数URL */}
        {session && (
          <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg px-4 py-2.5">
            <span className="text-xs text-stone-400 shrink-0">計数URL</span>
            <a
              href={`/count/${session.token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[#4A7A5A] underline truncate"
            >
              {typeof window !== 'undefined' ? `${window.location.origin}/count/${session.token}` : `/count/${session.token}`}
            </a>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/count/${session.token}`)}
              className="text-xs px-2 py-1 bg-white border border-stone-300 rounded text-stone-500 hover:border-stone-400 shrink-0"
            >
              コピー
            </button>
          </div>
        )}

        {/* サマリー */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="完了アイテム" value={session?.completedItems ?? 0} sub={`全${session?.totalItems ?? 0}件中 ${pct}%`} />
          <StatCard label="差異あり件数" value={diffRecords.length} accent={diffRecords.length > 0 ? 'text-red-600' : undefined} sub="完了済みから" />
          <StatCard label="コメント未記入" value={noComment.length} accent={noComment.length > 0 ? 'text-amber-600' : undefined} sub="差異件数中" />
          <StatCard label="進捗" value={`${pct}%`} sub={session?.status === 'completed' ? '完了' : '進行中'} />
        </div>

        {/* フィルタ */}
        <div className="flex gap-2 flex-wrap">
          {([
            ['all',       `すべて（${records.length}）`],
            ['plus',      `数量超過（${diffRecords.filter(r=>r.diff>0).length}）`],
            ['minus',     `数量不足（${diffRecords.filter(r=>r.diff<0).length}）`],
            ['nocomment', `コメント未記入（${noComment.length}）`],
            ['added',     `追加商品（${addedRecords.length}）`],
          ] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1); }}
              className={`px-3 py-1.5 text-sm rounded-full border transition-all
                ${filter === f
                  ? 'bg-[#E8F0EC] border-[#4A7A5A] text-[#1A3A2A] font-medium'
                  : 'bg-white border-stone-300 text-stone-500 hover:border-stone-400'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* テーブル */}
        {loading ? <Loading /> : filtered.length === 0 ? (
          <Card className="p-0">
            <EmptyState icon="✅" text={records.length === 0 ? '計数済みデータがありません' : '該当するデータがありません'} />
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    {['ロケーション','商品CD','商品名','システム数量','実数量','差異','出荷期限日','担当者','原因コメント','リカウントOK',''].map(h => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map(r => {
                    const rate = r.systemQty > 0 ? ((r.diff / r.systemQty) * 100).toFixed(1) : '-';
                    return (
                      <tr key={r.id} className={`border-b border-stone-100 hover:bg-stone-50 ${r.recountOk ? 'bg-emerald-50/50' : ''}`}>
                        <td className="px-3 py-3 font-mono text-xs text-stone-600">{r.location}</td>
                        <td className="px-3 py-3 font-mono text-xs text-stone-600">{r.productCd}</td>
                        <td className="px-3 py-3 text-stone-800 max-w-[180px]">
                          <div className="flex items-center gap-1.5">
                            {r.isAdded && (
                              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">追加</span>
                            )}
                            <span className="truncate" title={r.productName}>{r.productName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right text-stone-600">{r.systemQty}</td>
                        <td className="px-3 py-3 text-right font-semibold text-stone-900">{r.actualQty}</td>
                        <td className="px-3 py-3 text-center"><DiffValue diff={r.diff} /></td>
                        <td className="px-3 py-3 text-xs text-stone-500">{r.masterExpiryDate ?? '-'}</td>
                        <td className="px-3 py-3 text-xs text-stone-500">{r.staffName}</td>
                        <td className="px-3 py-3 max-w-[160px]">
                          {r.comment
                            ? <span className="text-xs text-stone-700 line-clamp-2">{r.comment}</span>
                            : <span className="text-xs text-stone-400">未記入</span>
                          }
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => toggleRecountOk(r)}
                            className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all
                              ${r.recountOk ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-stone-300 bg-white'}`}
                          >
                            {r.recountOk && <span className="text-xs font-bold">✓</span>}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <Button size="sm" onClick={() => openComment(r)}>コメント</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-stone-400">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} 件 / 全{filtered.length}件
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-50"
              >
                ← 前へ
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | '...')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-2 py-1.5 text-stone-400 text-sm">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      className={`px-3 py-1.5 text-sm border rounded-lg ${page === p ? 'bg-[#1A3A2A] text-white border-[#1A3A2A]' : 'border-stone-300 hover:bg-stone-50'}`}
                    >
                      {p}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-stone-300 rounded-lg disabled:opacity-40 hover:bg-stone-50"
              >
                次へ →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* コメントモーダル */}
      <Modal open={!!modalRec} onClose={() => setModalRec(null)} title="差異原因コメント">
        {modalRec && (
          <div className="space-y-4">
            <div className="text-sm text-stone-500">{modalRec.productCd} ／ {modalRec.productName}</div>
            <div className={`px-3 py-2 rounded-lg text-sm font-semibold
              ${modalRec.diff > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
              差異数量：{modalRec.diff > 0 ? '+' : ''}{modalRec.diff}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-stone-500">差異原因</label>
              <select
                value={causeCategory}
                onChange={e => setCauseCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md outline-none focus:border-[#4A7A5A] bg-white"
              >
                <option value="">選択してください</option>
                {CAUSE_OPTIONS.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <Textarea
              label="詳細コメント（任意）"
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder="詳細を記入..."
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button onClick={() => setModalRec(null)}>キャンセル</Button>
              <Button variant="primary" disabled={saving} onClick={saveComment}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ReportContent />
    </Suspense>
  );
}
