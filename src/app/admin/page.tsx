'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listSessions } from '@/lib/db';
import type { InventorySession } from '@/types';
import { Badge, Button, Card, Loading, EmptyState, ProgressBar } from '@/components/ui';

function statusBadge(status: InventorySession['status']) {
  return status === 'active'
    ? <Badge variant="amber">進行中</Badge>
    : <Badge variant="green">完了</Badge>;
}

function typeBadge(type: InventorySession['type']) {
  return type === 'full'
    ? <Badge variant="blue">一斉</Badge>
    : <Badge variant="gray">重点</Badge>;
}

export default function AdminPage() {
  const [sessions, setSessions] = useState<InventorySession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSessions().then(setSessions).finally(() => setLoading(false));
  }, []);

  const active = sessions.filter(s => s.status === 'active').length;

  return (
    <>
      {/* トップバー */}
      <div className="bg-white border-b border-stone-200 px-8 h-14 flex items-center justify-between">
        <div className="font-semibold text-stone-900">棚卸し一覧</div>
        <Link href="/admin/create">
          <Button variant="primary">＋ 新規作成</Button>
        </Link>
      </div>

      <div className="p-8">
        <div className="text-sm text-stone-400 mb-5">
          全 <strong className="text-stone-700">{sessions.length}</strong> 件 ／ 進行中 <strong className="text-stone-700">{active}</strong> 件
        </div>

        {loading ? (
          <Loading />
        ) : sessions.length === 0 ? (
          <Card className="p-0 overflow-hidden">
            <EmptyState icon="📦" text="棚卸しがまだありません。「新規作成」から始めましょう。" />
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide">棚卸し名</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide">種別</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide">開始日</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide">状態</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide w-40">進捗</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-stone-400 uppercase tracking-wide">URL</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => {
                  const pct = s.totalItems > 0 ? Math.round((s.completedItems / s.totalItems) * 100) : 0;
                  return (
                    <tr key={s.id} className="border-b border-stone-100 hover:bg-stone-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-stone-900">{s.name}</div>
                        <div className="text-xs text-stone-400 mt-0.5">ID: {s.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-3">{typeBadge(s.type)}</td>
                      <td className="px-4 py-3 text-stone-600">{s.startDate}</td>
                      <td className="px-4 py-3">{statusBadge(s.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={pct} />
                          <span className="text-xs text-stone-400 w-8">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-stone-500 bg-stone-100 px-2 py-0.5 rounded">
                          /count/{s.token}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/report?session=${s.id}`}>
                          <Button size="sm">レポート</Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
