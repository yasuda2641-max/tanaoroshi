'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/admin',         label: '棚卸し一覧',    icon: '📋' },
  { href: '/admin/create',  label: '棚卸し作成',    icon: '➕' },
  { href: '/admin/report',  label: '棚卸しレポート',  icon: '📊' },
  { href: '/admin/master',  label: 'マスタ管理',    icon: '⚙️' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      {/* サイドバー */}
      <aside className="w-56 bg-[#1A3A2A] min-h-screen flex flex-col flex-shrink-0">
        <div className="px-5 py-6 border-b border-white/10">
          <div className="text-white/60 text-xs font-semibold tracking-widest mb-1">丸菱リンクト</div>
          <div className="text-white text-lg font-bold">棚卸しアプリ</div>
        </div>
        <nav className="flex-1 py-3">
          {navItems.map(item => {
            const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-5 py-2.5 text-sm transition-all border-l-[3px]
                  ${active
                    ? 'bg-white/10 text-white border-[#7FD4A0]'
                    : 'text-white/60 border-transparent hover:bg-white/5 hover:text-white/90'
                  }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <span className="text-white/30 text-xs">v1.0.0</span>
        </div>
      </aside>

      {/* メインコンテンツ */}
      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  );
}
