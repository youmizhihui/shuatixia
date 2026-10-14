/**
 * BankDetail.tsx — 题库详情：题目列表（分页+搜索）、类型标签、答案与解析、AI 讲解（按需+缓存）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spin, Empty, Button, Tooltip, Message, Modal, Input } from '@arco-design/web-react';
import { IconLeft, IconApps, IconRobot, IconSearch } from '@arco-design/web-react/icon';
import { api, type Bank, type Question } from '../api';

const TYPE_META: Record<string, { label: string; cls: string }> = {
  single: { label: '单选', cls: 'bg-primary-light text-primary' },
  multiple: { label: '多选', cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300' },
  judge: { label: '判断', cls: 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300' },
  unknown: { label: '待识别', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300' },
};

function JudgeText({ v }: { v: string }) {
  return v === 'true' ? '对' : v === 'false' ? '错' : v;
}

interface AiBox {
  qid: string;
  loading: boolean;
  cached: boolean;
  text: string;
}

export default function BankDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [bank, setBank] = useState<Bank | null>(null);
  const [qs, setQs] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [kw, setKw] = useState('');
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiBox, setAiBox] = useState<AiBox | null>(null);
  const [noLlm, setNoLlm] = useState(false);

  const load = useCallback(async (p: number, append: boolean, searchKw?: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const k = (searchKw ?? kw).trim();
      const [b, q] = await Promise.all([api.bankDetail(id), api.questions(id, p, 20, k || undefined)]);
      setBank(b);
      setTotal(q.total);
      setQs(append ? (prev) => [...prev, ...q.questions] : q.questions);
      setMore(q.total > p * 20);
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, kw]);

  useEffect(() => { load(1, false); }, [load]);

  // 卸载时清理搜索防抖定时器
  useEffect(() => () => { if (debRef.current) clearTimeout(debRef.current); }, []);

  const onKwChange = (v: string) => {
    setKw(v);
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => load(1, false, v.trim()), 400);
  };

  const explain = async (q: Question) => {
    setAiBox({ qid: q.id, loading: true, cached: false, text: '' });
    try {
      const r = await api.aiExplain(q.id);
      setAiBox({ qid: q.id, loading: false, cached: r.cached, text: r.text });
    } catch (e) {
      const msg = (e as Error).message;
      setAiBox(null);
      if (msg.includes('尚未配置')) {
        setNoLlm(true);
      } else {
        Message.error(msg);
      }
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav('/')}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink transition-colors"
            aria-label="返回"
          >
            <IconLeft />
          </button>
          <div>
            <h1 className="m-0 text-lg font-semibold text-ink md:text-xl">{bank?.name ?? '…'}</h1>
            <div className="text-xs text-ink3">
              {bank?.category ? `${bank.category} · ` : ''}
              {total} 道题
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="primary" icon={<IconApps />} onClick={() => nav(`/import?bank=${id}`)}>
            导入题目
          </Button>
        </div>
      </div>

      {/* 练习入口 */}
      <div className="grid grid-cols-3 gap-3">
        <button onClick={() => nav(`/practice?bank=${id}`)}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-lg font-semibold text-primary">顺序练习</span>
          <span className="text-[11px] text-ink3">逐题作答 · 断点续练</span>
        </button>
        <button onClick={() => nav(`/paper/new?bank=${id}`)}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-lg font-semibold text-primary">模拟卷</span>
          <span className="text-[11px] text-ink3">随机抽题 · 交卷出分</span>
        </button>
        <button onClick={() => nav(`/wrong?bank=${id}`)}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-lg font-semibold text-danger">错题集</span>
          <span className="text-[11px] text-ink3">自动归集 · 反复练习</span>
        </button>
      </div>

      {/* 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          allowClear
          prefix={<IconSearch />}
          placeholder="搜索题干、选项或章节…"
          value={kw}
          onChange={onKwChange}
          style={{ maxWidth: 340 }}
        />
        {kw.trim() && (
          <span className="text-xs text-ink3">“{kw.trim()}” 命中 {total} 题</span>
        )}
      </div>

      {/* 题目列表 */}
      {loading && qs.length === 0 ? (
        <div className="flex justify-center py-20"><Spin size={30} /></div>
      ) : qs.length === 0 ? (
        <div className="card-note py-16">
          <Empty description={kw.trim() ? `未找到与“${kw.trim()}”相关的题目` : '题库还没有题目，点击右上角导入'} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {qs.map((q) => {
            const meta = TYPE_META[q.type] || TYPE_META.unknown;
            return (
              <div key={q.id} className="card-note flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink3">#{q.seq}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>{meta.label}</span>
                    {q.chapter && <span className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink3">{q.chapter}</span>}
                  </div>
                  <Tooltip content="AI 讲解：按需生成，结果缓存到本地，同一题不重复计费">
                    <Button size="mini" icon={<IconRobot />} loading={aiBox?.qid === q.id && aiBox.loading}
                      onClick={() => explain(q)}>
                      讲解
                    </Button>
                  </Tooltip>
                </div>

                <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-ink">{q.stem}</p>

                {q.options && q.options.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {q.options.map((o) => {
                      const key = o.k.toUpperCase();
                      const isAns = q.type === 'multiple' ? q.answer.includes(key) : q.answer.toUpperCase() === key;
                      return (
                        <div
                          key={o.k}
                          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                            isAns ? 'border-primary bg-primary-light text-primary' : 'border-line text-ink2'
                          }`}
                        >
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${isAns ? 'bg-primary text-white' : 'bg-canvas text-ink3'}`}>
                            {o.k}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-pre-wrap">{o.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
                  <span className="text-ink3">答案：</span>
                  <span className="font-semibold text-success">
                    {q.type === 'judge' ? <JudgeText v={q.answer} /> : q.answer}
                  </span>
                  {q.explanation && (
                    <span className="min-w-0 flex-1 text-ink2">
                      <span className="text-ink3">解析：</span>
                      <span className="whitespace-pre-wrap">{q.explanation}</span>
                    </span>
                  )}
                </div>

                {/* AI 讲解（按需 + 缓存） */}
                {aiBox && aiBox.qid === q.id && !aiBox.loading && (
                  <div className="rounded-lg border border-primary/20 bg-primary-light/40 px-3 py-2.5 text-sm dark:border-primary/30 dark:bg-primary-dark/15">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                      <IconRobot style={{ fontSize: 13 }} />
                      AI 讲解
                      {aiBox.cached && <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink3">本地缓存</span>}
                    </div>
                    <div className="whitespace-pre-wrap leading-6 text-ink">{aiBox.text}</div>
                  </div>
                )}
              </div>
            );
          })}

          {more && (
            <button
              onClick={() => load(page + 1, true).then(() => setPage(page + 1))}
              className="rounded-xl border border-line bg-card py-2.5 text-sm text-ink2 hover:text-primary transition-colors"
            >
              {loading ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
      )}

      {/* 未配置 AI 提示 */}
      <Modal
        title="AI 讲解需要先配置模型"
        visible={noLlm}
        onCancel={() => setNoLlm(false)}
        footer={null}
      >
        <div className="flex flex-col gap-3 text-sm text-ink2">
          <p className="m-0">AI 讲解为可选功能，手动触发、按需生成、结果本地缓存。配置一次即可用于全部题目。</p>
          <div className="flex justify-end">
            <button
              onClick={() => { setNoLlm(false); nav('/settings'); }}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              去设置
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
