import { Suspense } from 'react';
import CounterApp from './CounterApp';

export default function CountPage({ params }: { params: { token: string } }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F7F6F2] flex items-center justify-center">
        <div className="text-stone-400 text-sm">読み込み中...</div>
      </div>
    }>
      <CounterApp token={params.token} />
    </Suspense>
  );
}
