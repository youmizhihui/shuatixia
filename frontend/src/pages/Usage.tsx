/**
 * UsagePage.tsx — AI 调用记录（分页查看全部）
 * 只记录次数与字符量，不记录题目内容；数据来自后端 ai_usage 表（SQLite）
 */
import { useEffect, useState } from 'react';
import { Pagination, Empty } from '@arco-design/web-react';
import { useNavigate } from 'react-router-dom';
import { api, type AiUsageItem } from '../api';

const KIND_LABEL: Record<string, string> = {
  explain: 'AI 讲解',
  parse: 'AI 解析',
  'format-suggest': 'AI 格式建议',
};
const PAGE_SIZE = 20;

export default function Usage() {
  const navigate = useNavigate();
  const [usage, setUsage] = useState<AiUsageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const load = (p: number) => {
    api.aiUsage({ page: p, page_size: PAGE_SIZE }).then((d) => {
      setUsage(d.usage);
      setTotal(d.total);
      setPage(d.page);
    }).catch(() => {});
  };
  useEffect(() => { load(1); }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-semibold text-ink md:text-2xl">AI 调用记录</h1>
          <p className="mt-1 text-sm text-ink3">共 {total} 次 · 只记录次数与字符量，不记录题目内容</p>
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="shrink-0 rounded-lg bg-canvas px-3 py-1.5 text-sm text-ink2 hover:bg-primary/10"
        >
          返回设置
        </button>
      </div>

      <section className="card-note flex flex-col gap-3 p-5">
        {usage.length === 0 ? (
          <Empty description="暂无调用——AI 全部手动触发，这里只记录次数与字符量，不记录题目内容" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {usage.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm text-ink2">
                <span className="rounded-md bg-primary-light px-1.5 py-0.5 text-xs text-primary dark:bg-primary-dark/30">
                  {KIND_LABEL[u.kind] || u.kind}
                </span>
                <span className="truncate">{u.model}</span>
                <span>{u.questions} 题</span>
                <span>{u.chars} 字符</span>
                <span className="ml-auto text-xs text-ink3">{u.created_at}</span>
              </li>
            ))}
          </ul>
        )}
        {total > PAGE_SIZE && (
          <div className="flex justify-center pt-1">
            <Pagination current={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => load(p)} />
          </div>
        )}
      </section>
    </div>
  );
}
