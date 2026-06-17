'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSessionByToken, getShelvesForSession, getMasterItems, getCountRecords, submitCount, addMasterItem, completeShelf } from '@/lib/db';
import type { InventorySession, MasterItem, ShelfProgress } from '@/types';

type Screen =
  | 'loading'
  | 'error'
  | 'staff-input'
  | 'select-building'
  | 'select-aisle'
  | 'select-shelf'
  | 'item-list'
  | 'recount-confirm'
  | 'count-input'
  | 'count-result'
  | 'shelf-complete'
  | 'add-product';

interface CountResult {
  productName: string;
  systemQty: number;
  actualQty: number;
  diff: number;
}

interface CountedInfo {
  diff: number;
  isRecounted: boolean;
  isAdded: boolean;
}

interface CountState {
  scanned: boolean;
  qty: string;
  expiryOpen: boolean;
  expiry: string;
  comment: string;
}

const CAUSE_OPTIONS = [
  '計数ミス（再カウント済）', '入庫処理漏れ', '出庫処理漏れ',
  'ロケーション誤配置', '破損・廃棄処理漏れ', 'その他',
];

export default function CounterApp({ token }: { token: string }) {
  const [screen, setScreen]       = useState<Screen>('loading');
  const [session, setSession]     = useState<InventorySession | null>(null);
  const [staffName, setStaffName] = useState('');
  const [shelves, setShelves]     = useState<ShelfProgress[]>([]);
  const [items, setItems]         = useState<MasterItem[]>([]);
  const [counted, setCounted]     = useState<Map<string, CountedInfo>>(new Map());

  // drill-down state
  const [building, setBuilding] = useState('');
  const [aisle, setAisle]       = useState('');
  const [shelf, setShelf]       = useState('');
  const [shelfKey, setShelfKey] = useState('');

  // count input state
  const [currentItem, setCurrentItem] = useState<MasterItem | null>(null);
  const [countState, setCountState]   = useState<CountState>({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [qtyLimitHit, setQtyLimitHit] = useState(false);
  const [countResult, setCountResult] = useState<CountResult | null>(null);
  const [isRecountMode, setIsRecountMode] = useState(false);

  // 商品追加フォーム
  const [addForm, setAddForm] = useState({ dan: '', retsu: '', productCd: '', productName: '', qty: '', expiryDate: '' });
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);

  // ロード
  useEffect(() => {
    getSessionByToken(token).then(async sess => {
      if (!sess) { setScreen('error'); return; }
      setSession(sess);
      // staffNameをlocalStorageから復元
      const saved = localStorage.getItem(`staff_${sess.id}`);
      if (saved) {
        setStaffName(saved);
        setScreen('select-building');
      }
      else setScreen('staff-input');
    }).catch(() => setScreen('error'));
  }, [token]);

  // 棚一覧を取得
  const loadShelves = useCallback(async () => {
    if (!session) return;
    try {
      const s = await getShelvesForSession(session.id, session.completedShelfKeys);
      setShelves(s);
    } catch (e) {
      setError('棚データの読み込みに失敗しました: ' + String(e));
    }
  }, [session]);

  useEffect(() => { loadShelves(); }, [loadShelves]);

  // 棟・通路・棚の選択画面に移動するたびに進捗を再取得
  useEffect(() => {
    if (['select-building', 'select-aisle', 'select-shelf'].includes(screen)) {
      loadShelves();
    }
  }, [screen, loadShelves]);

  // 棚のアイテム取得
  async function loadShelfItems(key: string) {
    if (!session) return;
    const all = await getMasterItems(session.id);
    setItems(all.filter(i => i.locationKey === key));
  }

  // 建物・通路・棚の一覧生成
  const buildings = [...new Set(shelves.map(s => s.building))].sort();
  const aisles    = [...new Set(shelves.filter(s => s.building === building).map(s => s.aisle))].sort();
  const shelfList = shelves.filter(s => s.building === building && s.aisle === aisle);

  function startCount() {
    if (!staffName.trim()) { setError('担当者名を入力してください'); return; }
    localStorage.setItem(`staff_${session!.id}`, staffName.trim());
    setScreen('select-building');
  }

  function selectBuilding(b: string) { setBuilding(b); setScreen('select-aisle'); }
  function selectAisle(a: string)    { setAisle(a); setScreen('select-shelf'); }
  async function selectShelf(s: ShelfProgress) {
    setShelf(s.shelf);
    setShelfKey(s.locationKey);
    await loadShelfItems(s.locationKey);
    // 計数済みアイテムを取得してMapに
    const recs = await getCountRecords(session!.id);
    const map = new Map(
      recs
        .filter(r => r.location.startsWith(s.locationKey))
        .map(r => [r.masterItemId, {
          diff: r.diff,
          isRecounted: r.isRecounted ?? false,
          isAdded: r.isAdded ?? false,
        }])
    );
    setCounted(map);
    setScreen('item-list');
  }

  function openItem(item: MasterItem) {
    setCurrentItem(item);
    setCountState({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
    setError('');
    const info = counted.get(item.id);
    if (info && info.diff !== 0 && !info.isAdded) {
      // 差異あり → リカウント確認画面へ
      setCountResult({
        productName: item.productName,
        systemQty: item.systemQty,
        actualQty: item.systemQty + info.diff,
        diff: info.diff,
      });
      setIsRecountMode(false);
      setScreen('recount-confirm');
    } else {
      setIsRecountMode(false);
      setScreen('count-input');
    }
  }

  function keyPress(k: string) {
    setCountState(prev => {
      if (k === 'del') return { ...prev, qty: prev.qty.slice(0, -1) };
      if (prev.qty.length >= 6) {
        setQtyLimitHit(true);
        setTimeout(() => setQtyLimitHit(false), 500);
        return prev;
      }
      return { ...prev, qty: prev.qty + k };
    });
  }

  async function submitItem() {
    if (!countState.qty) { setError('数量を入力してください'); return; }
    if (!currentItem || !session) return;
    const isRecounting = isRecountMode;
    setSubmitting(true);
    setError('');
    try {
      const actualQty = parseInt(countState.qty, 10);
      await submitCount({
        sessionId:   session.id,
        masterItemId: currentItem.id,
        location:    currentItem.location,
        productCd:   currentItem.productCd,
        productName: currentItem.productName,
        systemQty:   currentItem.systemQty,
        actualQty,
        staffName:   staffName,
        expiryDate:        countState.expiry || undefined,
        masterExpiryDate:  currentItem.expiryDate || undefined,
        masterLotNumber:   currentItem.lotNumber || undefined,
        comment:           countState.comment || undefined,
      });
      const diff = actualQty - currentItem.systemQty;
      setCounted(prev => {
        const next = new Map(prev);
        next.set(currentItem.id, { diff, isRecounted: isRecounting, isAdded: false });
        return next;
      });
      setCountResult({
        productName: currentItem.productName,
        systemQty:   currentItem.systemQty,
        actualQty,
        diff,
      });
      setIsRecountMode(false);
      setScreen('count-result');
    } catch (e) {
      setError('送信に失敗しました: ' + String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const shelfItems    = items.sort((a, b) => a.location.localeCompare(b.location));
  const doneCount     = shelfItems.filter(i => counted.has(i.id)).length;
  const allDone       = shelfItems.length > 0 && doneCount === shelfItems.length;
  const diffUnresolved = [...counted.values()].filter(c => c.diff !== 0 && !c.isRecounted && !c.isAdded).length;

  // ── レンダリング ──────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* ステータスバー風ヘッダー */}
      <div className="bg-[#1A3A2A] px-4 h-12 flex items-center justify-between sticky top-0 z-10">
        <span className="text-white/80 text-sm font-medium truncate">{session?.name ?? '棚卸し'}</span>
        <span className="text-white/60 text-xs">{staffName}</span>
      </div>

      {/* ── 計数入力（フルハイト専用レイアウト） ── */}
      {screen === 'count-input' && currentItem && (
        <div className="flex flex-col h-[calc(100dvh-48px)] px-4 pt-2 pb-3 max-w-md mx-auto">
          <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} />

          {/* アイテム情報（コンパクト） */}
          <div className="mb-2 shrink-0">
            {isRecountMode && (
              <span className="inline-block mb-1.5 px-2.5 py-0.5 bg-amber-100 text-amber-700 text-[11px] font-bold rounded-full">リカウントモード</span>
            )}
            <p className="text-[11px] text-stone-400 mb-0.5">{currentItem.location} / {currentItem.productCd}</p>
            <p className="text-[15px] font-bold leading-snug text-stone-950">{currentItem.productName}</p>
            {currentItem.expiryDate && (
              <p className="text-xs text-amber-600 mt-0.5">出荷期限日: {currentItem.expiryDate}</p>
            )}
            <a
              href={`https://orderie.jp/component/g/g${currentItem.productCd}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[#4A7A5A] underline"
            >
              orderie で確認
            </a>
          </div>

          {/* 数量表示 */}
          <div className={`rounded-xl text-center p-2.5 mb-2 shrink-0 transition-colors duration-150
            ${qtyLimitHit ? 'bg-red-100' : 'bg-stone-100'}`}>
            <p className="text-[11px] text-stone-400 mb-0.5">実数量{qtyLimitHit && <span className="text-red-500 ml-1">（上限6桁）</span>}</p>
            <p className="text-5xl font-bold tracking-[4px] leading-none text-stone-950">
              {countState.qty || <span className="text-stone-300">-</span>}
            </p>
          </div>

          {/* テンキー（flex-1で残りスペースを埋める） */}
          <div className="grid grid-cols-3 gap-1.5 flex-1 min-h-0">
            {['7','8','9','4','5','6','1','2','3','⌫','0','送信'].map(k => (
              <button
                key={k}
                onClick={() => {
                  if (k === '⌫') keyPress('del');
                  else if (k === '送信') submitItem();
                  else keyPress(k);
                }}
                className={`w-full h-full rounded-xl font-medium transition-transform duration-75 active:scale-95
                  ${k === '送信'
                    ? 'bg-[#1A3A2A] text-white text-base border-0'
                    : k === '⌫'
                    ? 'bg-stone-100 text-stone-500 text-base border border-stone-200'
                    : 'bg-white text-stone-950 text-[22px] border border-stone-200'}`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* 賞味期限・コメント（折りたたみ） */}
          <div className="shrink-0 mt-2">
            <button
              onClick={() => setCountState(prev => ({ ...prev, expiryOpen: !prev.expiryOpen }))}
              className="w-full text-left px-3 py-2 text-[13px] text-stone-500 bg-stone-100 rounded-[10px] flex justify-between"
            >
              <span>賞味期限 / コメント（任意）</span>
              <span>{countState.expiryOpen ? '▲' : '▼'}</span>
            </button>
            {countState.expiryOpen && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                <input
                  type="date"
                  value={countState.expiry}
                  onChange={e => setCountState(prev => ({ ...prev, expiry: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-[10px] outline-none"
                />
                <textarea
                  value={countState.comment}
                  onChange={e => setCountState(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="コメント（任意）"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-stone-300 rounded-[10px] outline-none resize-none"
                />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
      )}

      <div className={`px-4 py-5 max-w-md mx-auto ${screen === 'count-input' ? 'hidden' : ''}`}>

        {/* ── 計数結果FB ── */}
        {screen === 'count-result' && countResult && (
          <div className="pt-6">
            <div className="text-center mb-6">
              <div className="text-4xl mb-2">
                {countResult.diff === 0 ? '✅' : countResult.diff > 0 ? '📈' : '📉'}
              </div>
              <p className="text-sm text-stone-500 font-medium">計数完了</p>
              <p className="text-base font-bold text-stone-900 mt-1 leading-snug">{countResult.productName}</p>
            </div>

            <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden mb-5">
              <div className="grid grid-cols-3 divide-x divide-stone-100">
                <div className="text-center py-5 px-3">
                  <p className="text-[11px] text-stone-400 mb-1">理論値</p>
                  <p className="text-2xl font-bold text-stone-700">{countResult.systemQty}</p>
                </div>
                <div className="text-center py-5 px-3">
                  <p className="text-[11px] text-stone-400 mb-1">実数量</p>
                  <p className="text-2xl font-bold text-stone-900">{countResult.actualQty}</p>
                </div>
                <div className="text-center py-5 px-3">
                  <p className="text-[11px] text-stone-400 mb-1">差異</p>
                  <p className={`text-2xl font-bold
                    ${countResult.diff === 0 ? 'text-emerald-600'
                    : countResult.diff > 0 ? 'text-red-600'
                    : 'text-amber-600'}`}>
                    {countResult.diff === 0 ? '±0' : countResult.diff > 0 ? `+${countResult.diff}` : countResult.diff}
                  </p>
                </div>
              </div>
              {countResult.diff !== 0 && (
                <div className={`px-4 py-2.5 text-xs text-center font-medium
                  ${countResult.diff > 0 ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {countResult.diff > 0 ? `システムより ${countResult.diff} 個多い` : `システムより ${Math.abs(countResult.diff)} 個少ない`}
                </div>
              )}
            </div>

            <div className={`flex flex-col gap-3 ${countResult.diff !== 0 ? '' : ''}`}>
              {countResult.diff !== 0 && (
                <button
                  onClick={() => {
                    setCountState({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
                    setError('');
                    setScreen('count-input');
                  }}
                  className="w-full py-4 bg-white border-2 border-[#1A3A2A] text-[#1A3A2A] font-bold text-base rounded-xl active:scale-[0.98] transition-transform"
                >
                  もう一度計数する
                </button>
              )}
              <button
                onClick={() => setScreen('item-list')}
                className="w-full py-4 bg-[#1A3A2A] text-white font-bold text-base rounded-xl active:scale-[0.98] transition-transform"
              >
                一覧に戻る
              </button>
            </div>
          </div>
        )}

        {/* ── リカウント確認 ── */}
        {screen === 'recount-confirm' && currentItem && countResult && (
          <div className="pt-2">
            <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} />
            <div className="flex items-center gap-2 mb-4">
              <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">リカウントモード</span>
            </div>
            <h1 className="text-base font-bold text-stone-900 leading-snug mb-0.5">{currentItem.productName}</h1>
            <p className="text-xs text-stone-400 mb-4">{currentItem.location} ／ {currentItem.productCd}</p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden mb-5">
              <p className="text-xs font-medium text-amber-700 px-4 pt-3 pb-2">前回の計数結果</p>
              <div className="grid grid-cols-3 divide-x divide-amber-200 border-t border-amber-200">
                <div className="text-center py-4 px-3">
                  <p className="text-[11px] text-amber-600 mb-1">理論値</p>
                  <p className="text-xl font-bold text-stone-700">{countResult.systemQty}</p>
                </div>
                <div className="text-center py-4 px-3">
                  <p className="text-[11px] text-amber-600 mb-1">実数量</p>
                  <p className="text-xl font-bold text-stone-900">{countResult.actualQty}</p>
                </div>
                <div className="text-center py-4 px-3">
                  <p className="text-[11px] text-amber-600 mb-1">差異</p>
                  <p className={`text-xl font-bold ${countResult.diff > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {countResult.diff > 0 ? `+${countResult.diff}` : countResult.diff}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  setCountState({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
                  setError('');
                  setIsRecountMode(true);
                  setScreen('count-input');
                }}
                className="w-full py-4 bg-[#1A3A2A] text-white font-bold text-base rounded-xl active:scale-[0.98] transition-transform"
              >
                リカウント開始
              </button>
              <button
                onClick={() => setScreen('item-list')}
                className="w-full py-3 border border-stone-300 text-stone-600 text-sm font-medium rounded-xl"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}

        {/* ── ローディング ── */}
        {screen === 'loading' && (
          <div className="flex items-center justify-center h-64 text-stone-400 text-sm">読み込み中...</div>
        )}

        {/* ── エラー ── */}
        {screen === 'error' && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">❌</div>
            <p className="text-stone-600 font-medium">URLが無効です</p>
            <p className="text-sm text-stone-400 mt-2">管理者に正しいURLを確認してください</p>
          </div>
        )}

        {/* ── 担当者入力 ── */}
        {screen === 'staff-input' && (
          <div className="pt-12 text-center">
            <div className="text-5xl mb-4">📦</div>
            <h1 className="text-xl font-bold mb-1">{session?.name}</h1>
            <p className="text-sm text-stone-500 mb-8">棚卸しを開始します</p>
            <div className="text-left space-y-3">
              <label className="block text-xs font-medium text-stone-500">担当者名</label>
              <input
                className="w-full px-4 py-3 text-base border border-stone-300 rounded-xl outline-none focus:border-[#4A7A5A] bg-white"
                placeholder="例：田中 一郎"
                value={staffName}
                onChange={e => setStaffName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startCount()}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={startCount}
                className="w-full py-3 bg-[#1A3A2A] text-white font-semibold rounded-xl text-base active:scale-[0.98] transition-all"
              >
                開始する →
              </button>
            </div>
          </div>
        )}

        {/* ── 棟選択 ── */}
        {screen === 'select-building' && (
          <>
            <DrillHeader title="棟を選択" sub="担当する棟を選んでください" />
            <div className="space-y-2">
              {buildings.map(b => {
                const s = shelves.filter(s => s.building === b);
                const done = s.filter(s => s.isCompleted).length;
                const allCompleted = s.length > 0 && done === s.length;
                return (
                  <DrillItem key={b} label={`${b}棟`} badge={allCompleted ? '完了' : `${done}/${s.length}棚`} progress={done/s.length}
                    isCompleted={allCompleted}
                    onClick={() => selectBuilding(b)} />
                );
              })}
            </div>
          </>
        )}

        {/* ── 通路選択 ── */}
        {screen === 'select-aisle' && (
          <>
            <BackButton label="棟選択に戻る" onClick={() => setScreen('select-building')} />
            <DrillHeader title="通路を選択" sub={`${building}棟`} />
            <div className="space-y-2">
              {aisles.map(a => {
                const s = shelves.filter(s => s.building === building && s.aisle === a);
                const done = s.filter(s => s.isCompleted).length;
                const allCompleted = s.length > 0 && done === s.length;
                return (
                  <DrillItem key={a} label={`${a}通路`} badge={allCompleted ? '完了' : `${done}/${s.length}棚`} progress={done/s.length}
                    isCompleted={allCompleted}
                    onClick={() => selectAisle(a)} />
                );
              })}
            </div>
          </>
        )}

        {/* ── 棚選択 ── */}
        {screen === 'select-shelf' && (
          <>
            <BackButton label="通路選択に戻る" onClick={() => setScreen('select-aisle')} />
            <DrillHeader title="棚を選択" sub={`${building}棟 ${aisle}通路`} />
            <div className="space-y-2">
              {shelfList.map(s => (
                <DrillItem
                  key={s.locationKey}
                  label={`${s.shelf}棚`}
                  badge={s.isCompleted ? '完了' : `${s.completedItems}/${s.totalItems}件`}
                  progress={s.completedItems / s.totalItems}
                  isCompleted={s.isCompleted}
                  onClick={() => selectShelf(s)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── アイテム一覧 ── */}
        {screen === 'item-list' && (
          <>
            <BackButton label="棚選択に戻る" onClick={() => setScreen('select-shelf')} />
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-lg font-bold">{shelfKey} 棚</h1>
                <p className="text-sm text-stone-400">
                  {doneCount}/{shelfItems.length}件完了
                  {diffUnresolved > 0 && (
                    <span className="ml-2 text-amber-600 font-medium">差異{diffUnresolved}件 要リカウント</span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAddForm({ dan: '', retsu: '', productCd: '', productName: '', qty: '', expiryDate: '' }); setAddError(''); setScreen('add-product'); }}
                  className="px-3 py-1.5 bg-white border border-stone-300 text-stone-700 text-sm font-medium rounded-lg"
                >
                  ＋ 商品追加
                </button>
                {allDone && (
                  <button
                    onClick={async () => {
                      await completeShelf(session!.id, shelfKey);
                      await loadShelves();
                      setScreen('shelf-complete');
                    }}
                    className="px-4 py-2 bg-[#1A3A2A] text-white text-sm font-semibold rounded-lg"
                  >
                    完了にする
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {shelfItems.map(item => {
                const info = counted.get(item.id);
                const done = !!info;
                const hasDiff = done && info.diff !== 0 && !info.isAdded;
                const unrecounted = hasDiff && !info.isRecounted;  // 差異あり・未リカウント
                const recounted   = done && info.isRecounted;      // リカウント済（差異有無問わず）
                return (
                  <div
                    key={`${item.location}::${item.productCd}`}
                    onClick={() => openItem(item)}
                    className={`border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors
                      ${unrecounted ? 'bg-amber-50 border-amber-200 active:bg-amber-100'
                      : 'bg-white border-stone-200 active:bg-stone-50'}`}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                      ${!done       ? 'bg-stone-300'
                      : unrecounted ? 'bg-amber-400'
                      : 'bg-emerald-500'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-xs text-stone-400">{item.location} ／ {item.productCd}</p>
                      {item.expiryDate && <p className="text-xs text-amber-600">期限: {item.expiryDate}</p>}
                      {unrecounted && (
                        <p className="text-xs text-amber-700 font-medium mt-0.5">
                          差異 {info.diff > 0 ? `+${info.diff}` : info.diff} ／ タップしてリカウント
                        </p>
                      )}
                      {recounted && (
                        <p className="text-xs text-emerald-600 font-medium mt-0.5">リカウント済</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded shrink-0
                      ${!done       ? 'bg-stone-100 text-stone-500'
                      : unrecounted ? 'bg-amber-100 text-amber-700'
                      : recounted   ? 'bg-blue-50 text-blue-600'
                      : 'bg-emerald-50 text-emerald-700'}`}>
                      {!done ? '未' : unrecounted ? '差異あり' : recounted ? 'リカウント済' : '済'}
                    </span>
                  </div>
                );
              })}
            </div>
            {!allDone && (
              <button
                onClick={async () => {
                  await completeShelf(session!.id, shelfKey);
                  await loadShelves();
                  setScreen('shelf-complete');
                }}
                className="w-full mt-4 py-3 border border-stone-300 text-stone-600 text-sm font-medium rounded-xl"
              >
                この棚を完了にする
              </button>
            )}
          </>
        )}

        {/* count-input は外側の専用レイアウトで描画 */}

        {/* ── 商品追加 ── */}
        {screen === 'add-product' && (
          <>
            <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} />
            <div className="mb-5">
              <h1 className="text-lg font-bold">商品を追加</h1>
              <p className="text-sm text-stone-400 mt-0.5">{shelfKey} 棚 ／ 想定外の商品を登録</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-stone-500 mb-2">ロケーション ※</label>
                <div className="flex items-center gap-1.5">
                  <div className="px-3.5 py-3 text-base font-semibold bg-stone-100 border-2 border-stone-200 rounded-xl text-stone-600 whitespace-nowrap">
                    {shelfKey}
                  </div>
                  <span className="text-lg text-stone-400 font-bold">-</span>
                  <input
                    value={addForm.dan}
                    onChange={e => setAddForm(p => ({...p, dan: e.target.value}))}
                    placeholder="段"
                    inputMode="numeric"
                    className="w-16 py-3 px-2 text-base border-2 border-stone-300 rounded-xl outline-none text-center"
                  />
                  <span className="text-lg text-stone-400 font-bold">-</span>
                  <input
                    value={addForm.retsu}
                    onChange={e => setAddForm(p => ({...p, retsu: e.target.value}))}
                    placeholder="列"
                    inputMode="numeric"
                    className="w-16 py-3 px-2 text-base border-2 border-stone-300 rounded-xl outline-none text-center"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">商品CD / 識別CD</label>
                <input
                  value={addForm.productCd}
                  onChange={e => setAddForm(p => ({...p, productCd: e.target.value}))}
                  placeholder="例: 00127"
                  className="block w-full p-3 text-base border-2 border-stone-300 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">商品名</label>
                <input
                  value={addForm.productName}
                  onChange={e => setAddForm(p => ({...p, productName: e.target.value}))}
                  placeholder="例: 金太洋 栗甘露煮"
                  className="block w-full p-3 text-base border-2 border-stone-300 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">出荷期限日</label>
                <input
                  type="date"
                  value={addForm.expiryDate}
                  onChange={e => setAddForm(p => ({...p, expiryDate: e.target.value}))}
                  className="block w-full p-3 text-base border-2 border-stone-300 rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-stone-500 mb-1">数量</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={addForm.qty}
                  onChange={e => setAddForm(p => ({...p, qty: e.target.value}))}
                  placeholder="0"
                  className="block w-full p-3 text-2xl font-bold border-2 border-stone-300 rounded-xl outline-none text-center"
                />
              </div>
              {addError && <p className="text-xs text-red-500">{addError}</p>}
              <button
                disabled={adding}
                onClick={async () => {
                  if (!shelfKey) { setAddError('ロケーションが取得できません'); return; }
                  setAdding(true);
                  setAddError('');
                  try {
                    const loc = [shelfKey, addForm.dan.trim(), addForm.retsu.trim()].filter(Boolean).join('-');
                    const itemId = await addMasterItem(session!.id, {
                      location: loc,
                      productCd: addForm.productCd.trim(),
                      productName: addForm.productName.trim(),
                    });
                    await submitCount({
                      sessionId: session!.id,
                      masterItemId: itemId,
                      location: loc,
                      productCd: addForm.productCd.trim(),
                      productName: addForm.productName.trim(),
                      systemQty: 0,
                      actualQty: parseInt(addForm.qty || '0', 10),
                      staffName,
                      masterExpiryDate: addForm.expiryDate.trim() || undefined,
                      isAdded: true,
                    });
                    setCounted(prev => {
                      const next = new Map(prev);
                      next.set(itemId, { diff: parseInt(addForm.qty || '0', 10), isRecounted: false, isAdded: true });
                      return next;
                    });
                    await loadShelfItems(shelfKey);
                    setScreen('item-list');
                  } catch (e) {
                    setAddError('追加に失敗しました: ' + String(e));
                  } finally {
                    setAdding(false);
                  }
                }}
                className="block w-full py-4 bg-[#1A3A2A] text-white font-bold text-base rounded-xl disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {adding ? '追加中...' : '追加する'}
              </button>
            </div>
          </>
        )}

        {/* ── 棚完了 ── */}
        {screen === 'shelf-complete' && (
          <div className="text-center pt-12">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-xl font-bold mb-2">棚の計数完了！</h1>
            <p className="text-sm text-stone-500 mb-8">{shelfKey} の計数が完了しました。</p>
            <div className="text-left bg-white border border-stone-200 rounded-xl p-4 mb-6">
              <p className="text-xs text-stone-400 mb-3">次の担当候補</p>
              {shelfList
                .filter(s => !s.isCompleted && s.locationKey !== shelfKey)
                .slice(0, 2)
                .map(s => (
                  <div
                    key={s.locationKey}
                    onClick={() => selectShelf(s)}
                    className="flex items-center justify-between py-3 border-b border-stone-100 last:border-0 cursor-pointer"
                  >
                    <span className="font-medium text-sm">{s.locationKey} 棚</span>
                    <span className="text-xs text-stone-400">{s.totalItems}件</span>
                  </div>
                ))}
            </div>
            <button
              onClick={() => setScreen('select-shelf')}
              className="w-full py-3 border border-stone-300 text-stone-700 font-medium rounded-xl text-sm"
            >
              別の棚へ
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── サブコンポーネント ──────────────────────────

function DrillHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-bold text-stone-900">{title}</h1>
      <p className="text-sm text-stone-400 mt-0.5">{sub}</p>
    </div>
  );
}

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-sm text-stone-400 mb-4 hover:text-stone-600">
      ← {label}
    </button>
  );
}

function DrillItem({ label, badge, badgeColor, progress, isCompleted, onClick }: {
  label: string; badge: string; badgeColor?: string; progress?: number; isCompleted?: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl px-4 py-3.5 flex items-center justify-between cursor-pointer transition-all
        ${isCompleted
          ? 'bg-emerald-500 border border-emerald-500 active:bg-emerald-600'
          : 'bg-white border border-stone-200 active:bg-stone-50'}`}
    >
      <div className="flex items-center gap-2.5 flex-1">
        {isCompleted && <span className="text-white text-base font-bold">✓</span>}
        <div>
          <span className={`font-medium text-sm ${isCompleted ? 'text-white' : 'text-stone-900'}`}>{label}</span>
          {!isCompleted && progress !== undefined && progress > 0 && (
            <div className="h-1 bg-stone-100 rounded-full mt-1.5 w-24">
              <div className="h-full bg-[#4A7A5A] rounded-full" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded
        ${isCompleted ? 'bg-white/20 text-white' : `bg-stone-100 text-stone-500 ${badgeColor ?? ''}`}`}>
        {badge}
      </span>
    </div>
  );
}
