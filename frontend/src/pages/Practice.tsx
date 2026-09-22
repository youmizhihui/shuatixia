/**
 * Practice.tsx — 顺序练习：进度条 + 逐题作答 → 判分反馈（答案/解析/AI 讲解）→ 下一题
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Message, Modal } from '@arco-design/web-react';
import { IconLeft, IconRobot, IconCheckCircle, IconExclamationCircle, IconStar } from '@arco-design/web-react/icon';
import { api, type AnswerResult, type PracticeState } from '../api';

const TYPE_LABEL: Record<string, string> = { single: '单选', multiple: '多选', judge: '判断', unknown: '待识别' };

export default function Practice() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const bankId = params.get('bank') || '';

  const [state, setState] = useState<PracticeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<string[]>([]);       // 已选选项
  const [judgeSel, setJudgeSel] = useState<string>(''); // 判断题 对/错
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [noLlm, setNoLlm] = useState(false);
  const [bankName, setBankName] = useState('');
  const [fav, setFav] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b] = await Promise.all([api.practice(bankId), api.bankDetail(bankId)]);
      setState(p);
      setBankName(b.name);
      setSel([]);
      setJudgeSel('');
      setResult(null);
      setAiText(null);
      setFav(false);
      // 检查当前题是否已收藏
      if (p.question) {
        api.favorites(bankId).then((f) => {
          setFav(f.favorites.some((x) => x.id === p.question!.id));
        }).catch(() => {});
      }
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bankId]);
  useEffect(() => { load(); }, [load]);

  const toggleFav = async () => {
    if (!q) return;
    setFavLoading(true);
    try {
      const r = await api.favorite(q.id, !fav);
      setFav(r.favorited);
      Message.success(r.favorited ? '已收藏' : '已取消收藏');
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setFavLoading(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await api.resetPractice(bankId);
      Message.success('已重新开始一轮，从第 1 题继续');
      await load();
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  const q = state?.question || null;
  const answered = result !== null;

  const toggleOpt = (k: string) =>
    setSel((prev) => {
      if (q?.type === 'multiple') return prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
      return [k];
    });

  const submit = async () => {
    if (!q) return;
    let answer = '';
    if (q.type === 'judge') answer = judgeSel;
    else answer = sel.join('');
    if (!answer) { Message.warning('请先作答'); return; }
    try {
      const r = await api.practiceAnswer(bankId, q.id, answer);
      setResult(r);
      setAiText(r.explanation_ai);
      if (r.finished) Message.success('本题库已练完一轮，开始下一轮时从第 1 题继续');
    } catch (e) {
      Message.error((e as Error).message);
    }
  };

  const next = async () => {
    if (result?.finished) { await load(); return; }
    await load();
  };

  const aiExplain = async () => {
    if (!q) return;
    setAiLoading(true);
    try {
      const r = await api.aiExplain(q.id);
      setAiText(r.text);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('尚未配置')) setNoLlm(true);
      else Message.error(msg);
    } finally {
      setAiLoading(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-24"><Spin size={30} /></div>;
  }

  if (!q) {
    return (
      <div className="card-note flex flex-col items-center gap-4 py-20 text-center">
        <IconCheckCircle style={{ fontSize: 40 }} className="text-success" />
        <div className="text-base font-medium text-ink">本轮练习已完成</div>
        <div className="text-sm text-ink3">题库共 {state?.total ?? 0} 题 · 进度已保存</div>
        <div className="flex gap-3">
          <button onClick={restart} disabled={restarting}
            className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {restarting ? '重置中…' : '重新开始一轮'}
          </button>
          <button onClick={() => nav(`/banks/${bankId}`)} className="rounded-xl border border-line px-6 py-2 text-sm text-ink2 hover:text-ink">
            返回题库
          </button>
        </div>
      </div>
    );
  }

  const progress = state ? Math.min(100, Math.round(((q.seq - 1) / Math.max(1, state.total)) * 100)) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* 顶栏：返回 + 题库名 + 进度 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => nav(`/banks/${bankId}`)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink" aria-label="返回">
            <IconLeft />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{bankName}</div>
            <div className="text-[11px] text-ink3">顺序练习 · 第 {q.seq} / {state?.total} 题</div>
          </div>
        </div>
        <span className="shrink-0 rounded-md bg-primary-light px-2 py-0.5 text-[11px] font-medium text-primary dark:bg-primary-dark/30">{progress}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {/* 题目卡片 */}
      <div className="card-note flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${q.type === 'judge' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300' : q.type === 'multiple' ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-primary-light text-primary'}`}>
            {TYPE_LABEL[q.type] || q.type}
          </span>
          {q.chapter && <span className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink3">{q.chapter}</span>}
          {q.type === 'multiple' && <span className="text-[11px] text-ink3">多选，可勾选多项</span>}
          <button
            onClick={toggleFav}
            disabled={favLoading}
            className={`ml-auto flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              fav ? 'border-warning bg-orange-50 text-orange-500 dark:bg-orange-900/30' : 'border-line text-ink3 hover:text-warning'
            }`}
            aria-label="收藏本题"
          >
            <IconStar style={{ fontSize: 13, color: fav ? '#ff7d00' : undefined }} />
            {fav ? '已收藏' : '收藏'}
          </button>
        </div>

        <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-ink">{q.stem}</p>

        {q.type === 'judge' ? (
          <div className="grid grid-cols-2 gap-3">
            {['true', 'false'].map((v) => (
              <button
                key={v}
                onClick={() => setJudgeSel(v)}
                disabled={answered}
                className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-default ${
                  judgeSel === v ? 'border-primary bg-primary-light text-primary' : 'border-line text-ink2 hover:border-primary/50'
                }`}
              >
                {v === 'true' ? '对' : '错'}
              </button>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {q.options?.map((o) => {
              const key = o.k.toUpperCase();
              const on = sel.includes(key);
              const correctOpt = answered && (q.type === 'multiple' ? result!.answer.includes(key) : result!.answer.toUpperCase() === key);
              const wrongOpt = answered && on && !correctOpt;
              return (
                <button
                  key={o.k}
                  onClick={() => toggleOpt(key)}
                  disabled={answered}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${
                    correctOpt ? 'border-success bg-green-50 text-success dark:bg-green-900/30'
                    : wrongOpt ? 'border-danger bg-red-50 text-danger dark:bg-red-900/30'
                    : on ? 'border-primary bg-primary-light text-primary'
                    : 'border-line text-ink2 hover:border-primary/50'
                  }`}
                >
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${
                    correctOpt ? 'bg-success text-white' : wrongOpt ? 'bg-danger text-white' : on ? 'bg-primary text-white' : 'bg-canvas text-ink3'
                  }`}>{o.k}</span>
                  <span className="min-w-0 flex-1">{o.text}</span>
                  {correctOpt && <IconCheckCircle className="shrink-0" />}
                  {wrongOpt && <IconExclamationCircle className="shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* 提交 / 下一题 */}
        {!answered ? (
          <button onClick={submit} className="rounded-xl bg-primary py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
            提交答案
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
              result.correct ? 'bg-green-50 text-success dark:bg-green-900/30' : 'bg-red-50 text-danger dark:bg-red-900/30'
            }`}>
              {result.correct ? <IconCheckCircle /> : <IconExclamationCircle />}
              {result.correct ? '回答正确' : '回答错误'}
              <span className="font-normal text-ink2">
                · 正确答案：<b>{q.type === 'judge' ? (result.answer === 'true' ? '对' : '错') : result.answer}</b>
              </span>
            </div>
            {result.explanation && (
              <div className="rounded-xl bg-canvas px-4 py-3 text-sm leading-6 text-ink2">
                <span className="font-medium text-ink3">解析：</span>{result.explanation}
              </div>
            )}
            {/* AI 讲解 */}
            {aiText ? (
              <div className="rounded-xl border border-primary/20 bg-primary-light/40 px-4 py-3 text-sm leading-6 dark:border-primary/30 dark:bg-primary-dark/15">
                <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><IconRobot style={{ fontSize: 13 }} /> AI 讲解</div>
                <div className="whitespace-pre-wrap text-ink">{aiText}</div>
              </div>
            ) : (
              <button
                onClick={aiExplain}
                disabled={aiLoading}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-primary/40 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary-light/50 disabled:opacity-50"
              >
                <IconRobot /> {aiLoading ? '讲解生成中…' : 'AI 讲解'}
              </button>
            )}
            <button onClick={next} className="rounded-xl bg-primary py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90">
              {result.finished ? '完成本轮' : '下一题'}
            </button>
          </div>
        )}
      </div>

      {/* 未配置 AI 提示 */}
      <Modal title="AI 讲解需要先配置模型" visible={noLlm} onCancel={() => setNoLlm(false)} footer={null}>
        <div className="flex flex-col gap-3 text-sm text-ink2">
          <p className="m-0">AI 讲解为可选功能，手动触发、按需生成、结果本地缓存。配置一次即可用于全部题目。</p>
          <div className="flex justify-end">
            <button onClick={() => { setNoLlm(false); nav('/settings'); }} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">
              去设置
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
