/**
 * Import.tsx — 导入向导
 * 步骤：① 选择目标题库 → ② 选择文件 → ③ 识别预览（可编辑/待处理） → ④ 确认入库
 * AI 解析：待处理块手动触发（确认弹窗明示发送范围），结果回填预览可复核
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Message, Select, Input, Radio, Skeleton, Modal, Spin } from '@arco-design/web-react';
import { IconUpload, IconCheckCircle, IconExclamationCircle, IconRobot, IconLeft } from '@arco-design/web-react/icon';
import { api, type Bank, type ImportResult, type Question } from '../api';

const ACCEPT = '.xlsx,.xls,.csv,.docx,.pdf,.txt';
const TYPE_OPTIONS = [
  { label: '单选', value: 'single' },
  { label: '多选', value: 'multiple' },
  { label: '判断', value: 'judge' },
  { label: '待处理', value: 'unknown' },
];

type Step = 'pick' | 'uploading' | 'preview';

export default function Import() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preBank = params.get('bank');

  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState<string>(preBank || '');
  const [step, setStep] = useState<Step>('pick');
  const [fileName, setFileName] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [edits, setEdits] = useState<Question[]>([]);
  const [committing, setCommitting] = useState(false);
  const [aiModal, setAiModal] = useState(false);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiDone, setAiDone] = useState(0); // 已 AI 解析成功题数
  const [llmModel, setLlmModel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadBanks = useCallback(() => {
    api.banks().then((d) => {
      setBanks(d.banks);
      if (!preBank && d.banks.length === 1) setBankId(d.banks[0].id);
    }).catch(() => Message.error('加载题库失败'));
    api.settings().then((s) => { if (s.llm_model) setLlmModel(s.llm_model); }).catch(() => {});
  }, [preBank]);
  useEffect(loadBanks, [loadBanks]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!bankId) { Message.warning('请先选择目标题库'); return; }
    setFileName(f.name);
    setStep('uploading');
    try {
      const r = await api.importFile(bankId, f);
      if (!r.ok) {
        Message.error(r.error || '文件识别失败');
        setStep('pick');
        return;
      }
      setToken(r.token);
      const full = await api.importResult(r.token);
      setResult(full);
      setEdits(full.questions);
      setStep('preview');
      if (r.template_hit) {
        Message.success(`已识别该文件（上次导入 ${r.template_hit.imported} 题），确认后入库即可，无需重新解析`);
      } else if (full.empty && full.hint) {
        Message.info(full.hint);
      }
    } catch (e) {
      Message.error((e as Error).message);
      setStep('pick');
    }
  };

  const patch = (i: number, p: Partial<Question>) =>
    setEdits((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...p } : q)));

  const remove = (i: number) => setEdits((prev) => prev.filter((_, idx) => idx !== i));

  const commit = async () => {
    setCommitting(true);
    try {
      const r = await api.commitImport(token, edits);
      Message.success(`已入库 ${r.imported} 道题`);
      nav(`/banks/${bankId}`);
    } catch (e) {
      Message.error((e as Error).message);
      setCommitting(false);
    }
  };

  const okCount = useMemo(() => edits.filter((q) => q.type !== 'unknown' && q.answer).length, [edits]);
  const needAi = useMemo(
    () => (result ? result.failed.length + result.questions.filter((q) => q.type === 'unknown' || !q.answer).length : 0),
    [result]
  );

  /** AI 解析确认 → 调用 → 回填 */
  const runAiParse = async () => {
    if (!result) return;
    setAiParsing(true);
    try {
      const r = await api.aiParse(token);
      if (r.questions.length > 0) {
        setEdits((prev) => [...prev, ...r.questions]);
        Message.success(`AI 解析出 ${r.questions.length} 道题，已加入预览，可复核后再入库`);
      }
      setAiDone(r.questions.length);
      setAiModal(false);
    } catch (e) {
      const msg = (e as Error).message;
      setAiModal(false);
      if (msg.includes('尚未配置')) {
        Message.warning('尚未配置 AI 模型，可先手动补录或去设置页配置');
        nav('/settings');
      } else {
        Message.error(msg);
      }
    } finally {
      setAiParsing(false);
    }
  };

  if (step === 'uploading') {
    return (
      <div className="card-note flex flex-col items-center gap-5 py-24">
        <Skeleton animation style={{ width: 320 }} />
        <div className="text-sm text-ink2">正在识别「{fileName}」… 规则引擎解析中</div>
      </div>
    );
  }

  if (step === 'preview' && result) {
    return (
      <div className="flex flex-col gap-5">
        {/* 返回 */}
        <button onClick={() => setStep('pick')} className="flex items-center gap-1 text-sm text-ink3 hover:text-ink transition-colors w-fit">
          <IconLeft /> 重新选择文件
        </button>

        {/* 摘要 */}
        <div className="card-note grid grid-cols-2 gap-4 p-5 md:grid-cols-4">
          <div>
            <div className="text-xs text-ink3">识别题目</div>
            <div className="mt-1 text-xl font-semibold text-ink">{result.summary?.total ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-ink3">待处理</div>
            <div className="mt-1 flex items-center gap-1 text-xl font-semibold text-warning">
              {needAi}
              {needAi > 0 && <IconExclamationCircle style={{ fontSize: 16 }} />}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink3">文件格式</div>
            <div className="mt-1 text-xl font-semibold text-ink uppercase">{result.format || '—'}</div>
          </div>
          <div className="flex items-end justify-end">
            <button
              onClick={commit}
              disabled={committing || okCount === 0}
              className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {committing ? '入库中…' : `确认入库 ${okCount} 题`}
            </button>
          </div>
        </div>

        {/* 题型分布 */}
        {result.summary?.byType && Object.keys(result.summary.byType).length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(result.summary.byType).map(([t, n]) => (
              <span key={t} className="rounded-md bg-canvas px-2.5 py-1 text-ink2">
                {t === 'single' ? '单选' : t === 'multiple' ? '多选' : t === 'judge' ? '判断' : t} × {n}
              </span>
            ))}
            {result.summary.failed > 0 && (
              <span className="rounded-md bg-orange-50 px-2.5 py-1 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300">
                未识别块 × {result.summary.failed}
              </span>
            )}
          </div>
        )}

        {/* 待处理原文块 */}
        {result.failed.length > 0 && (
          <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/40 dark:bg-orange-900/10">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-orange-600 dark:text-orange-300">
                <IconExclamationCircle /> 识别失败的内容（{result.failed.length} 块）
              </div>
              <button
                onClick={() => setAiModal(true)}
                disabled={aiParsing}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {aiParsing ? <Spin size={12} /> : <IconRobot />}
                {aiParsing ? 'AI 解析中…' : aiDone > 0 ? '再次用 AI 解析' : '用 AI 解析'}
              </button>
            </div>
            <div className="max-h-40 overflow-auto rounded-lg bg-white/60 p-3 text-xs leading-5 text-ink2 whitespace-pre-wrap dark:bg-black/20">
              {result.failed.join('\n\n---\n\n')}
            </div>
            <div className="mt-2 text-[11px] text-ink3">
              {aiDone > 0
                ? `AI 已解析出 ${aiDone} 道题并加入下方预览列表（可编辑复核）。剩余原文仍保留在此，可再次尝试或手动补录。`
                : 'AI 解析全部手动触发；未配置 AI 时也可手动补录下方题目，或跳过这些内容。'}
            </div>
          </div>
        )}

        {/* 预览题目列表（可编辑） */}
        <div className="flex flex-col gap-3">
          {edits.map((q, i) => (
            <div key={i} className="card-note flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink3">#{i + 1}</span>
                <div className="flex items-center gap-2">
                  <Radio.Group
                    type="button"
                    size="small"
                    value={q.type === 'unknown' ? 'unknown' : q.type}
                    options={TYPE_OPTIONS}
                    onChange={(v) => patch(i, { type: String(v) })}
                  />
                  <button onClick={() => remove(i)} className="text-xs text-ink3 hover:text-danger transition-colors">
                    删除
                  </button>
                </div>
              </div>
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 4 }}
                value={q.stem}
                placeholder="题干"
                onChange={(v) => patch(i, { stem: v })}
              />
              {q.options && q.options.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {q.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-ink3 w-4">{o.k}</span>
                      <Input size="small" value={o.text} placeholder={`选项 ${o.k}`}
                        onChange={(v) => patch(i, { options: q.options!.map((x, xi) => (xi === oi ? { ...x, text: v } : x)) })} />
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[11px] text-ink3">答案{q.type === 'multiple' ? '（如 AC）' : q.type === 'judge' ? '（对/错）' : ''}</div>
                  <Input size="small" value={q.answer}
                    placeholder={q.type === 'judge' ? '对 / 错' : q.type === 'multiple' ? '如 AC' : '如 A'}
                    onChange={(v) => patch(i, { answer: v })} />
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-ink3">解析（可选）</div>
                  <Input size="small" value={q.explanation || ''} placeholder="解析"
                    onChange={(v) => patch(i, { explanation: v })} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 底部确认 */}
        <div className="sticky bottom-20 flex justify-end md:bottom-4">
          <button
            onClick={commit}
            disabled={committing || okCount === 0}
            className="rounded-xl bg-primary px-8 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {committing ? '入库中…' : `确认入库 ${okCount} 题`}
          </button>
        </div>

        {/* AI 解析确认（调用前明示发送范围与机制） */}
        <Modal
          title="用 AI 解析这些内容？"
          visible={aiModal}
          onCancel={() => setAiModal(false)}
          onOk={runAiParse}
          okText={aiParsing ? '解析中…' : '确认解析'}
          cancelText="取消"
          confirmLoading={aiParsing}
        >
          <div className="flex flex-col gap-3 text-sm text-ink2">
            <p className="m-0">
              将把 <b className="text-ink">{result?.failed.length ?? 0}</b> 块原文
              {llmModel ? `发送到你的模型（${llmModel}）` : '发送到你配置的模型'}
              进行结构化解析，解析结果会加入下方预览列表，可复核后再入库。
            </p>
            <div className="rounded-lg bg-canvas p-3 text-xs leading-5 text-ink3">
              <div className="flex items-center gap-1 font-medium text-ink2"><IconCheckCircle /> 调用机制与隐私</div>
              <ul className="m-0 mt-1 flex flex-col gap-1 pl-4">
                <li>手动触发：只有你点击确认才会发送，不会自动发生</li>
                <li>只发送这些原文与固定指令，按内容量分批，尽量省 token</li>
                <li>请求只发到你填写的 API 地址，Key 仅存 NAS、界面不回显</li>
              </ul>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  // step === 'pick'
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-xl font-semibold text-ink md:text-2xl">导入题库</h1>
        <p className="mt-1 text-sm text-ink3">支持 Excel / Word / PDF / 文本，规则引擎先识别，识别不了的再手动或 AI 处理</p>
      </div>

      <div className="card-note flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-ink">① 选择目标题库</div>
          <div className="flex gap-2">
            <Select
              className="flex-1"
              placeholder="选择已有题库，或先创建"
              value={bankId || undefined}
              onChange={(v) => setBankId(String(v))}
              options={banks.map((b) => ({ label: `${b.name}（${b.question_count} 题）`, value: b.id }))}
            />
            <button
              onClick={() => nav('/')}
              className="shrink-0 rounded-xl border border-line px-4 py-1.5 text-sm text-ink2 hover:text-primary transition-colors"
            >
              去创建
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium text-ink">② 选择题库文件</div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={!bankId}
            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line bg-canvas px-6 py-10 text-ink2 transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
          >
            <IconUpload style={{ fontSize: 32 }} />
            <span className="text-sm font-medium">点击选择文件（{ACCEPT}）</span>
            <span className="text-xs text-ink3">单文件最大 32MB</span>
          </button>
        </div>
      </div>

      <div className="card-note p-4 text-xs leading-5 text-ink3">
        识别原理：规则引擎按常见排版切分题目与选项；格式无法识别的内容会保留原文供你确认，可手动补录或点「用 AI 解析」。题目与 AI 请求只在你配置模型后才会发送，且只发送到你自己填写的地址。
      </div>
    </div>
  );
}
