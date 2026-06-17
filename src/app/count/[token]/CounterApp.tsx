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

  // 建物・通路・棚の一覧生成
  const visibleShelves = isRecountMode ? shelves.filter(s => s.pendingRecountCount > 0) : shelves;
  const buildings = [...new Set(visibleShelves.map(s => s.building))].sort();
  const aisles    = [...new Set(visibleShelves.filter(s => s.building === building).map(s => s.aisle))].sort();
  const shelfList = visibleShelves.filter(s => s.building === building && s.aisle === aisle);

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
    // アイテムと計数レコードを並列取得
    const [all, recs] = await Promise.all([
      getMasterItems(session!.id),
      getCountRecords(session!.id),
    ]);
    const shelfItems = all.filter(i => i.locationKey === s.locationKey);
    const shelfItemIds = new Set(shelfItems.map(i => i.id));
    setItems(shelfItems);
    // masterItemId で厳密に絞る（startsWith は別棚のレコードを混入させる恐れあり）
    const map = new Map(
      recs
        .filter(r => shelfItemIds.has(r.masterItemId))
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
    setScreen('count-input');
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
    // リカウントモードで計数 or 既にリカウント済みならtrue（一度recountedになったらリセットしない）
    const isRecounting = isRecountMode || (counted.get(currentItem.id)?.isRecounted ?? false);
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
      setScreen('count-result');
    } catch (e) {
      setError('送信に失敗しました: ' + String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const allShelfItems  = [...items].sort((a, b) => a.location.localeCompare(b.location));
  const shelfItems     = isRecountMode
    ? allShelfItems.filter(i => { const c = counted.get(i.id); return c && c.diff !== 0 && !c.isRecounted && !c.isAdded; })
    : allShelfItems;
  const doneCount      = allShelfItems.filter(i => counted.has(i.id)).length;
  const diffUnresolved = [...counted.values()].filter(c => c.diff !== 0 && !c.isRecounted && !c.isAdded).length;
  const allDone        = allShelfItems.length > 0 && doneCount === allShelfItems.length && diffUnresolved === 0;

  // allDone になったら自動的に棚を完了にする（宣言後に配置してTDZを回避）
  useEffect(() => {
    if (allDone && session && shelfKey) {
      completeShelf(session.id, shelfKey).then(() => loadShelves());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone]);

  // ── レンダリング ──────────────────────────────
  const dm = isRecountMode;
  return (
    <div className={`min-h-screen transition-colors duration-300 ${dm ? 'bg-zinc-900' : 'bg-white'}`}>
      {/* ステータスバー風ヘッダー */}
      <div className={`px-4 h-12 flex items-center justify-between sticky top-0 z-10 transition-colors duration-300
        ${dm ? 'bg-zinc-950 border-b border-zinc-700' : 'bg-stone-900'}`}>
        <span className="text-white/90 text-sm font-medium truncate flex-1 min-w-0">{session?.name ?? '棚卸し'}</span>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {!['loading','error','staff-input','shelf-complete','add-product'].includes(screen) && (
            <div className={`flex items-center rounded-full p-0.5 text-[11px] font-semibold transition-colors duration-300
              ${dm ? 'bg-white/10' : 'bg-white/20'}`}>
              <button
                onClick={() => setIsRecountMode(false)}
                className={`px-2.5 py-0.5 rounded-full transition-colors ${!dm ? 'bg-white text-stone-900' : 'text-white/60 hover:text-white/90'}`}
              >
                計数
              </button>
              <button
                onClick={() => setIsRecountMode(true)}
                className={`px-2.5 py-0.5 rounded-full transition-colors ${dm ? 'bg-amber-400 text-zinc-900 font-bold' : 'text-white/60 hover:text-white/90'}`}
              >
                リカウント
              </button>
            </div>
          )}
          <span className="text-white/50 text-xs">{staffName}</span>
        </div>
      </div>

      {/* ── 計数入力（フルハイト専用レイアウト） ── */}
      {screen === 'count-input' && currentItem && (
        <div className="flex flex-col h-[calc(100dvh-48px)] px-4 pt-2 pb-3 max-w-md mx-auto">
          <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} dark={dm} />

          {/* アイテム情報（コンパクト） */}
          <div className="mb-2 shrink-0">
            <p className={`text-[11px] mb-0.5 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>{currentItem.location} / {currentItem.productCd}</p>
            <p className={`text-[15px] font-bold leading-snug ${dm ? 'text-zinc-100' : 'text-stone-950'}`}>{currentItem.productName}</p>
            {currentItem.expiryDate && (
              <p className="text-xs text-amber-500 mt-0.5">出荷期限日: {currentItem.expiryDate}</p>
            )}
            <a
              href={`https://orderie.jp/component/g/g${currentItem.productCd}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`text-[11px] underline ${dm ? 'text-amber-400' : 'text-stone-500'}`}
            >
              orderie で確認
            </a>
          </div>

          {/* 数量表示 */}
          <div className={`rounded-xl text-center p-2.5 mb-2 shrink-0 transition-colors duration-150
            ${qtyLimitHit
              ? dm ? 'bg-red-950/60' : 'bg-red-100'
              : dm ? 'bg-zinc-800' : 'bg-stone-100'}`}>
            <p className={`text-[11px] mb-0.5 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>
              実数量{qtyLimitHit && <span className="text-red-400 ml-1">（上限6桁）</span>}
            </p>
            <p className={`text-5xl font-bold tracking-[4px] leading-none ${dm ? 'text-zinc-100' : 'text-stone-950'}`}>
              {countState.qty || <span className={dm ? 'text-zinc-600' : 'text-stone-300'}>-</span>}
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
                    ? dm ? 'bg-amber-500 text-white text-base border-0' : 'bg-stone-900 text-white text-base border-0'
                    : k === '⌫'
                    ? dm ? 'bg-zinc-700 text-zinc-300 text-base border border-zinc-700' : 'bg-stone-100 text-stone-500 text-base border border-stone-200'
                    : dm ? 'bg-zinc-800 text-zinc-100 text-[22px] border border-zinc-700' : 'bg-white text-stone-950 text-[22px] border border-stone-200'}`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* 賞味期限・コメント（折りたたみ） */}
          <div className="shrink-0 mt-2">
            <button
              onClick={() => setCountState(prev => ({ ...prev, expiryOpen: !prev.expiryOpen }))}
              className={`w-full text-left px-3 py-2 text-[13px] rounded-[10px] flex justify-between
                ${dm ? 'bg-zinc-800 text-zinc-400' : 'bg-stone-100 text-stone-500'}`}
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
                  className={`w-full px-3 py-2 text-sm rounded-[10px] outline-none
                    ${dm ? 'bg-zinc-800 border border-zinc-700 text-zinc-100' : 'border border-stone-300'}`}
                />
                <textarea
                  value={countState.comment}
                  onChange={e => setCountState(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="コメント（任意）"
                  rows={2}
                  className={`w-full px-3 py-2 text-sm rounded-[10px] outline-none resize-none
                    ${dm ? 'bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border border-stone-300'}`}
                />
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
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
              <p className={`text-sm font-medium ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>計数完了</p>
              <p className={`text-base font-bold mt-1 leading-snug ${dm ? 'text-zinc-100' : 'text-stone-900'}`}>{countResult.productName}</p>
            </div>

            <div className={`rounded-2xl overflow-hidden mb-5 border ${dm ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-stone-200'}`}>
              <div className={`grid grid-cols-3 divide-x ${dm ? 'divide-zinc-700' : 'divide-stone-100'}`}>
                <div className="text-center py-5 px-3">
                  <p className={`text-[11px] mb-1 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>理論値</p>
                  <p className={`text-2xl font-bold ${dm ? 'text-zinc-400' : 'text-stone-700'}`}>{countResult.systemQty}</p>
                </div>
                <div className="text-center py-5 px-3">
                  <p className={`text-[11px] mb-1 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>実数量</p>
                  <p className={`text-2xl font-bold ${dm ? 'text-zinc-100' : 'text-stone-900'}`}>{countResult.actualQty}</p>
                </div>
                <div className="text-center py-5 px-3">
                  <p className={`text-[11px] mb-1 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>差異</p>
                  <p className={`text-2xl font-bold
                    ${countResult.diff === 0 ? 'text-emerald-500'
                    : countResult.diff > 0 ? 'text-red-400'
                    : 'text-amber-400'}`}>
                    {countResult.diff === 0 ? '±0' : countResult.diff > 0 ? `+${countResult.diff}` : countResult.diff}
                  </p>
                </div>
              </div>
              {countResult.diff !== 0 && (
                <div className={`px-4 py-2.5 text-xs text-center font-medium
                  ${countResult.diff > 0
                    ? dm ? 'bg-red-950/50 text-red-400' : 'bg-red-50 text-red-700'
                    : dm ? 'bg-amber-950/50 text-amber-400' : 'bg-amber-50 text-amber-700'}`}>
                  {countResult.diff > 0 ? `システムより ${countResult.diff} 個多い` : `システムより ${Math.abs(countResult.diff)} 個少ない`}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              {countResult.diff !== 0 && (
                <button
                  onClick={() => {
                    setCountState({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
                    setError('');
                    setScreen('count-input');
                  }}
                  className={`w-full py-4 font-bold text-base rounded-xl active:scale-[0.98] transition-transform border-2
                    ${dm ? 'bg-transparent border-zinc-700 text-zinc-300' : 'bg-white border-stone-900 text-stone-900'}`}
                >
                  もう一度計数する
                </button>
              )}
              <button
                onClick={() => setScreen(allDone ? 'shelf-complete' : 'item-list')}
                className={`w-full py-4 font-bold text-base rounded-xl active:scale-[0.98] transition-transform
                  ${dm ? 'bg-amber-500 text-white' : 'bg-stone-900 text-white'}`}
              >
                {allDone ? '棚完了 →' : '一覧に戻る'}
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
                className="w-full px-4 py-3 text-base border border-stone-300 rounded-xl outline-none focus:border-stone-500 bg-white"
                placeholder="例：田中 一郎"
                value={staffName}
                onChange={e => setStaffName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startCount()}
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                onClick={startCount}
                className="w-full py-3 bg-stone-900 text-white font-semibold rounded-xl text-base active:scale-[0.98] transition-all"
              >
                開始する →
              </button>
            </div>
          </div>
        )}

        {/* ── 棟選択 ── */}
        {screen === 'select-building' && (
          <>
            <DrillHeader title="棟を選択" sub="担当する棟を選んでください" dark={dm} />
            <div className="space-y-2">
              {buildings.map(b => {
                const s = shelves.filter(s => s.building === b);
                const done = s.filter(s => s.isCompleted).length;
                const allCompleted = s.length > 0 && done === s.length;
                return (
                  <DrillItem key={b} label={`${b}棟`} badge={allCompleted ? '完了' : `${done}/${s.length}棚`} progress={done/s.length}
                    isCompleted={allCompleted} dark={dm}
                    onClick={() => selectBuilding(b)} />
                );
              })}
            </div>
          </>
        )}

        {/* ── 通路選択 ── */}
        {screen === 'select-aisle' && (
          <>
            <BackButton label="棟選択に戻る" onClick={() => setScreen('select-building')} dark={dm} />
            <DrillHeader title="通路を選択" sub={`${building}棟`} dark={dm} />
            <div className="space-y-2">
              {aisles.map(a => {
                const s = shelves.filter(s => s.building === building && s.aisle === a);
                const done = s.filter(s => s.isCompleted).length;
                const allCompleted = s.length > 0 && done === s.length;
                return (
                  <DrillItem key={a} label={`${a}通路`} badge={allCompleted ? '完了' : `${done}/${s.length}棚`} progress={done/s.length}
                    isCompleted={allCompleted} dark={dm}
                    onClick={() => selectAisle(a)} />
                );
              })}
            </div>
          </>
        )}

        {/* ── 棚選択 ── */}
        {screen === 'select-shelf' && (
          <>
            <BackButton label="通路選択に戻る" onClick={() => setScreen('select-aisle')} dark={dm} />
            <DrillHeader title="棚を選択" sub={`${building}棟 ${aisle}通路`} dark={dm} />
            <div className="space-y-2">
              {shelfList.map(s => {
                const isPending       = s.pendingRecountCount > 0 && s.completedItems === s.totalItems;
                const trulyCompleted  = s.totalItems > 0 && s.completedItems === s.totalItems && s.pendingRecountCount === 0;
                const totalDiff       = s.recountedCount + s.pendingRecountCount;
                const countBadge      = trulyCompleted ? '完了'
                  : isPending ? `リカウント ${s.recountedCount}/${totalDiff}件`
                  : s.pendingRecountCount > 0 ? `${s.completedItems}/${s.totalItems}件 差異${s.pendingRecountCount}`
                  : `${s.completedItems}/${s.totalItems}件`;
                return (
                  <DrillItem
                    key={s.locationKey}
                    label={`${s.shelf}棚`}
                    badge={countBadge}
                    progress={s.completedItems / s.totalItems}
                    isCompleted={trulyCompleted}
                    isPending={isPending}
                    dark={dm}
                    onClick={() => selectShelf(s)}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* ── アイテム一覧 ── */}
        {screen === 'item-list' && (
          <>
            <BackButton label="棚選択に戻る" onClick={() => setScreen('select-shelf')} dark={dm} />
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className={`text-lg font-bold ${dm ? 'text-zinc-100' : ''}`}>{shelfKey} 棚</h1>
                <p className={`text-sm ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>
                  {isRecountMode
                    ? <span className="text-amber-400 font-medium">リカウント対象 {shelfItems.length}件</span>
                    : <>{doneCount}/{allShelfItems.length}件完了{diffUnresolved > 0 && <span className="ml-2 text-amber-600 font-medium">差異{diffUnresolved}件</span>}</>
                  }
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAddForm({ dan: '', retsu: '', productCd: '', productName: '', qty: '', expiryDate: '' }); setAddError(''); setScreen('add-product'); }}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg border
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-white border-stone-300 text-stone-700'}`}
                >
                  ＋ 商品追加
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {shelfItems.map(item => {
                const info = counted.get(item.id);
                const done = !!info;
                const hasDiff            = done && info.diff !== 0 && !info.isAdded;
                const unrecounted        = hasDiff && !info.isRecounted;
                const recountedWithDiff  = hasDiff && info.isRecounted;
                const recountedResolved  = done && info.isRecounted && !hasDiff;
                return (
                  <div
                    key={item.id}
                    onClick={() => openItem(item)}
                    className={`border rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-colors
                      ${unrecounted
                        ? dm ? 'bg-amber-950/40 border-amber-900/60 active:bg-amber-950/60' : 'bg-amber-50 border-amber-200 active:bg-amber-100'
                        : recountedWithDiff
                        ? dm ? 'bg-sky-950/40 border-sky-900/60 active:bg-sky-950/60' : 'bg-blue-50 border-blue-200 active:bg-blue-100'
                        : done
                        ? dm ? 'bg-emerald-950/40 border-emerald-900/60 active:bg-emerald-950/60' : 'bg-emerald-50 border-emerald-200 active:bg-emerald-100'
                        : dm ? 'bg-zinc-800 border-zinc-700 active:bg-zinc-700' : 'bg-white border-stone-200 active:bg-stone-50'}`}
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0
                      ${!done             ? dm ? 'bg-zinc-600' : 'bg-stone-300'
                      : unrecounted       ? 'bg-amber-400'
                      : recountedWithDiff ? 'bg-sky-400'
                      : 'bg-emerald-500'}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${dm ? 'text-zinc-100' : ''}`}>{item.productName}</p>
                      <p className={`text-xs ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>{item.location} ／ {item.productCd}</p>
                      {item.expiryDate && <p className="text-xs text-amber-500">期限: {item.expiryDate}</p>}
                      {unrecounted && (
                        <p className={`text-xs font-medium mt-0.5 ${dm ? 'text-amber-400' : 'text-amber-700'}`}>
                          差異 {info.diff > 0 ? `+${info.diff}` : info.diff} ／ タップしてリカウント
                        </p>
                      )}
                      {recountedWithDiff && (
                        <p className={`text-xs font-medium mt-0.5 ${dm ? 'text-sky-400' : 'text-blue-600'}`}>
                          リカウント済 ／ 差異 {info.diff > 0 ? `+${info.diff}` : info.diff} 継続
                        </p>
                      )}
                      {recountedResolved && (
                        <p className={`text-xs font-medium mt-0.5 ${dm ? 'text-emerald-400' : 'text-emerald-600'}`}>リカウント済 ／ 差異解消</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded shrink-0
                      ${!done
                        ? dm ? 'bg-zinc-700 text-zinc-300' : 'bg-stone-100 text-stone-500'
                        : unrecounted
                        ? dm ? 'bg-amber-900/60 text-amber-300' : 'bg-amber-100 text-amber-700'
                        : recountedWithDiff
                        ? dm ? 'bg-sky-900/60 text-sky-300' : 'bg-blue-100 text-blue-700'
                        : dm ? 'bg-emerald-900/60 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                      {!done ? '未' : unrecounted ? '差異あり' : recountedWithDiff ? 'リカウント済' : '済'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* count-input は外側の専用レイアウトで描画 */}

        {/* ── 商品追加 ── */}
        {screen === 'add-product' && (
          <>
            <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} dark={dm} />
            <div className="mb-5">
              <h1 className={`text-lg font-bold ${dm ? 'text-zinc-100' : ''}`}>商品を追加</h1>
              <p className={`text-sm mt-0.5 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>{shelfKey} 棚 ／ 想定外の商品を登録</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className={`block text-xs mb-2 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>ロケーション ※</label>
                <div className="flex items-center gap-1.5">
                  <div className={`px-3.5 py-3 text-base font-semibold border-2 rounded-xl whitespace-nowrap
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-300' : 'bg-stone-100 border-stone-200 text-stone-600'}`}>
                    {shelfKey}
                  </div>
                  <span className={`text-lg font-bold ${dm ? 'text-zinc-600' : 'text-stone-400'}`}>-</span>
                  <input
                    value={addForm.dan}
                    onChange={e => setAddForm(p => ({...p, dan: e.target.value}))}
                    placeholder="段"
                    inputMode="numeric"
                    className={`w-16 py-3 px-2 text-base border-2 rounded-xl outline-none text-center
                      ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border-stone-300'}`}
                  />
                  <span className={`text-lg font-bold ${dm ? 'text-zinc-600' : 'text-stone-400'}`}>-</span>
                  <input
                    value={addForm.retsu}
                    onChange={e => setAddForm(p => ({...p, retsu: e.target.value}))}
                    placeholder="列"
                    inputMode="numeric"
                    className={`w-16 py-3 px-2 text-base border-2 rounded-xl outline-none text-center
                      ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border-stone-300'}`}
                  />
                </div>
              </div>
              <div>
                <label className={`block text-xs mb-1 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>商品CD / 識別CD</label>
                <input
                  value={addForm.productCd}
                  onChange={e => setAddForm(p => ({...p, productCd: e.target.value}))}
                  placeholder="例: 00127"
                  className={`block w-full p-3 text-base border-2 rounded-xl outline-none
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border-stone-300'}`}
                />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>商品名</label>
                <input
                  value={addForm.productName}
                  onChange={e => setAddForm(p => ({...p, productName: e.target.value}))}
                  placeholder="例: 金太洋 栗甘露煮"
                  className={`block w-full p-3 text-base border-2 rounded-xl outline-none
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border-stone-300'}`}
                />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>出荷期限日</label>
                <input
                  type="date"
                  value={addForm.expiryDate}
                  onChange={e => setAddForm(p => ({...p, expiryDate: e.target.value}))}
                  className={`block w-full p-3 text-base border-2 rounded-xl outline-none
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100' : 'border-stone-300'}`}
                />
              </div>
              <div>
                <label className={`block text-xs mb-1 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>数量</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={addForm.qty}
                  onChange={e => setAddForm(p => ({...p, qty: e.target.value}))}
                  placeholder="0"
                  className={`block w-full p-3 text-2xl font-bold border-2 rounded-xl outline-none text-center
                    ${dm ? 'bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-500' : 'border-stone-300'}`}
                />
              </div>
              {addError && <p className="text-xs text-red-400">{addError}</p>}
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
                    const allItems = await getMasterItems(session!.id);
                    setItems(allItems.filter(i => i.locationKey === shelfKey));
                    setScreen('item-list');
                  } catch (e) {
                    setAddError('追加に失敗しました: ' + String(e));
                  } finally {
                    setAdding(false);
                  }
                }}
                className={`block w-full py-4 font-bold text-base rounded-xl disabled:opacity-50 active:scale-[0.98] transition-transform
                  ${dm ? 'bg-amber-500 text-white' : 'bg-stone-900 text-white'}`}
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
            <h1 className={`text-xl font-bold mb-2 ${dm ? 'text-zinc-100' : ''}`}>棚の計数完了！</h1>
            <p className={`text-sm mb-8 ${dm ? 'text-zinc-400' : 'text-stone-500'}`}>{shelfKey} の計数が完了しました。</p>
            <div className={`text-left border rounded-xl p-4 mb-6 ${dm ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-stone-200'}`}>
              <p className={`text-xs mb-3 ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>次の担当候補</p>
              {shelfList
                .filter(s => !s.isCompleted && s.locationKey !== shelfKey)
                .slice(0, 2)
                .map(s => (
                  <div
                    key={s.locationKey}
                    onClick={() => selectShelf(s)}
                    className={`flex items-center justify-between py-3 border-b last:border-0 cursor-pointer
                      ${dm ? 'border-zinc-700' : 'border-stone-100'}`}
                  >
                    <span className={`font-medium text-sm ${dm ? 'text-zinc-100' : ''}`}>{s.locationKey} 棚</span>
                    <span className={`text-xs ${dm ? 'text-zinc-400' : 'text-stone-400'}`}>{s.totalItems}件</span>
                  </div>
                ))}
            </div>
            <button
              onClick={() => setScreen('select-shelf')}
              className={`w-full py-3 border font-medium rounded-xl text-sm
                ${dm ? 'border-zinc-700 text-zinc-300' : 'border-stone-300 text-stone-700'}`}
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

function DrillHeader({ title, sub, dark }: { title: string; sub: string; dark?: boolean }) {
  return (
    <div className="mb-4">
      <h1 className={`text-xl font-bold ${dark ? 'text-zinc-100' : 'text-stone-900'}`}>{title}</h1>
      <p className={`text-sm mt-0.5 ${dark ? 'text-zinc-400' : 'text-stone-400'}`}>{sub}</p>
    </div>
  );
}

function BackButton({ label, onClick, dark }: { label: string; onClick: () => void; dark?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1 text-sm mb-4 transition-colors
      ${dark ? 'text-zinc-400 hover:text-zinc-300' : 'text-stone-400 hover:text-stone-600'}`}>
      ← {label}
    </button>
  );
}

function DrillItem({ label, badge, badgeColor, progress, isCompleted, isPending, dark, onClick }: {
  label: string; badge: string; badgeColor?: string; progress?: number; isCompleted?: boolean; isPending?: boolean; dark?: boolean; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl px-4 py-3.5 flex items-center justify-between cursor-pointer transition-all
        ${isCompleted
          ? 'bg-emerald-500 border border-emerald-500 active:bg-emerald-600'
          : isPending
          ? 'bg-amber-400 border border-amber-400 active:bg-amber-500'
          : dark
          ? 'bg-zinc-800 border border-zinc-700 active:bg-zinc-700'
          : 'bg-white border border-stone-200 active:bg-stone-50'}`}
    >
      <div className="flex items-center gap-2.5 flex-1">
        {isCompleted && <span className="text-white text-base font-bold">✓</span>}
        {isPending && <span className="text-white text-base font-bold">!</span>}
        <div>
          <span className={`font-medium text-sm ${isCompleted || isPending ? 'text-white' : dark ? 'text-zinc-100' : 'text-stone-900'}`}>{label}</span>
          {!isCompleted && progress !== undefined && progress > 0 && (
            <div className={`h-1 rounded-full mt-1.5 w-24 ${dark ? 'bg-zinc-700' : 'bg-stone-100'}`}>
              <div className={`h-full rounded-full ${dark ? 'bg-zinc-400' : 'bg-stone-500'}`} style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded
        ${isCompleted || isPending ? 'bg-white/20 text-white' : dark ? `bg-zinc-700 text-zinc-300 ${badgeColor ?? ''}` : `bg-stone-100 text-stone-500 ${badgeColor ?? ''}`}`}>
        {badge}
      </span>
    </div>
  );
}
