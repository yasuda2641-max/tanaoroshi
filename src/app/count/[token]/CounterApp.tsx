'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSessionByToken, getShelvesForSession, getMasterItems, submitCount } from '@/lib/db';
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
  | 'shelf-complete';

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
  const [counted, setCounted]     = useState<Set<string>>(new Set()); // location::cd

  // drill-down state
  const [building, setBuilding] = useState('');
  const [aisle, setAisle]       = useState('');
  const [shelf, setShelf]       = useState('');
  const [shelfKey, setShelfKey] = useState('');

  // count input state
  const [currentItem, setCurrentItem] = useState<MasterItem | null>(null);
  const [countState, setCountState]   = useState<CountState>({ scanned: false, qty: '', expiryOpen: false, expiry: '' });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  // ロード
  useEffect(() => {
    getSessionByToken(token).then(sess => {
      if (!sess) { setScreen('error'); return; }
      setSession(sess);
      // staffNameをlocalStorageから復元
      const saved = localStorage.getItem(`staff_${sess.id}`);
      if (saved) { setStaffName(saved); setScreen('select-building'); }
      else setScreen('staff-input');
    }).catch(() => setScreen('error'));
  }, [token]);

  // 棚一覧を取得
  const loadShelves = useCallback(async () => {
    if (!session) return;
    try {
      const s = await getShelvesForSession(session.id);
      setShelves(s);
    } catch (e) {
      setError('棚データの読み込みに失敗しました: ' + String(e));
    }
  }, [session]);

  useEffect(() => { loadShelves(); }, [loadShelves]);

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
    // 計数済みアイテムを取得してSetに
    const { getCountRecords } = await import('@/lib/db');
    const recs = await getCountRecords(session!.id);
    const set = new Set(recs.filter(r => r.location.startsWith(s.locationKey)).map(r => `${r.location}::${r.productCd}`));
    setCounted(set);
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
      if (prev.qty.length >= 4) return prev;
      return { ...prev, qty: prev.qty + k };
    });
  }

  async function submitItem() {
    if (!countState.scanned) { setError('バーコードをスキャンしてください'); return; }
    if (!countState.qty) { setError('数量を入力してください'); return; }
    if (!currentItem || !session) return;
    setSubmitting(true);
    setError('');
    try {
      await submitCount({
        sessionId:   session.id,
        masterItemId: currentItem.id,
        location:    currentItem.location,
        productCd:   currentItem.productCd,
        productName: currentItem.productName,
        systemQty:   currentItem.systemQty,
        actualQty:   parseInt(countState.qty, 10),
        staffName:   staffName,
        expiryDate:  countState.expiry || undefined,
        comment:     countState.comment || undefined,
      });
      const key = `${currentItem.location}::${currentItem.productCd}`;
      setCounted(prev => new Set([...prev, key]));
      await loadShelves();
      setScreen('item-list');
    } catch (e) {
      setError('送信に失敗しました: ' + String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const shelfItems = items.sort((a, b) => a.location.localeCompare(b.location));
  const doneCount  = shelfItems.filter(i => counted.has(`${i.location}::${i.productCd}`)).length;
  const allDone    = shelfItems.length > 0 && doneCount === shelfItems.length;

  // ── レンダリング ──────────────────────────────
  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      {/* ステータスバー風ヘッダー */}
      <div className="bg-[#1A3A2A] px-4 h-12 flex items-center justify-between sticky top-0 z-10">
        <span className="text-white/80 text-sm font-medium truncate">{session?.name ?? '棚卸し'}</span>
        <span className="text-white/60 text-xs">{staffName}</span>
      </div>

      <div className="px-4 py-5 max-w-md mx-auto">

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
                return (
                  <DrillItem key={b} label={`${b}棟`} badge={`${s.length}棚`} progress={done/s.length}
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
                return (
                  <DrillItem key={a} label={`${a}通路`} badge={`${s.length}棚`} progress={done/s.length}
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
                  badge={s.isCompleted ? '完了' : `${s.totalItems}件`}
                  badgeColor={s.isCompleted ? 'text-emerald-700 bg-emerald-50' : ''}
                  progress={s.completedItems / s.totalItems}
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
                <p className="text-sm text-stone-400">{doneCount}/{shelfItems.length}件完了</p>
              </div>
              {allDone && (
                <button
                  onClick={() => setScreen('shelf-complete')}
                  className="px-4 py-2 bg-[#1A3A2A] text-white text-sm font-semibold rounded-lg"
                >
                  完了にする
                </button>
              )}
            </div>
            <div className="space-y-2">
              {shelfItems.map(item => {
                const done = counted.has(`${item.location}::${item.productCd}`);
                return (
                  <div
                    key={`${item.location}::${item.productCd}`}
                    onClick={() => openItem(item)}
                    className="bg-white border border-stone-200 rounded-xl p-4 flex items-center gap-3 cursor-pointer active:bg-stone-50"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${done ? 'bg-emerald-500' : 'bg-stone-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-xs text-stone-400">{item.location} ／ {item.productCd}</p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded
                      ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                      {done ? '済' : '未'}
                    </span>
                  </div>
                );
              })}
            </div>
            {!allDone && (
              <button
                onClick={() => setScreen('shelf-complete')}
                className="w-full mt-4 py-3 border border-stone-300 text-stone-600 text-sm font-medium rounded-xl"
              >
                この棚を完了にする
              </button>
            )}
          </>
        )}

        {/* ── 計数入力 ── */}
        {screen === 'count-input' && currentItem && (
          <>
            <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} />

            {/* アイテム情報 */}
            <div className="mb-4">
              <p className="text-xs text-stone-400">{currentItem.location}</p>
              <h1 className="text-base font-bold leading-tight">{currentItem.productName}</h1>
              <p className="text-xs text-stone-400 mt-0.5">商品CD: {currentItem.productCd}</p>
            </div>

            {/* スキャン */}
            <div
              onClick={() => setCountState(prev => ({ ...prev, scanned: true }))}
              className={`rounded-xl p-4 text-center mb-4 border-2 cursor-pointer transition-all
                ${countState.scanned
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-dashed border-stone-300 bg-stone-50 hover:border-[#4A7A5A]'}`}
            >
              <div className="text-3xl mb-1">{countState.scanned ? '✅' : '📷'}</div>
              <p className={`text-sm font-medium ${countState.scanned ? 'text-emerald-700' : 'text-stone-500'}`}>
                {countState.scanned ? 'スキャン確認済み' : 'バーコードをスキャン（タップで確認）'}
              </p>
            </div>

            {/* 数量表示 */}
            <div className="bg-stone-100 rounded-xl text-center py-4 mb-3">
              <p className="text-xs text-stone-400 mb-1">実数量</p>
              <p className="text-4xl font-bold tracking-widest text-stone-900">
                {countState.qty || <span className="text-stone-300">-</span>}
              </p>
            </div>

            {/* テンキー */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {['7','8','9','4','5','6','1','2','3','⌫','0','送信'].map(k => (
                <button
                  key={k}
                  onClick={() => {
                    if (k === '⌫') keyPress('del');
                    else if (k === '送信') submitItem();
                    else keyPress(k);
                  }}
                  className={`py-4 text-xl font-medium rounded-xl border transition-all active:scale-95
                    ${k === '送信'
                      ? 'bg-[#1A3A2A] text-white border-transparent text-base'
                      : k === '⌫'
                      ? 'bg-white border-stone-200 text-stone-500 text-base'
                      : 'bg-white border-stone-200 text-stone-900'}`}
                >
                  {k}
                </button>
              ))}
            </div>

            {/* 賞味期限（折りたたみ） */}
            <div className="border border-stone-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setCountState(prev => ({ ...prev, expiryOpen: !prev.expiryOpen }))}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-stone-500"
              >
                <span>賞味期限を入力（任意）</span>
                <span>{countState.expiryOpen ? '▲' : '▼'}</span>
              </button>
              {countState.expiryOpen && (
                <div className="px-4 pb-4 border-t border-stone-100">
                  <input
                    type="date"
                    value={countState.expiry}
                    onChange={e => setCountState(prev => ({ ...prev, expiry: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-stone-300 rounded-lg mt-3 outline-none focus:border-[#4A7A5A]"
                  />
                </div>
              )}
            </div>

            {/* コメント */}
            <textarea
              value={countState.comment}
              onChange={e => setCountState(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="コメント（任意）：気になることがあれば記入"
              rows={2}
              className="w-full px-4 py-3 text-sm border border-stone-200 rounded-xl outline-none focus:border-[#4A7A5A] resize-none bg-white"
            />

            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
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
              onClick={() => setScreen('select-building')}
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

function DrillItem({ label, badge, badgeColor, progress, onClick }: {
  label: string; badge: string; badgeColor?: string; progress?: number; onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="bg-white border border-stone-200 rounded-xl px-4 py-3.5 flex items-center justify-between cursor-pointer active:bg-stone-50 transition-all"
    >
      <div className="flex-1">
        <span className="font-medium text-stone-900 text-sm">{label}</span>
        {progress !== undefined && progress > 0 && (
          <div className="h-1 bg-stone-100 rounded-full mt-1.5 w-24">
            <div className="h-full bg-[#4A7A5A] rounded-full" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>
      <span className={`text-xs font-medium px-2 py-0.5 rounded bg-stone-100 text-stone-500 ${badgeColor ?? ''}`}>
        {badge}
      </span>
    </div>
  );
}
