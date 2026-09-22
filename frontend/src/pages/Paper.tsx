/**
 * Paper.tsx — 模拟卷：组卷设置 → 逐题作答 → 交卷成绩 → 回看（含用户答案与判分）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Spin, Message, Modal, Radio } from '@arco-design/web-react';
import { IconLeft, IconRobot, IconCheckCircle, IconExclamationCircle } from '@arco-design/web-react/icon';
import { api, type Bank, type Paper } from '../api';

const TYPE_LABEL: Record<string, string> = { single: '单选', multiple: '多选', judge: '判断', unknown: '待识别' };

export default function PaperView() {
  const nav = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const newBank = params.get('bank'); // /paper/new?bank=xxx → 组卷模式

  const [paper, setPaper] = useState<Paper | null>(null);
  const [bankName, setBankName] = useState('');
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);                        // 当前题下标
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [judgeAns, setJudgeAns] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitModal, setSubmitModal] = useState(false);
  const [aiTexts, setAiTexts] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [noLlm, setNoLlm] = useState(false);
  // 组卷模式
  const [bank, setBank] = useState<Bank | null>(null);
  const [paperCount, setPaperCount] = useState(20);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!id || id === 'new') return;
    setLoading(true);
    try {
      const r = await api.paper(id);
      setPaper(r.paper);
      if (r.paper.bank_id) {
        api.bankDetail(r.paper.bank_id).then((b) => setBankName(b.name)).catch(() => {});
      }
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // 组卷模式：加载题库信息
  useEffect(() => {
    if (newBank && (!id || id === 'new')) {
      api.bankDetail(newBank).then((b) => {
        setBank(b);
        setPaperCount(Math.min(20, b.question_count || 20));
      }).catch(() => {});
      setLoading(false);
    }
  }, [newBank, id]);

  const createPaper = async () => {
    if (!newBank) return;
    setCreating(true);
    try {
      const r = await api.createPaper(newBank, paperCount);
      nav(`/paper/${r.paper.id}`, { replace: true });
    } catch (e) {
      Message.error((e as Error).message);
      setCreating(false);
    }
  };

  const questions = paper?.questions || [];
  const q = questions[idx] || null;
  const submitted = paper?.status === 'submitted';

  // 回看模式初始化用户答案
  useEffect(() => {
    if (submitted && paper && Object.keys(answers).length === 0) {
      const a: Record<string, string[]> = {};
      const j: Record<string, string> = {};
      for (const qq of questions) {
        const ua = paper.user_answers[qq.id]?.user_answer || '';
        if (qq.type === 'judge') j[qq.id] = ua;
        else a[qq.id] = ua ? ua.split('') : [];
      }
      setAnswers(a);
      setJudgeAns(j);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  const myAnswer = (qid: string) => {
    const qq = questions.find((x) => x.id === qid);
    if (!qq) return '';
    return qq.type === 'judge' ? judgeAns[qid] || '' : (answers[qid] || []).join('');
  };

  const answeredCount = useMemo(
    () => questions.filter((qq) => myAnswer(qq.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, answers, judgeAns]
  );

  const toggle = (qid: string, k: string) => {
    if (submitted) return;
    setAnswers((prev) => {
      const cur = prev[qid] || [];
      if (q?.type === 'multiple') return { ...prev, [qid]: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] };
      return { ...prev, [qid]: [k] };
    });
  };

  const submitPaper = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, string> = {};
      for (const qq of questions) body[qq.id] = myAnswer(qq.id);
      const r = await api.submitPaper(paper!.id, body);
      // 用交卷结果构造回看数据（含每题用户答案与判分）
      const ua: Record<string, { user_answer: string; correct: boolean }> = {};
      for (const x of r.results) ua[x.question_id] = { user_answer: x.user_answer, correct: !!x.correct };
      setPaper((prev) => prev ? { ...prev, status: 'submitted', score: r.score, total: r.total, user_answers: ua } : prev);
      Message.success(`交卷成功，得分 ${r.score} / ${r.total}`);
      setSubmitModal(false);
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const aiExplain = async (qid: string) => {
    if (aiTexts[qid]) return;
    setAiLoading(qid);
    try {
      const r = await api.aiExplain(qid);
      setAiTexts((prev) => ({ ...prev, [qid]: r.text }));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('尚未配置')) setNoLlm(true);
      else Message.error(msg);
    } finally {
      setAiLoading(null);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Spin size={30} /></div>;

  // ==================== 组卷设置页（/paper/new?bank=）====================
  if (newBank && !paper) {
    const max = bank?.question_count || 0;
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <button onClick={() => nav(`/banks/${newBank}`)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink" aria-label="返回">
            <IconLeft />
          </button>
          <div>
            <h1 className="m-0 text-lg font-semibold text-ink md:text-xl">模拟卷</h1>
            <div className="text-xs text-ink3">{bank?.name || ''} · 共 {max} 题</div>
          </div>
        </div>

        <div className="card-note flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-ink">抽题数量</div>
            <Radio.Group
              type="button"
              value={paperCount}
              onChange={(v) => setPaperCount(Number(v))}
              options={[
                { label: '10 题', value: 10 },
                { label: '20 题', value: 20 },
                { label: '30 题', value: 30 },
                { label: '50 题', value: 50 },
                { label: `全部（${max}）`, value: max },
              ].filter((o) => o.value <= max || o.value === max)}
            />
            <p className="m-0 text-xs text-ink3">从题库随机抽取，题型与知识点按题库实际分布。交卷后自动判分并归集错题。</p>
          </div>
          <button
            onClick={createPaper}
            disabled={creating || max === 0}
            className="rounded-xl bg-primary py-3 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {creating ? '组卷中…' : `开始答题（${paperCount} 题）`}
          </button>
        </div>
      </div>
    );
  }

  if (!paper) return <div className="card-note py-20 text-center text-ink3">试卷不存在</div>;

  // ==================== 成绩/回看页 ====================
  if (submitted) {
    const score = paper.score ?? 0;
    const total = paper.total ?? questions.length;
    const pass = score / Math.max(1, total) >= 0.6;
    return (
      <div className="flex flex-col gap-5">
        <div className="card-note flex flex-col items-center gap-2 py-10 text-center">
          <div className={`text-4xl font-bold ${pass ? 'text-success' : 'text-warning'}`}>{score}<span className="text-lg text-ink3"> / {total}</span></div>
          <div className="text-sm text-ink2">{bankName || '模拟卷'} · {paper.title}</div>
          <div className={`rounded-md px-2 py-0.5 text-xs font-medium ${pass ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300' : 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300'}`}>
            {pass ? '合格' : '未合格'}（60% 及格）
          </div>
          <button onClick={() => nav(`/banks/${paper.bank_id}`)} className="mt-2 rounded-xl bg-primary px-6 py-2 text-sm text-white hover:opacity-90">返回题库</button>
        </div>

        <div className="flex flex-col gap-4">
          {questions.map((qq, i) => {
            const ua = paper.user_answers[qq.id];
            const isRight = ua?.correct;
            const opts = qq.options || [];
            return (
              <div key={qq.id} className="card-note flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink3">#{i + 1}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      qq.type === 'judge' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                      : qq.type === 'multiple' ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-primary-light text-primary'
                    }`}>{TYPE_LABEL[qq.type] || qq.type}</span>
                    {isRight ? <IconCheckCircle className="text-success" /> : <IconExclamationCircle className="text-danger" />}
                  </div>
                  <span className="text-xs text-ink3">你的答案：{ua?.user_answer || '未作答'}</span>
                </div>
                <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-ink">{qq.stem}</p>
                {opts.length > 0 && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {opts.map((o) => {
                      const k = o.k.toUpperCase();
                      const isAns = qq.type === 'multiple' ? qq.answer.includes(k) : qq.answer.toUpperCase() === k;
                      const isPicked = (ua?.user_answer || '').includes(k);
                      return (
                        <div key={o.k} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                          isAns ? 'border-success bg-green-50 text-success dark:bg-green-900/30'
                          : isPicked ? 'border-danger bg-red-50 text-danger dark:bg-red-900/30'
                          : 'border-line text-ink2'
                        }`}>
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${
                            isAns ? 'bg-success text-white' : isPicked ? 'bg-danger text-white' : 'bg-canvas text-ink3'
                          }`}>{o.k}</span>
                          <span className="truncate">{o.text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
                  <span className="text-ink3">答案：</span>
                  <span className="font-semibold text-success">{qq.type === 'judge' ? (qq.answer === 'true' ? '对' : '错') : qq.answer}</span>
                  {qq.explanation && <span className="min-w-0 flex-1 text-ink2 whitespace-pre-wrap"><span className="text-ink3">解析：</span>{qq.explanation}</span>}
                </div>
                {aiTexts[qq.id] ? (
                  <div className="rounded-lg border border-primary/20 bg-primary-light/40 px-3 py-2.5 text-sm leading-6 dark:border-primary/30 dark:bg-primary-dark/15">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><IconRobot style={{ fontSize: 13 }} /> AI 讲解</div>
                    <div className="whitespace-pre-wrap text-ink">{aiTexts[qq.id]}</div>
                  </div>
                ) : (
                  <button onClick={() => aiExplain(qq.id)} disabled={aiLoading === qq.id}
                    className="flex w-fit items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light/50 disabled:opacity-50">
                    <IconRobot style={{ fontSize: 13 }} /> {aiLoading === qq.id ? '生成中…' : 'AI 讲解'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ==================== 作答页 ====================
  const progress = questions.length ? Math.round(((idx) / questions.length) * 100) : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={() => nav(`/banks/${paper.bank_id}`)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink" aria-label="返回">
            <IconLeft />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{paper.title}</div>
            <div className="text-[11px] text-ink3">{bankName || '模拟卷'} · 已答 {answeredCount} / {questions.length}</div>
          </div>
        </div>
        <button onClick={() => setSubmitModal(true)} disabled={answeredCount === 0}
          className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40">
          交卷
        </button>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      {q && (
        <div className="card-note flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink3">{idx + 1} / {questions.length}</span>
            <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
              q.type === 'judge' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300'
              : q.type === 'multiple' ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
              : 'bg-primary-light text-primary'
            }`}>{TYPE_LABEL[q.type] || q.type}</span>
            {q.type === 'multiple' && <span className="text-[11px] text-ink3">多选</span>}
          </div>
          <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-ink">{q.stem}</p>

          {q.type === 'judge' ? (
            <div className="grid grid-cols-2 gap-3">
              {['true', 'false'].map((v) => (
                <button key={v} onClick={() => setJudgeAns((prev) => ({ ...prev, [q.id]: v }))}
                  className={`rounded-xl border px-4 py-3 text-sm font-medium transition-colors ${
                    judgeAns[q.id] === v ? 'border-primary bg-primary-light text-primary' : 'border-line text-ink2 hover:border-primary/50'
                  }`}>
                  {v === 'true' ? '对' : '错'}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {q.options?.map((o) => {
                const k = o.k.toUpperCase();
                const on = (answers[q.id] || []).includes(k);
                return (
                  <button key={o.k} onClick={() => toggle(q.id, k)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                      on ? 'border-primary bg-primary-light text-primary' : 'border-line text-ink2 hover:border-primary/50'
                    }`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${on ? 'bg-primary text-white' : 'bg-canvas text-ink3'}`}>{o.k}</span>
                    <span className="min-w-0 flex-1">{o.text}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
              className="rounded-xl border border-line px-5 py-2.5 text-sm text-ink2 hover:text-primary disabled:opacity-40">
              上一题
            </button>
            {idx < questions.length - 1 ? (
              <button onClick={() => setIdx((i) => i + 1)} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
                下一题
              </button>
            ) : (
              <button onClick={() => setSubmitModal(true)} disabled={answeredCount === 0}
                className="rounded-xl bg-success px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
                交卷
              </button>
            )}
          </div>
        </div>
      )}

      <Modal title="确认交卷？" visible={submitModal} onCancel={() => setSubmitModal(false)} onOk={submitPaper}
        okText={submitting ? '交卷中…' : '交卷'} cancelText="继续作答" confirmLoading={submitting}>
        <div className="text-sm text-ink2">
          已作答 <b className="text-ink">{answeredCount}</b> / {questions.length} 题，未作答按 0 分计。交卷后可回看全部题目与答案解析。
        </div>
      </Modal>

      <Modal title="AI 讲解需要先配置模型" visible={noLlm} onCancel={() => setNoLlm(false)} footer={null}>
        <div className="flex flex-col gap-3 text-sm text-ink2">
          <p className="m-0">AI 讲解为可选功能，手动触发、按需生成、结果本地缓存。</p>
          <div className="flex justify-end">
            <button onClick={() => { setNoLlm(false); nav('/settings'); }} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white hover:opacity-90">去设置</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
