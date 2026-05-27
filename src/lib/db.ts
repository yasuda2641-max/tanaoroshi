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
  rows: Array<{ location: string; productCd: string; productName: string; systemQty: number; pickingQty: number }>
): Promise<void> {
  const batch = writeBatch(db);
  for (const row of rows) {
    const { building, aisle, shelf, locationKey } = parseLocation(row.location);
    const ref = doc(collection(db, COL_MASTERS));
    batch.set(ref, {
      sessionId, building, aisle, shelf, locationKey,
      location:    row.location,
      productCd:   row.productCd,
      productName: row.productName,
      systemQty:   row.systemQty,
      pickingQty:  row.pickingQty,
    });
  }
  await batch.commit();
  await updateDoc(doc(db, COL_SESSIONS, sessionId), { totalItems: rows.length });
}

export async function getMasterItems(sessionId: string): Promise<MasterItem[]> {
  const q = query(collection(db, COL_MASTERS), where('sessionId', '==', sessionId), orderBy('location'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as MasterItem));
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
}): Promise<void> {
  const diff = data.actualQty - data.systemQty;
  const diffRate = data.systemQty > 0 ? diff / data.systemQty : 0;

  // 既存レコードがあれば上書き（再計数）
  const existing = await getDocs(query(
    collection(db, COL_COUNTS),
    where('sessionId', '==', data.sessionId),
    where('location', '==', data.location),
    where('productCd', '==', data.productCd),
  ));

  const payload = {
    ...data,
    diff,
    diffRate,
    hasDiff: diff !== 0,
    countedAt: serverTimestamp(),
    isRecounted: !existing.empty,
  };

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
  const q = query(collection(db, COL_COUNTS), where('sessionId', '==', sessionId), orderBy('location'));
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      ...data,
      countedAt: (data.countedAt as Timestamp)?.toDate() ?? new Date(),
    } as CountRecord;
  });
}

export async function updateComment(recordId: string, causeCategory: string, comment: string): Promise<void> {
  await updateDoc(doc(db, COL_COUNTS, recordId), { causeCategory, comment });
}

// ── CSV パーサー ─────────────────────────────────

export function parseMasterCsv(text: string): Array<{
  location: string; productCd: string; productName: string;
  systemQty: number; pickingQty: number;
}> {
  const lines = text.trim().split('\n');
  // ヘッダー行をスキップ
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      location:    cols[0] ?? '',
      productCd:   cols[1] ?? '',
      productName: cols[2] ?? '',
      systemQty:   parseInt(cols[3] ?? '0', 10),
      pickingQty:  parseInt(cols[4] ?? '0', 10),
    };
  }).filter(r => r.location && r.productCd);
}
