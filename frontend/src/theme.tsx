/**
 * theme.tsx — 三态主题（跟随系统 / 浅色 / 深色）
 * 状态：localStorage 持久化；DOM：<html data-theme="...">
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'shuatixia.theme';

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readInitial(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* ignore */ }
  return 'system';
}

interface ThemeCtx {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ mode: 'system', resolved: 'light', setMode: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readInitial);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readInitial()));

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(resolve(mode));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
  };

  useEffect(() => {
    const r = resolve(mode);
    setResolved(r);
    document.documentElement.setAttribute('data-theme', r);
    // Arco 暗色：给根节点切 class（ConfigProvider 外层容器）
    document.documentElement.classList.toggle('arco-theme-dark', r === 'dark');
  }, [mode]);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
