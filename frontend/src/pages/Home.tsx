/**
 * Home.tsx — 我的题库：统计卡 + 题库卡片网格 + 创建题库
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Message, Modal, Input, Select, Empty, Spin } from '@arco-design/web-react';
import { IconPlus, IconBook, IconApps } from '@arco-design/web-react/icon';
import { api, type Bank } from '../api';

const CATS = ['数学', '英语', '语文', '物理', '化学', '驾考', '编程', '其他'];

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card-note flex flex-col gap-1 p-4">
      <span className="text-xs text-ink3">{label}</span>
      <span className="text-2xl font-semibold text-ink">{value}</span>
      {sub && <span className="text-[11px] text-ink3">{sub}</span>}
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(false);
  const [name, setName] = useState('');
  const [cat, setCat] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setErr('');
    api.banks().then((d) => setBanks(d.banks)).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const create = async () => {
    if (!name.trim()) { Message.warning('请输入题库名称'); return; }
    setSaving(true);
    try {
      const b = await api.createBank(name.trim(), cat);
      Message.success('题库已创建');
      setModal(false);
      setName('');
      setCat(undefined);
      nav(`/banks/${b.id}`);
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const totalQuestions = banks?.reduce((s, b) => s + (b.question_count || 0), 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-ink md:text-2xl">我的题库</h1>
          <p className="mt-1 text-sm text-ink3">导入题库开始练习，AI 讲解按需生成、仅存本地</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => nav('/import')}
            className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-4 py-2 text-sm font-medium text-ink shadow-sm transition-colors hover:border-primary hover:text-primary"
          >
            <IconApps /> 导入题库
          </button>
          <button
            onClick={() => setModal(true)}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <IconPlus /> 创建题库
          </button>
        </div>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <StatCard label="题库数量" value={banks?.length ?? '—'} sub="全部可见" />
        <StatCard label="题目总数" value={totalQuestions} sub="含导入题目" />
        <StatCard label="最近更新" value={banks?.[0]?.updated_at?.slice(5, 16) ?? '—'} sub={banks?.[0]?.name ? `「${banks[0].name}」` : '暂无题库'} />
      </div>

      {/* M4：学习工具入口 */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <button onClick={() => nav('/stats')}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-base font-semibold text-primary">学习统计</span>
          <span className="text-[11px] text-ink3">正确率 · 趋势 · 题型</span>
        </button>
        <button onClick={() => nav('/wrong')}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-base font-semibold text-danger">错题集</span>
          <span className="text-[11px] text-ink3">自动归集 · 反复练习</span>
        </button>
        <button onClick={() => nav('/favorites')}
          className="card-note flex flex-col items-center gap-1 px-2 py-4 transition-colors hover:border-primary/40">
          <span className="text-base font-semibold text-warning">收藏</span>
          <span className="text-[11px] text-ink3">重点题 · 随时回顾</span>
        </button>
      </div>

      {/* 题库网格 */}
      {banks === null ? (
        <div className="flex justify-center py-20"><Spin size={30} /></div>
      ) : banks.length === 0 ? (
        <div className="card-note flex flex-col items-center gap-4 py-16">
          <Empty description="还没有题库，创建或导入一个开始吧" />
          <button
            onClick={() => setModal(true)}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            创建第一个题库
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {banks.map((b) => (
            <button
              key={b.id}
              onClick={() => nav(`/banks/${b.id}`)}
              className="card-note group flex flex-col gap-3 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-light text-primary">
                  <IconBook style={{ fontSize: 20 }} />
                </div>
                <span className="rounded-md bg-canvas px-2 py-0.5 text-[11px] text-ink3">{b.category || '未分类'}</span>
              </div>
              <div>
                <div className="text-[15px] font-semibold text-ink group-hover:text-primary transition-colors">{b.name}</div>
                <div className="mt-1 text-xs text-ink3">
                  {b.question_count} 题 · 更新于 {b.updated_at.slice(0, 10)}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <span className="flex-1 rounded-lg bg-canvas px-3 py-1.5 text-center text-xs font-medium text-ink2">
                  查看题目
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); nav(`/import?bank=${b.id}`); }}
                  className="flex-1 rounded-lg border border-line px-3 py-1.5 text-center text-xs font-medium text-primary hover:bg-primary-light transition-colors"
                >
                  导入题目
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 创建题库 */}
      <Modal
        title="创建题库"
        visible={modal}
        onCancel={() => setModal(false)}
        onOk={create}
        okText="创建"
        cancelText="取消"
        confirmLoading={saving}
        autoFocus={false}
        style={{ width: 'min(92vw, 520px)' }}
      >
        <div className="flex flex-col gap-3 pt-1">
          <Input
            placeholder="题库名称（如：初中数学·有理数）"
            value={name}
            onChange={setName}
            maxLength={40}
            onPressEnter={create}
          />
          <Select
            placeholder="分类（可选）"
            value={cat}
            onChange={(v) => setCat(v)}
            allowClear
            options={CATS.map((c) => ({ label: c, value: c }))}
          />
        </div>
      </Modal>
    </div>
  );
}
