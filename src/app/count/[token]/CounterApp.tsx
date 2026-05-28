'use client';
import { useEffect, useState, useCallback } from 'react';
import { getSessionByToken, getShelvesForSession, getMasterItems, submitCount, addMasterItem, completeShelf } from '@/lib/db';
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
  | 'shelf-complete'
  | 'add-product';

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
  const [countState, setCountState]   = useState<CountState>({ scanned: false, qty: '', expiryOpen: false, expiry: '', comment: '' });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

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
        const savedShelf = localStorage.getItem(`shelf_${sess.id}`);
        if (savedShelf) {
          const { building: b, aisle: a, shelfKey: sk } = JSON.parse(savedShelf);
          localStorage.removeItem(`shelf_${sess.id}`);
          setBuilding(b); setAisle(a); setShelf(sk.split('-')[2] ?? ''); setShelfKey(sk);
          const { getMasterItems: gmi, getCountRecords: gcr } = await import('@/lib/db');
          const [all, recs] = await Promise.all([gmi(sess.id), gcr(sess.id)]);
          setItems(all.filter(i => i.locationKey === sk));
          setCounted(new Set(recs.filter(r => r.location.startsWith(sk)).map(r => r.masterItemId)));
          setScreen('item-list');
        } else {
          setScreen('select-building');
        }
      }
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
    // 計数済みアイテムを取得してSetに
    const { getCountRecords } = await import('@/lib/db');
    const recs = await getCountRecords(session!.id);
    const set = new Set(recs.filter(r => r.location.startsWith(s.locationKey)).map(r => r.masterItemId));
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
        expiryDate:        countState.expiry || undefined,
        masterExpiryDate:  currentItem.expiryDate || undefined,
        masterLotNumber:   currentItem.lotNumber || undefined,
        comment:           countState.comment || undefined,
      });
      localStorage.setItem(`shelf_${session.id}`, JSON.stringify({ building, aisle, shelfKey }));
      window.location.reload();
    } catch (e) {
      setError('送信に失敗しました: ' + String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const shelfItems = items.sort((a, b) => a.location.localeCompare(b.location));
  const doneCount  = shelfItems.filter(i => counted.has(i.id)).length;
  const allDone    = shelfItems.length > 0 && doneCount === shelfItems.length;

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
        <div style={{height: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', padding: '8px 16px 12px', maxWidth: '448px', margin: '0 auto', boxSizing: 'border-box'}}>
          <BackButton label="一覧に戻る" onClick={() => setScreen('item-list')} />

          {/* アイテム情報（コンパクト） */}
          <div style={{marginBottom: '8px', flexShrink: 0}}>
            <p style={{fontSize: '11px', color: '#a8a29e', marginBottom: '2px'}}>{currentItem.location} / {currentItem.productCd}</p>
            <p style={{fontSize: '15px', fontWeight: 'bold', lineHeight: '1.3', color: '#1c1917'}}>{currentItem.productName}</p>
            {currentItem.expiryDate && (
              <p style={{fontSize: '12px', color: '#d97706', marginTop: '2px'}}>出荷期限日: {currentItem.expiryDate}</p>
            )}
            <a
              href={`https://orderie.jp/component/g/g${currentItem.productCd}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{fontSize: '11px', color: '#4A7A5A', textDecoration: 'underline'}}
            >
              orderie で確認
            </a>
          </div>

          {/* 数量表示 */}
          <div style={{background: '#f5f5f4', borderRadius: '12px', textAlign: 'center', padding: '10px', marginBottom: '8px', flexShrink: 0}}>
            <p style={{fontSize: '11px', color: '#a8a29e', marginBottom: '2px'}}>実数量</p>
            <p style={{fontSize: '48px', fontWeight: 'bold', letterSpacing: '4px', lineHeight: '1', color: '#1c1917'}}>
              {countState.qty || <span style={{color: '#d6d3d1'}}>-</span>}
            </p>
          </div>

          {/* テンキー（flex-1で残りスペースを埋める） */}
          <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', flex: 1, minHeight: 0}}>
            {['7','8','9','4','5','6','1','2','3','⌫','0','送信'].map(k => (
              <button
                key={k}
                onClick={() => {
                  if (k === '⌫') keyPress('del');
                  else if (k === '送信') submitItem();
                  else keyPress(k);
                }}
                style={{
                  fontSize: k === '送信' || k === '⌫' ? '16px' : '22px',
                  fontWeight: '500',
                  borderRadius: '12px',
                  border: k === '送信' ? 'none' : '1px solid #e7e5e4',
                  background: k === '送信' ? '#1A3A2A' : k === '⌫' ? '#f5f5f4' : '#ffffff',
                  color: k === '送信' ? '#ffffff' : k === '⌫' ? '#78716c' : '#1c1917',
                  cursor: 'pointer',
                  width: '100%',
                  height: '100%',
                  transition: 'transform 0.08s',
                  WebkitTapHighlightColor: 'transparent',
                }}
                onPointerDown={e => (e.currentTarget.style.transform = 'scale(0.95)')}
                onPointerUp={e => (e.currentTarget.style.transform = 'scale(1)')}
                onPointerLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              >
                {k}
              </button>
            ))}
          </div>

          {/* 賞味期限・コメント（折りたたみ） */}
          <div style={{flexShrink: 0, marginTop: '8px'}}>
            <button
              onClick={() => setCountState(prev => ({ ...prev, expiryOpen: !prev.expiryOpen }))}
              style={{width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '13px', color: '#78716c', background: '#f5f5f4', borderRadius: '10px', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between'}}
            >
              <span>賞味期限 / コメント（任意）</span>
              <span>{countState.expiryOpen ? '▲' : '▼'}</span>
            </button>
            {countState.expiryOpen && (
              <div style={{marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <input
                  type="date"
                  value={countState.expiry}
                  onChange={e => setCountState(prev => ({ ...prev, expiry: e.target.value }))}
                  style={{width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #d6d3d1', borderRadius: '10px', outline: 'none', boxSizing: 'border-box'}}
                />
                <textarea
                  value={countState.comment}
                  onChange={e => setCountState(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="コメント（任意）"
                  rows={2}
                  style={{width: '100%', padding: '8px 12px', fontSize: '14px', border: '1px solid #d6d3d1', borderRadius: '10px', outline: 'none', resize: 'none', boxSizing: 'border-box'}}
                />
              </div>
            )}
          </div>

          {error && <p style={{fontSize: '12px', color: '#ef4444', marginTop: '4px'}}>{error}</p>}
        </div>
      )}

      <div className={`px-4 py-5 max-w-md mx-auto ${screen === 'count-input' ? 'hidden' : ''}`}>

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
                <p className="text-sm text-stone-400">{doneCount}/{shelfItems.length}件完了</p>
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
                const done = counted.has(item.id);
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
                      {item.expiryDate && <p className="text-xs text-amber-600">期限: {item.expiryDate}</p>}
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
                <label style={{display:'block',fontSize:'12px',color:'#78716c',marginBottom:'8px'}}>ロケーション ※</label>
                <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                  <div style={{padding:'12px 14px',fontSize:'16px',fontWeight:'600',background:'#f5f5f4',border:'2px solid #e7e5e4',borderRadius:'12px',color:'#57534e',whiteSpace:'nowrap'}}>
                    {shelfKey}
                  </div>
                  <span style={{fontSize:'18px',color:'#a8a29e',fontWeight:'bold'}}>-</span>
                  <input
                    value={addForm.dan}
                    onChange={e => setAddForm(p => ({...p, dan: e.target.value}))}
                    placeholder="段"
                    inputMode="numeric"
                    style={{width:'64px',padding:'12px 8px',fontSize:'16px',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box',textAlign:'center'}}
                  />
                  <span style={{fontSize:'18px',color:'#a8a29e',fontWeight:'bold'}}>-</span>
                  <input
                    value={addForm.retsu}
                    onChange={e => setAddForm(p => ({...p, retsu: e.target.value}))}
                    placeholder="列"
                    inputMode="numeric"
                    style={{width:'64px',padding:'12px 8px',fontSize:'16px',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box',textAlign:'center'}}
                  />
                </div>
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',color:'#78716c',marginBottom:'4px'}}>商品CD / 識別CD</label>
                <input
                  value={addForm.productCd}
                  onChange={e => setAddForm(p => ({...p, productCd: e.target.value}))}
                  placeholder="例: 00127"
                  style={{display:'block',width:'100%',padding:'12px',fontSize:'16px',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box'}}
                />
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',color:'#78716c',marginBottom:'4px'}}>商品名</label>
                <input
                  value={addForm.productName}
                  onChange={e => setAddForm(p => ({...p, productName: e.target.value}))}
                  placeholder="例: 金太洋 栗甘露煮"
                  style={{display:'block',width:'100%',padding:'12px',fontSize:'16px',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box'}}
                />
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',color:'#78716c',marginBottom:'4px'}}>出荷期限日</label>
                <input
                  type="date"
                  value={addForm.expiryDate}
                  onChange={e => setAddForm(p => ({...p, expiryDate: e.target.value}))}
                  style={{display:'block',width:'100%',padding:'12px',fontSize:'16px',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box'}}
                />
              </div>
              <div>
                <label style={{display:'block',fontSize:'12px',color:'#78716c',marginBottom:'4px'}}>数量</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={addForm.qty}
                  onChange={e => setAddForm(p => ({...p, qty: e.target.value}))}
                  placeholder="0"
                  style={{display:'block',width:'100%',padding:'12px',fontSize:'24px',fontWeight:'bold',border:'2px solid #d6d3d1',borderRadius:'12px',outline:'none',boxSizing:'border-box',textAlign:'center'}}
                />
              </div>
              {addError && <p style={{fontSize:'12px',color:'#ef4444'}}>{addError}</p>}
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
                    setCounted(prev => new Set([...prev, itemId]));
                    await loadShelfItems(shelfKey);
                    setScreen('item-list');
                  } catch (e) {
                    setAddError('追加に失敗しました: ' + String(e));
                  } finally {
                    setAdding(false);
                  }
                }}
                style={{display:'block',width:'100%',padding:'16px',background:'#1A3A2A',color:'white',fontWeight:'bold',fontSize:'16px',borderRadius:'12px',border:'none',cursor:'pointer'}}
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
