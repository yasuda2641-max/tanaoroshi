export type InventoryType = 'full' | 'focused';
export type InventoryStatus = 'active' | 'completed';

export interface InventorySession {
  id: string;
  name: string;
  type: InventoryType;
  status: InventoryStatus;
  token: string; // URLアクセス用トークン
  createdAt: Date;
  startDate: string;
  endDate: string;
  // 重点棚卸しの絞り込み条件
  focusDays?: number;
  focusLocation?: string;
  totalItems: number;
  completedItems: number;
}

export interface MasterItem {
  id: string;             // Firestore doc id
  sessionId: string;
  location: string;       // 2X-13-05-2-3
  locationKey: string;    // 棟-通路-棚 の3階層キー: 2X-13-05
  building: string;       // 2X
  aisle: string;          // 13
  shelf: string;          // 05
  productCd: string;
  productName: string;
  systemQty: number;      // 保管中
  pickingQty: number;     // ピッキング中（参照のみ）
  expiryDate?: string;    // 出荷期限日
  lotNumber?: string;     // ロット番号
}

export interface CountRecord {
  id: string;
  sessionId: string;
  masterItemId: string;
  location: string;
  productCd: string;
  productName: string;
  systemQty: number;
  actualQty: number;
  diff: number;           // actualQty - systemQty
  diffRate: number;       // diff / systemQty
  hasDiff: boolean;
  staffName: string;
  countedAt: Date;
  expiryDate?: string;        // 賞味期限（手入力）
  masterExpiryDate?: string;  // 出荷期限日（マスタCSVから）
  masterLotNumber?: string;   // ロット番号（マスタCSVから）
  comment?: string;           // 差異原因コメント
  causeCategory?: string;
  isRecounted?: boolean;      // リカウント済み
  recountOk?: boolean;        // 管理者リカウントOK確認済み
}

export interface ShelfProgress {
  locationKey: string; // 2X-13-05
  building: string;
  aisle: string;
  shelf: string;
  totalItems: number;
  completedItems: number;
  isCompleted: boolean;
}
