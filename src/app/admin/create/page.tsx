'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSession, importMasterItems, parseMasterCsv } from '@/lib/db';
import { Button, Card, Input, Select, Alert } from '@/components/ui';

type Step = 1 | 2 | 3;
type InvType = 'full' | 'focused';

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [type, setType] = useState<InvType>('full');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [focusDays, setFocusDays] = useState(30);
  const [focusLocation, setFocusLocation] = useState('');
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseMasterCsv>>([]);
  const [csvName, setCsvName] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [token, setToken] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const previewCount = type === 'focused' ? Math.floor(csvRows.length * 0.6) : csvRows.length;

  async function handleCsvFile(file: File) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    let text: string;
    if (hasUtf8Bom) {
      text = new TextDecoder('utf-8').decode(buffer);
    } else {
      const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      const fffdCount = (utf8.match(/\uFFFD/g) ?? []).length;
      const isShiftJis = fffdCount / utf8.length > 0.001;
      text = isShiftJis ? new TextDecoder('shift-jis').decode(buffer) : utf8;
    }
    const rows = parseMasterCsv(text);
    setCsvRows(rows);
    setCsvName(file.name);
    setError('');
  }

  async function handleCreate() {
    if (!name.trim()) { setError('棚卸し名を入力してください'); return; }
    if (csvRows.length === 0) { setError('CSVファイルを取り込んでください'); return; }
    setCreating(true);
    try {
      const id = await createSession({
        name: name.trim(),
        type,
        status: 'active',
        startDate,
        endDate,
        focusDays: type === 'focused' ? focusDays : undefined,
        focusLocation: type === 'focused' ? focusLocation : undefined,
      });
      await importMasterItems(id, csvRows);
      // token 取得
      const { getSessionById } = await import('@/lib/db');
      const sess = await getSessionById(id);
      setSessionId(id);
      setToken(sess?.token ?? '');
      setStep(3);
    } catch (e) {
      setError('作成に失敗しました: ' + String(e));
    } finally {
      setCreating(false);
    }
  }

  const countUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/count/${token}`
    : `/count/${token}`;

  return (
    <>
      <div className="bg-white border-b border-stone-200 px-8 h-14 flex items-center">
        <span className="font-semibold text-stone-900">棚卸し作成</span>
      </div>

      <div className="p-8 max-w-2xl">
        {/* ステップインジケーター */}
        <div className="flex items-center gap-0 mb-8">
          {([1,2,3] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center gap-2 text-sm
                ${step === s ? 'text-[#1A3A2A] font-semibold' : step > s ? 'text-emerald-600' : 'text-stone-400'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                  ${step === s ? 'bg-[#1A3A2A] text-white' : step > s ? 'bg-emerald-500 text-white' : 'bg-stone-200 text-stone-400'}`}>
                  {step > s ? '✓' : s}
                </div>
                {['基本設定', 'マスタ取込', 'URL発行'][i]}
              </div>
              {s < 3 && <div className="w-10 h-px bg-stone-200 mx-3" />}
            </div>
          ))}
        </div>

        {error && <Alert variant="danger" className="mb-4">{error}</Alert>}

        {/* Step 1 */}
        {step === 1 && (
          <Card className="p-6 space-y-5">
            <h2 className="font-bold text-base text-stone-900">棚卸し種別・基本情報</h2>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-stone-500">棚卸し種別</label>
              <div className="flex gap-3">
                {(['full', 'focused'] as InvType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all
                      ${type === t
                        ? 'bg-[#E8F0EC] border-[#4A7A5A] text-[#1A3A2A]'
                        : 'bg-white border-stone-300 text-stone-500 hover:border-stone-400'}`}
                  >
                    {t === 'full' ? '一斉棚卸し' : '重点棚卸し'}
                  </button>
                ))}
              </div>
            </div>

            {type === 'focused' && (
              <div className="bg-stone-50 rounded-lg p-4 space-y-3 border border-stone-200">
                <p className="text-xs font-semibold text-stone-500">絞り込み条件</p>
                <div className="flex items-center gap-2">
                  <Input
                    label="入出荷期間（過去N日）"
                    type="number"
                    value={focusDays}
                    onChange={e => setFocusDays(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-sm text-stone-500 mt-5">日間</span>
                </div>
                <Input
                  label="対象ロケーション（任意）"
                  value={focusLocation}
                  onChange={e => setFocusLocation(e.target.value)}
                  placeholder="例：2X-13（空欄で全体）"
                />
                {csvRows.length > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-sm text-emerald-700">
                    📦 対象品目数（プレビュー）：<strong>{previewCount}</strong> 件
                  </div>
                )}
              </div>
            )}

            <Input
              label="棚卸し名 *"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：2026年6月 月次棚卸し"
            />

            <div className="grid grid-cols-2 gap-4">
              <Input label="実施開始日" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <Input label="実施終了予定日" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="primary" onClick={() => { if (!name.trim()) { setError('棚卸し名を入力してください'); return; } setError(''); setStep(2); }}>
                次へ → マスタ取込
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <Card className="p-6 space-y-5">
            <h2 className="font-bold text-base text-stone-900">マスタCSV取込</h2>

            <Alert variant="info">
              ロジレスWMSから「在庫一覧CSV」をエクスポートしてアップロードしてください。
            </Alert>

            <input ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleCsvFile(e.target.files[0]); }} />

            <div
              onClick={() => fileRef.current?.click()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleCsvFile(e.dataTransfer.files[0]); }}
              onDragOver={e => e.preventDefault()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                ${csvRows.length > 0
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-stone-300 hover:border-[#4A7A5A] hover:bg-[#E8F0EC]/30'}`}
            >
              <div className="text-3xl mb-2">{csvRows.length > 0 ? '✅' : '📂'}</div>
              {csvRows.length > 0 ? (
                <p className="text-sm font-semibold text-emerald-700">{csvName} を読み込みました（{csvRows.length}件）</p>
              ) : (
                <p className="text-sm text-stone-500">クリックしてCSVファイルを選択<br/>または、ここにドラッグ＆ドロップ</p>
              )}
            </div>

            {csvRows.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-stone-500 mb-2">取込プレビュー（先頭3件）</p>
                <div className="overflow-x-auto rounded-lg border border-stone-200">
                  <table className="w-full text-xs">
                    <thead className="bg-stone-50">
                      <tr>
                        {['ロケーション','商品CD','商品名','保管中','ピッキング中'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-stone-400">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.slice(0, 3).map((r, i) => (
                        <tr key={i} className="border-t border-stone-100">
                          <td className="px-3 py-2 font-mono">{r.location}</td>
                          <td className="px-3 py-2 font-mono">{r.productCd}</td>
                          <td className="px-3 py-2">{r.productName}</td>
                          <td className="px-3 py-2 text-right">{r.systemQty}</td>
                          <td className="px-3 py-2 text-right">{r.pickingQty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button onClick={() => setStep(1)}>← 戻る</Button>
              <Button variant="primary" disabled={csvRows.length === 0 || creating} onClick={handleCreate}>
                {creating ? '作成中...' : '棚卸しを作成 →'}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <Card className="p-6">
            <div className="text-center py-4">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-bold text-stone-900 mb-2">棚卸しを作成しました</h2>
              <p className="text-sm text-stone-500 mb-6">下記URLを現場スタッフに共有してください</p>
              <div className="bg-stone-50 border border-stone-200 rounded-lg px-4 py-3 flex items-center gap-3 text-left mb-2">
                <code className="text-sm text-stone-600 flex-1 break-all">{countUrl}</code>
                <Button size="sm" onClick={() => navigator.clipboard.writeText(countUrl)}>コピー</Button>
              </div>
              <p className="text-xs text-stone-400 mb-8">※ このURLを知っている人は誰でもアクセスできます。関係者のみに共有してください</p>
              <div className="flex justify-center gap-3">
                <Button onClick={() => router.push('/admin')}>棚卸し一覧へ</Button>
                <Button variant="primary" onClick={() => router.push(`/admin/report?session=${sessionId}`)}>
                  📊 レポートを確認
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
