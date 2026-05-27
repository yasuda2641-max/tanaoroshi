'use client';
import { useRef, useState, useEffect } from 'react';
import { listSessions, importMasterItems, getMasterItems, parseMasterCsv } from '@/lib/db';
import type { InventorySession } from '@/types';
import { Button, Card, Select, Alert, Loading } from '@/components/ui';

export default function MasterPage() {
  const [sessions, setSessions] = useState<InventorySession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseMasterCsv>>([]);
  const [csvName, setCsvName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSessions().then(list => {
      setSessions(list);
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setItemCount(null);
    getMasterItems(selectedId).then(items => setItemCount(items.length));
  }, [selectedId]);

  async function handleFile(file: File) {
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder('shift-jis').decode(buffer);
    setCsvRows(parseMasterCsv(text));
    setCsvName(file.name);
  }

  async function handleReImport() {
    if (!selectedId || csvRows.length === 0) return;
    setUploading(true);
    setMessage('');
    try {
      await importMasterItems(selectedId, csvRows);
      setItemCount(csvRows.length);
      setMessage(`✅ ${csvRows.length}件を再取込しました（${new Date().toLocaleTimeString()}）`);
      setCsvRows([]);
      setCsvName('');
    } catch (e) {
      setMessage('❌ エラー: ' + String(e));
    } finally {
      setUploading(false);
    }
  }

  const session = sessions.find(s => s.id === selectedId);

  return (
    <>
      <div className="bg-white border-b border-stone-200 px-8 h-14 flex items-center">
        <span className="font-semibold text-stone-900">マスタ管理</span>
      </div>

      <div className="p-8 max-w-2xl space-y-6">
        <Card className="p-6 space-y-5">
          <h2 className="font-bold text-base text-stone-900">マスタCSV管理</h2>
          <p className="text-sm text-stone-500">ロジレスWMSから取り込んだマスタデータを管理します。</p>

          <Select label="対象棚卸し" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>

          {session && (
            <div className="bg-stone-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-2 border border-stone-200">
              <div><span className="text-stone-400">状態：</span>
                <span className={session.status === 'active' ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                  {session.status === 'active' ? '進行中' : '完了'}
                </span>
              </div>
              <div><span className="text-stone-400">登録件数：</span>
                {itemCount === null ? '読込中...' : `${itemCount}件`}
              </div>
              <div><span className="text-stone-400">開始日：</span>{session.startDate}</div>
              <div><span className="text-stone-400">種別：</span>{session.type === 'full' ? '一斉' : '重点'}</div>
            </div>
          )}

          {session?.status === 'active' && (
            <Alert variant="warn">
              ⚠ 進行中の棚卸しにCSVを再取込すると、システム数量が更新されます。実施中は原則再取込しないでください。
            </Alert>
          )}

          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />

          <div
            onClick={() => fileRef.current?.click()}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            onDragOver={e => e.preventDefault()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
              ${csvRows.length > 0 ? 'border-emerald-400 bg-emerald-50' : 'border-stone-300 hover:border-[#4A7A5A]'}`}
          >
            <div className="text-3xl mb-2">{csvRows.length > 0 ? '✅' : '📂'}</div>
            {csvRows.length > 0 ? (
              <p className="text-sm font-semibold text-emerald-700">{csvName}（{csvRows.length}件）</p>
            ) : (
              <p className="text-sm text-stone-500">クリックしてCSVを選択</p>
            )}
          </div>

          {message && <p className="text-sm text-stone-600">{message}</p>}

          <Button
            variant="primary"
            disabled={csvRows.length === 0 || uploading}
            onClick={handleReImport}
          >
            {uploading ? '取込中...' : '再取込を実行'}
          </Button>
        </Card>

        {/* フォーマット仕様 */}
        <Card className="p-6">
          <h2 className="font-bold text-sm text-stone-900 mb-3">CSVフォーマット仕様</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-stone-50">
                <tr>
                  {['カラム名','型','説明'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-stone-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {[
                  ['ロケーション','文字列','棟-通路-棚-段-列（例: 2X-13-05-2-3）'],
                  ['商品CD','文字列','5桁以上・英数字混在あり（例: 0A1373-500）'],
                  ['商品名','文字列','表示・照合用'],
                  ['保管中','数値','システム数量として使用'],
                  ['ピッキング中','数値','参照のみ（差異計算対象外）'],
                ].map(([col, type, desc]) => (
                  <tr key={col}>
                    <td className="px-3 py-2 font-mono font-medium text-stone-700">{col}</td>
                    <td className="px-3 py-2 text-stone-500">{type}</td>
                    <td className="px-3 py-2 text-stone-500">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-stone-400 mt-3">※ 1行目はヘッダー行として読み飛ばします。文字コードはUTF-8推奨。</p>
        </Card>
      </div>
    </>
  );
}
