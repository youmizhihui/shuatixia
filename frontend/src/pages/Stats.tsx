/**
 * Stats.tsx — 学习统计：总量/正确率/错题掌握 + 题型与章节正确率条形 + 近 14 天趋势
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spin, Message } from '@arco-design/web-react';
import { IconLeft, IconThunderbolt, IconCheckCircle, IconExclamationCircle, IconStar, IconFile } from '@arco-design/web-react/icon';
import { api, type Stats } from '../api';

const TYPE_LABEL: Record<string, string> = { single: '单选', multiple: '多选', judge: '判断', unknown: '待识别' };

export default function StatsPage() {
  const nav = useNavigate();
  const [s, setS] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setS(await api.stats());
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-24"><Spin size={30} /></div>;
  if (!s) return <div className="card-note py-20 text-center text-ink3">暂无统计数据</div>;

  const accRate = s.answered ? Math.round((100 * s.correct) / s.answered) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink" aria-label="返回">
          <IconLeft />
        </button>
        <div>
          <h1 className="m-0 text-lg font-semibold text-ink md:text-xl">学习统计</h1>
          <div className="text-xs text-ink3">记录自动来自练习与模拟卷</div>
        </div>
      </div>

      {/* 概览卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconThunderbolt style={{ fontSize: 12 }} /> 累计答题</div>
          <div className="text-2xl font-bold text-ink">{s.answered}</div>
        </div>
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconCheckCircle style={{ fontSize: 12 }} /> 正确率</div>
          <div className={`text-2xl font-bold ${accRate >= 60 ? 'text-success' : 'text-warning'}`}>{accRate}%</div>
        </div>
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconExclamationCircle style={{ fontSize: 12 }} /> 错题数</div>
          <div className="text-2xl font-bold text-danger">{s.wrong_total}<span className="text-xs font-normal text-ink3"> 已掌握 {s.wrong_mastered}</span></div>
        </div>
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconStar style={{ fontSize: 12 }} /> 收藏</div>
          <div className="text-2xl font-bold text-warning">{s.favorites}</div>
        </div>
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconFile style={{ fontSize: 12 }} /> 试卷</div>
          <div className="text-2xl font-bold text-ink">{s.papers}</div>
        </div>
        <div className="card-note flex flex-col gap-1 p-4">
          <div className="flex items-center gap-1 text-[11px] text-ink3"><IconThunderbolt style={{ fontSize: 12 }} /> 活跃天数</div>
          <div className="text-2xl font-bold text-ink">{s.active_days}</div>
        </div>
      </div>

      {/* 近 14 天趋势 */}
      <div className="card-note flex flex-col gap-4 p-5">
        <div className="text-sm font-semibold text-ink">近 14 天答题趋势</div>
        {s.trend.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink3">还没有答题记录，去练几道题吧</div>
        ) : (
          <div className="flex h-32 items-end gap-2">
            {s.trend.map((t) => {
              const max = Math.max(...s.trend.map((x) => x.count), 1);
              const h = Math.max(6, Math.round((t.count / max) * 100));
              const okRate = t.count ? Math.round((100 * t.correct) / t.count) : 0;
              return (
                <div key={t.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-primary/80 dark:bg-primary/60" style={{ height: `${h * 0.9}px` }} title={`${t.date} 答 ${t.count} 对 ${t.correct}`} />
                  <div className="truncate text-[10px] text-ink3">{t.date.slice(5)}</div>
                  <div className="text-[10px] font-medium text-ink2">{okRate}%</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 题型正确率 */}
        <div className="card-note flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-ink">题型正确率</div>
          {s.by_type.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink3">暂无数据</div>
          ) : (
            s.by_type.map((t) => (
              <div key={t.type} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink2">{TYPE_LABEL[t.type] || t.type}</span>
                  <span className="text-ink3">{t.correct}/{t.count} · {t.rate}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                  <div className={`h-full rounded-full ${t.rate >= 60 ? 'bg-success' : t.rate >= 40 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${t.rate}%` }} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* 章节正确率 */}
        <div className="card-note flex flex-col gap-3 p-5">
          <div className="text-sm font-semibold text-ink">章节正确率（Top 8）</div>
          {s.by_chapter.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink3">暂无数据</div>
          ) : (
            s.by_chapter.map((c) => (
              <div key={c.chapter} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-ink2">{c.chapter}</span>
                  <span className="text-ink3">{c.correct}/{c.count} · {c.rate}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                  <div className={`h-full rounded-full ${c.rate >= 60 ? 'bg-success' : c.rate >= 40 ? 'bg-warning' : 'bg-danger'}`} style={{ width: `${c.rate}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
