/**
 * Layout.tsx — 响应式布局：≥768px 桌面侧边栏；<768px 顶部条 + 底部 TabBar
 */
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  IconBook,
  IconApps,
  IconSettings,
  IconSun,
  IconMoon,
  IconDesktop,
} from '@arco-design/web-react/icon';
import { useTheme, type ThemeMode } from '../theme';

const NAV = [
  { to: '/', label: '我的题库', icon: IconBook, end: true },
  { to: '/import', label: '导入题库', icon: IconApps, end: false },
  { to: '/settings', label: '设置', icon: IconSettings, end: false },
];

function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();
  const items: { m: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { m: 'system', icon: <IconDesktop />, label: '跟随系统' },
    { m: 'light', icon: <IconSun />, label: '浅色' },
    { m: 'dark', icon: <IconMoon />, label: '深色' },
  ];
  if (compact) {
    // 移动端：循环切换 system → light → dark
    const next: ThemeMode = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
    const cur = items.find((i) => i.m === mode)!;
    return (
      <button
        className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink2 hover:text-ink transition-colors"
        title={`当前：${cur.label}，点击切换`}
        onClick={() => setMode(next)}
      >
        {cur.icon}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-canvas p-1">
      {items.map((i) => (
        <button
          key={i.m}
          onClick={() => setMode(i.m)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            mode === i.m ? 'bg-primary text-white' : 'text-ink2 hover:text-ink'
          }`}
        >
          {i.icon}
          <span className="hidden lg:inline">{i.label}</span>
        </button>
      ))}
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-white font-bold text-base shadow-sm">
        100
      </div>
      <div>
        <div className="text-[15px] font-semibold leading-tight text-ink">爱刷题</div>
        <div className="text-[11px] text-ink3 leading-tight">练一题 · 进一步</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const loc = useLocation();

  const sidebar = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive ? 'bg-primary text-white font-medium' : 'text-ink2 hover:bg-card hover:text-ink'
            }`
          }
        >
          <n.icon />
          {n.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-canvas">
      {/* ===== 桌面侧边栏 ===== */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-canvas/80 px-4 py-5 backdrop-blur md:flex">
        <div className="mb-8 px-1">
          <Logo />
        </div>
        {sidebar}
        <div className="mt-auto px-1">
          <ThemeSwitch />
        </div>
      </aside>

      {/* ===== 移动顶部条 ===== */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
        <ThemeSwitch compact />
      </header>

      {/* ===== 内容区 ===== */}
      <main className="px-4 pb-24 pt-5 md:ml-60 md:px-10 md:pb-10 md:pt-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* ===== 移动底部 TabBar ===== */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-card/95 backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
                isActive ? 'text-primary font-medium' : 'text-ink3'
              }`
            }
          >
            <n.icon style={{ fontSize: 20 }} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
