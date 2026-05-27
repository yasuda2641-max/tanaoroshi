import { Suspense } from 'react';
import CounterApp from './CounterApp';

export default async function CountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center">
        <div className="text-stone-400 text-sm">読み込み中...</div>
      </div>
    }>
      <CounterApp token={token} />
    </Suspense>
  );
}
