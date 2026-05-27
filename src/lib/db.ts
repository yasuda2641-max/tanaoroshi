import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query,
  where, orderBy, serverTimestamp, Timestamp, writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import type { InventorySession, MasterItem, CountRecord, ShelfProgress } from '@/types';

// ── コレクション名 ──────────────────────────────
const COL_SESSIONS  = 'sessions';
const COL_MASTERS   = 'masterItems';
const COL_COUNTS    = 'countRecords';

// ── ユーティリティ ──────────────────────────────
function generateToken(len = 8): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function parseLocation(loc: string) {
  const parts = loc.split('-');
  return {
    building: parts[0] ?? '',
    aisle:    parts[1] ?? '',
    shelf:    parts[2] ?? '',
    locationKey: parts.slice(0, 3).join('-'),
  };
}

// ── Sessions ────────────────────────────────────

export async function createSession(
  data: Omit<InventorySession, 'id' | 'token' | 'createdAt' | 'totalItems' | 'completedItems'>
): Promise<string> {
  const token = generateToken();
  const payload = Object.fromEntries(
    Object.entries({ ...data, token, totalItems: 0, completedItems: 0, createdAt: serverTimestamp() })
      .filter(([, v]) => v !== undefined)
  );
  const ref = await addDoc(collection(db, COL_SESSIONS), payload);
  return ref.id;
}

export async function getSessionById(id: string): Promise<InventorySession | null> {
  const snap = await getDoc(doc(db, COL_SESSIONS, id));
  if (!snap.exists()) return null;
  return firestoreToSession(snap.id, snap.data());
}

export async function getSessionByToken(token: string): Promise<InventorySession | null> {
  const q = query(collection(db, COL_SESSIONS), where('token', '==', token));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return firestoreToSession(d.id, d.data());
}

export async function listSessions(): Promise<InventorySession[]> {
  const snap = await getDocs(query(collection(db, COL_SESSIONS), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => firestoreToSession(d.id, d.data()));
}

export async function completeSession(id: string) {
  await updateDoc(doc(db, COL_SESSIONS, id), { status: 'completed' });
}

function firestoreToSession(id: string, d: Record<string, unknown>): InventorySession {
  return {
    id,
    name:       d.name as string,
    type:       d.type as InventorySession['type'],
    status:     d.status as InventorySession['status'],
    token:      d.token as string,
    startDate:  d.startDate as string,
    endDate:    d.endDate as string,
    focusDays:  d.focusDays as number | undefined,
    focusLocation: d.focusLocation as string | undefined,
    totalItems: d.totalItems as number,
    completedItems: d.completedItems as number,
    createdAt:  (d.createdAt as Timestamp)?.toDate() ?? new Date(),
  };
}

// ── MasterItems ─────────────────────────────────

export async function importMasterItems(
  sessionId: string,
  rows: Array<{ location: string; productCd: string; productName: string; systemQty: number; pickingQty: number; expiryDate?: string; lotNumber?: string }>
): Promise<void> {
  const batch = writeBatch(db);
  for (const row of rows) {
    const { building, aisle, shelf, locationKey } = parseLocation(row.location);
    const ref = doc(collection(db, COL_MASTERS));
    const data: Record<string, unknown> = {
      sessionId, building, aisle, shelf, locationKey,
      location:    row.location,
      productCd:   row.productCd,
      productName: row.productName,
      systemQty:   row.systemQty,
      pickingQty:  row.pickingQty,
    };
    if (row.expiryDate) data.expiryDate = row.expiryDate;
    if (row.lotNumber)  data.lotNumber  = row.lotNumber;
    batch.set(ref, data);
  }
  await batch.commit();
  await updateDoc(doc(db, COL_SESSIONS, sessionId), { totalItems: rows.length });
}

export async function getMasterItems(sessionId: string): Promise<MasterItem[]> {
  const q = query(collection(db, COL_MASTERS), where('sessionId', '==', sessionId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as MasterItem))
    .sort((a, b) => a.location.localeCompare(b.location));
}

export async function getShelvesForSession(sessionId: string): Promise<ShelfProgress[]> {
  const items = await getMasterItems(sessionId);
  const counts = await getCountRecords(sessionId);
  const countedSet = new Set(counts.map(c => `${c.location}::${c.productCd}`));

  const map = new Map<string, ShelfProgress>();
  for (const item of items) {
    if (!map.has(item.locationKey)) {
      map.set(item.locationKey, {
        locationKey: item.locationKey,
        building: item.building,
        aisle: item.aisle,
        shelf: item.shelf,
        totalItems: 0,
        completedItems: 0,
        isCompleted: false,
      });
    }
    const prog = map.get(item.locationKey)!;
    prog.totalItems++;
    if (countedSet.has(`${item.location}::${item.productCd}`)) {
      prog.completedItems++;
    }
    prog.isCompleted = prog.completedItems === prog.totalItems;
  }
  return Array.from(map.values()).sort((a, b) => a.locationKey.localeCompare(b.locationKey));
}

// ── CountRecords ─────────────────────────────────

export async function submitCount(data: {
  sessionId: string;
  masterItemId: string;
  location: string;
  productCd: string;
  productName: string;
  systemQty: number;
  actualQty: number;
  staffName: string;
  expiryDate?: string;
  comment?: string;
}): Promise<void> {
  const diff = data.actualQty - data.systemQty;
  const diffRate = data.systemQty > 0 ? diff / data.systemQty : 0;

  // 既存レコードがあれば上書き（再計数）- masterItemId で一意判定
  const existing = await getDocs(query(
    collection(db, COL_COUNTS),
    where('sessionId', '==', data.sessionId),
    where('masterItemId', '==', data.masterItemId),
  ));

  const payload = Object.fromEntries(
    Object.entries({
      ...data,
      diff,
      diffRate,
      hasDiff: diff !== 0,
      countedAt: serverTimestamp(),
      isRecounted: !existing.empty,
    }).filter(([, v]) => v !== undefined)
  );

  if (!existing.empty) {
    await updateDoc(existing.docs[0].ref, payload);
  } else {
    await addDoc(collection(db, COL_COUNTS), payload);
    // completedItems インクリメント
    const sessRef = doc(db, COL_SESSIONS, data.sessionId);
    const sess = await getDoc(sessRef);
    if (sess.exists()) {
      await updateDoc(sessRef, { completedItems: (sess.data().completedItems ?? 0) + 1 });
    }
  }
}

export async function getCountRecords(sessionId: string): Promise<CountRecord[]> {
  const q = query(collection(db, COL_COUNTS), where('sessionId', '==', sessionId));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      countedAt: (data.countedAt as Timestamp)?.toDate() ?? new Date(),
    } as CountRecord;
  }).sort((a, b) => a.location.localeCompare(b.location));
}

export async function updateComment(recordId: string, causeCategory: string, comment: string): Promise<void> {
  await updateDoc(doc(db, COL_COUNTS, recordId), { causeCategory, comment });
}

export async function updateRecountOk(recordId: string, recountOk: boolean): Promise<void> {
  await updateDoc(doc(db, COL_COUNTS, recordId), { recountOk });
}

// ── CSV パーサー ─────────────────────────────────

export function parseMasterCsv(text: string): Array<{
  location: string; productCd: string; productName: string;
  systemQty: number; pickingQty: number; expiryDate: string; lotNumber: string;
}> {
  const lines = text.trim().split('\n');
  // ヘッダー行をスキップ
  // 列: A(0)商品コード B(1)識別コード C(2)型番 D(3)商品名 E(4)商品名かな F(5)商品区分
  //     G(6)入庫待ち H(7)保管中 I(8)保留 J(9)ピッキング中 K(10)倉庫
  //     L(11)ロケーション M(12)出荷期限日 N(13)ロット番号
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      productCd:   cols[0] ?? '',
      productName: cols[3] ?? '',
      systemQty:   parseInt(cols[7] ?? '0', 10),
      pickingQty:  parseInt(cols[9] ?? '0', 10),
      location:    cols[11] ?? '',
      expiryDate:  cols[12] ?? '',
      lotNumber:   cols[13] ?? '',
    };
  }).filter(r => r.location && r.productCd);
}
