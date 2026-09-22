/**
 * Wrong.tsx — 错题集：按题库筛选，显示错次/答案/解析，支持移除与 AI 讲解
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Message, Select, Modal } from '@arco-design/web-react';
import { IconLeft, IconRobot, IconDelete } from '@arco-design/web-react/icon';
import { api, type Bank, type WrongItem } from '../api';

const TYPE_LABEL: Record<string, string> = { single: '单选', multiple: '多选', judge: '判断', unknown: '待识别' };

export default function Wrong() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preBank = params.get('bank');

  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState<string>(preBank || '');
  const [items, setItems] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiTexts, setAiTexts] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [noLlm, setNoLlm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, b] = await Promise.all([api.wrong(bankId || undefined), api.banks()]);
      setItems(r.wrong);
      setBanks(b.banks);
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bankId]);
  useEffect(() => { load(); }, [load]);

  const remove = async (qid: string) => {
    try {
      await api.removeWrong(qid);
      setItems((prev) => prev.filter((x) => x.id !== qid));
      Message.success('已从错题集移除');
    } catch (e) {
      Message.error((e as Error).message);
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => nav(preBank ? `/banks/${preBank}` : '/')} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink2 hover:text-ink" aria-label="返回">
            <IconLeft />
          </button>
          <div>
            <h1 className="m-0 text-lg font-semibold text-ink md:text-xl">错题集</h1>
            <div className="text-xs text-ink3">{items.length} 道错题</div>
          </div>
        </div>
        <Select
          className="w-52"
          allowClear
          placeholder="全部题库"
          value={bankId || undefined}
          onChange={(v) => setBankId(String(v || ''))}
          options={banks.map((b) => ({ label: `${b.name}（${b.question_count} 题）`, value: b.id }))}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spin size={30} /></div>
      ) : items.length === 0 ? (
        <div className="card-note py-16 text-center text-sm text-ink3">暂无错题——答错的题会自动归集到这里</div>
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((w) => (
            <div key={w.id} className="card-note flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink3">#{w.seq}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    w.type === 'judge' ? 'bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-300'
                    : w.type === 'multiple' ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-primary-light text-primary'
                  }`}>{TYPE_LABEL[w.type] || w.type}</span>
                  <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] text-danger dark:bg-red-900/30">错 {w.wrong_count} 次</span>
                  {w.chapter && <span className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink3">{w.chapter}</span>}
                </div>
                <button onClick={() => remove(w.id)} className="flex items-center gap-1 text-xs text-ink3 hover:text-danger transition-colors">
                  <IconDelete style={{ fontSize: 13 }} /> 移除
                </button>
              </div>
              <p className="m-0 whitespace-pre-wrap text-[15px] leading-7 text-ink">{w.stem}</p>
              {w.options && w.options.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {w.options.map((o) => {
                    const k = o.k.toUpperCase();
                    const isAns = w.type === 'multiple' ? w.answer.includes(k) : w.answer.toUpperCase() === k;
                    return (
                      <div key={o.k} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${isAns ? 'border-success bg-green-50 text-success dark:bg-green-900/30' : 'border-line text-ink2'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${isAns ? 'bg-success text-white' : 'bg-canvas text-ink3'}`}>{o.k}</span>
                        <span className="truncate">{o.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-canvas px-3 py-2 text-sm">
                <span className="text-ink3">答案：</span>
                <span className="font-semibold text-success">{w.type === 'judge' ? (w.answer === 'true' ? '对' : '错') : w.answer}</span>
                {w.explanation && <span className="min-w-0 flex-1 text-ink2 whitespace-pre-wrap"><span className="text-ink3">解析：</span>{w.explanation}</span>}
              </div>
              {aiTexts[w.id] ? (
                <div className="rounded-lg border border-primary/20 bg-primary-light/40 px-3 py-2.5 text-sm leading-6 dark:border-primary/30 dark:bg-primary-dark/15">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary"><IconRobot style={{ fontSize: 13 }} /> AI 讲解</div>
                  <div className="whitespace-pre-wrap text-ink">{aiTexts[w.id]}</div>
                </div>
              ) : (
                <button onClick={() => aiExplain(w.id)} disabled={aiLoading === w.id}
                  className="flex w-fit items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light/50 disabled:opacity-50">
                  <IconRobot style={{ fontSize: 13 }} /> {aiLoading === w.id ? '生成中…' : 'AI 讲解'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

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
