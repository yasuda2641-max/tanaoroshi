'use client';
import { useRef, useState, useEffect } from 'react';
import { listSessions, importMasterItems, getMasterItems, parseMasterCsv, fixWmsItems, renameSession } from '@/lib/db';
import { decodeCsvFile } from '@/lib/csv';
import type { InventorySession, MasterItem } from '@/types';
import { Button, Card, Select, Alert, Loading } from '@/components/ui';

const PREVIEW_PAGE_SIZE = 50;

export default function MasterPage() {
  const [sessions, setSessions] = useState<InventorySession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [masterItems, setMasterItems] = useState<MasterItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemPage, setItemPage] = useState(1);
  const [csvRows, setCsvRows] = useState<ReturnType<typeof parseMasterCsv>>([]);
  const [csvName, setCsvName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [editingName, setEditingName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listSessions().then(list => {
      setSessions(list);
      if (list.length > 0) setSelectedId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setMasterItems([]);
    setItemSearch('');
    setItemPage(1);
    setItemsLoading(true);
    const s = sessions.find(s => s.id === selectedId);
    setEditingName(s?.name ?? '');
    getMasterItems(selectedId).then(items => {
      setMasterItems(items);
      setItemsLoading(false);
    });
  }, [selectedId, sessions]);

  async function handleFile(file: File) {
    const text = await decodeCsvFile(file);
    setCsvRows(parseMasterCsv(text));
    setCsvName(file.name);
  }

  async function handleReImport() {
    if (!selectedId || csvRows.length === 0) return;
    setUploading(true);
    setMessage('');
    try {
      await importMasterItems(selectedId, csvRows);
      const refreshed = await getMasterItems(selectedId);
      setMasterItems(refreshed);
      setItemSearch('');
      setItemPage(1);
      setMessage(`✅ ${refreshed.length}件を再取込しました（${new Date().toLocaleTimeString()}）`);
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
            <div className="flex gap-2 items-center">
              <input
                className="flex-1 px-3 py-2 text-sm border border-stone-300 rounded-lg outline-none focus:border-[#4A7A5A]"
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                placeholder="棚卸し名"
              />
              <Button
                size="sm"
                disabled={nameSaving || !editingName.trim() || editingName === session.name}
                onClick={async () => {
                  setNameSaving(true);
                  try {
                    await renameSession(selectedId, editingName.trim());
                    setSessions(prev => prev.map(s => s.id === selectedId ? { ...s, name: editingName.trim() } : s));
                    setMessage('✅ 棚卸し名を変更しました');
                  } catch (e) {
                    setMessage('❌ エラー: ' + String(e));
                  } finally {
                    setNameSaving(false);
                  }
                }}
              >
                {nameSaving ? '保存中...' : '名前を変更'}
              </Button>
            </div>
          )}

          {session && (
            <div className="bg-stone-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-2 border border-stone-200">
              <div><span className="text-stone-400">状態：</span>
                <span className={session.status === 'active' ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                  {session.status === 'active' ? '進行中' : '完了'}
                </span>
              </div>
              <div><span className="text-stone-400">登録件数：</span>
                {itemsLoading ? '読込中...' : `${masterItems.length}件`}
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

          <Button
            disabled={!selectedId || uploading}
            onClick={async () => {
              if (!selectedId) return;
              setUploading(true);
              setMessage('');
              try {
                const count = await fixWmsItems(selectedId);
                setMessage(`✅ WMSロケーション修復完了：${count}件を修正しました`);
              } catch (e) {
                setMessage('❌ エラー: ' + String(e));
              } finally {
                setUploading(false);
              }
            }}
          >
            WMSロケーション修復
          </Button>
        </Card>

        {/* アイテムプレビュー */}
        {selectedId && (
          <Card className="p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-200 flex items-center justify-between gap-3">
              <h2 className="font-bold text-sm text-stone-900 shrink-0">
                マスタアイテム一覧
                {!itemsLoading && <span className="text-stone-400 font-normal ml-2">（{masterItems.length}件）</span>}
              </h2>
              <input
                type="text"
                value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setItemPage(1); }}
                placeholder="ロケーション・商品CD・商品名で検索"
                className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-stone-300 rounded-md outline-none focus:border-[#4A7A5A]"
              />
            </div>
            {itemsLoading ? (
              <Loading />
            ) : (() => {
              const q = itemSearch.toLowerCase();
              const filtered = q
                ? masterItems.filter(i =>
                    i.location.toLowerCase().includes(q) ||
                    i.productCd.toLowerCase().includes(q) ||
                    i.productName.toLowerCase().includes(q)
                  )
                : masterItems;
              const totalPages = Math.max(1, Math.ceil(filtered.length / PREVIEW_PAGE_SIZE));
              const paged = filtered.slice((itemPage - 1) * PREVIEW_PAGE_SIZE, itemPage * PREVIEW_PAGE_SIZE);
              return filtered.length === 0 ? (
                <div className="text-center py-8 text-stone-400 text-sm">
                  {masterItems.length === 0 ? 'データがありません' : '該当するアイテムがありません'}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-stone-50 border-b border-stone-200">
                          {['ロケーション','商品CD','商品名','保管中','ピッキング中','出荷期限日'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {paged.map(item => (
                          <tr key={item.id} className="border-b border-stone-100 hover:bg-stone-50">
                            <td className="px-3 py-2.5 font-mono text-xs text-stone-600">{item.location}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-stone-600">{item.productCd}</td>
                            <td className="px-3 py-2.5 text-stone-800 max-w-[200px] truncate" title={item.productName}>{item.productName}</td>
                            <td className="px-3 py-2.5 text-right text-stone-700">{item.systemQty}</td>
                            <td className="px-3 py-2.5 text-right text-stone-400">{item.pickingQty}</td>
                            <td className="px-3 py-2.5 text-xs text-stone-500">{item.expiryDate ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="px-4 py-3 border-t border-stone-100 flex items-center justify-between">
                      <span className="text-xs text-stone-400">
                        {(itemPage - 1) * PREVIEW_PAGE_SIZE + 1}–{Math.min(itemPage * PREVIEW_PAGE_SIZE, filtered.length)} 件 / 全{filtered.length}件
                      </span>
                      <div className="flex gap-1">
                        <button onClick={() => setItemPage(p => Math.max(1, p - 1))} disabled={itemPage === 1}
                          className="px-2.5 py-1 text-xs border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">← 前へ</button>
                        <span className="px-2.5 py-1 text-xs text-stone-500">{itemPage} / {totalPages}</span>
                        <button onClick={() => setItemPage(p => Math.min(totalPages, p + 1))} disabled={itemPage === totalPages}
                          className="px-2.5 py-1 text-xs border border-stone-300 rounded disabled:opacity-40 hover:bg-stone-50">次へ →</button>
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </Card>
        )}

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
