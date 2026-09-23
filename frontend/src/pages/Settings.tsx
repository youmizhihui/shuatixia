/**
 * Settings.tsx — 设置：主题三态、LLM 配置、AI 调用记录、隐私说明
 */
import { useEffect, useState } from 'react';
import { Radio, Empty, Input, Message, Modal, Select } from '@arco-design/web-react';
import { IconLock, IconRobot, IconGithub, IconSafe } from '@arco-design/web-react/icon';
import { useTheme, type ThemeMode } from '../theme';
import { api, type AiUsageItem, type SettingsInfo } from '../api';

const KIND_LABEL: Record<string, string> = { explain: 'AI 讲解', parse: 'AI 解析' };

/** 常用 OpenAI 兼容接口预设（选择后自动填充地址与默认模型，均可再手动改） */
const LLM_PRESETS: { label: string; base: string; model: string }[] = [
  { label: 'DeepSeek 深度求索', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '豆包 / 火山方舟', base: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k' },
  { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '通义千问（阿里云百炼）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { label: 'Kimi（Moonshot）', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { label: '硅基流动 SiliconFlow', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
  { label: 'Ollama 本地模型', base: 'http://localhost:11434/v1', model: 'llama3' },
];

export default function Settings() {
  const { mode, setMode } = useTheme();
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [usage, setUsage] = useState<AiUsageItem[]>([]);

  // LLM 表单
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  const [model, setModel] = useState('deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [llmModal, setLlmModal] = useState(false);

  const load = () => {
    api.settings().then((s) => {
      setInfo(s);
      if (s.llm_base) setBaseUrl(s.llm_base);
      if (s.llm_model) setModel(s.llm_model);
    }).catch(() => {});
    api.aiUsage().then((d) => setUsage(d.usage)).catch(() => {});
  };
  useEffect(load, []);

  const themeOptions = [
    { label: '跟随系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
  ];

  const saveLlm = async () => {
    if (!baseUrl.trim()) { Message.warning('请填写 API 地址'); return; }
    if (!model.trim()) { Message.warning('请填写模型名称'); return; }
    if (!apiKey.trim() && !info?.llm_configured) { Message.warning('请填写 API Key'); return; }
    setSaving(true);
    try {
      const s = await api.saveLlm({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() });
      setInfo(s);
      setApiKey('');
      setLlmModal(false);
      Message.success('已保存（Key 仅存 NAS，不回显）');
      api.aiUsage().then((d) => setUsage(d.usage)).catch(() => {});
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="m-0 text-xl font-semibold text-ink md:text-2xl">设置</h1>
        <p className="mt-1 text-sm text-ink3">外观、AI 与隐私</p>
      </div>

      {/* 主题 */}
      <section className="card-note flex flex-col gap-3 p-5">
        <div className="text-sm font-medium text-ink">外观主题</div>
        <Radio.Group
          type="button"
          value={mode}
          onChange={(v) => setMode(v as ThemeMode)}
          options={themeOptions}
        />
        <p className="m-0 text-xs text-ink3">
          「跟随系统」会读取设备的深色模式偏好；也可手动固定浅色或深色。
        </p>
      </section>

      {/* AI 配置 */}
      <section className="card-note flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <IconRobot /> AI 讲解与识别
        </div>

        <div className="rounded-xl bg-canvas px-4 py-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink2">模型配置（OpenAI 兼容，如豆包 / DeepSeek）</span>
            <button
              onClick={() => setLlmModal(true)}
              className="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              {info?.llm_configured ? '修改配置' : '去配置'}
            </button>
          </div>
          {info?.llm_configured ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink3">
              <span>{info.llm_model}</span>
              <span className="truncate">{info.llm_base}</span>
              <span className="font-mono text-ink2">Key {info.llm_key_tail}</span>
              <span className="text-success">已配置</span>
            </div>
          ) : (
            <div className="mt-1 text-xs text-ink3">未配置：AI 解析与逐题讲解不可用，其余功能不受影响</div>
          )}
        </div>

        <div className="rounded-xl bg-canvas px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink2">AI 调用记录</span>
            <span className="text-xs font-medium text-ink3">{usage.length} 次</span>
          </div>
          {usage.length === 0 ? (
            <div className="py-2 text-xs text-ink3">暂无调用——AI 全部手动触发，这里只记录次数与字符量，不记录题目内容</div>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {usage.map((u) => (
                <li key={u.id} className="flex items-center gap-2 text-xs text-ink2">
                  <span className="rounded-md bg-primary-light px-1.5 py-0.5 text-primary dark:bg-primary-dark/30">
                    {KIND_LABEL[u.kind] || u.kind}
                  </span>
                  <span>{u.model}</span>
                  <span>{u.questions} 题</span>
                  <span>{u.chars} 字符</span>
                  <span className="ml-auto text-ink3">{u.created_at}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 隐私说明卡 */}
      <section className="rounded-xl border border-primary/20 bg-primary-light/60 p-5 dark:border-primary/30 dark:bg-primary-dark/20">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
          <IconLock /> 隐私承诺
        </div>
        <ul className="m-0 flex flex-col gap-1.5 pl-4 text-[13px] leading-5 text-ink2">
          <li>AI 全部手动触发：导入识别失败时点「用 AI 解析」、每题点「讲解」才发生调用</li>
          <li>题目只发送到你自行填写的模型地址（豆包 / DeepSeek），不经过任何第三方服务器</li>
          <li>API Key 只保存在你的 NAS 上，界面永不回显，接口只返回脱敏尾号</li>
          <li>同题讲解按需生成并本地缓存，不重复计费；未配置 AI 不影响任何核心功能</li>
          <li>AI 调用仅记录次数与字符量（不记录题目内容），可在本页查看</li>
        </ul>
      </section>

      {/* 开源与关于 */}
      <section className="card-note flex flex-col gap-3 p-5">
        <div className="flex items-center gap-3">
          <IconGithub style={{ fontSize: 22 }} className="text-ink2" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">开源项目 · MIT 协议</div>
            <div className="text-xs text-ink3">代码完全开源、零遥测、无广告，欢迎自行审计或贡献</div>
          </div>
          <span className="shrink-0 rounded-lg bg-canvas px-3 py-1 text-xs text-ink3">AI刷题侠 v0.4.1</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-ink3">
          <div className="rounded-lg bg-canvas px-3 py-2">应用描述 · 隐私优先</div>
          <div className="rounded-lg bg-canvas px-3 py-2">AI 仅手动触发</div>
          <div className="rounded-lg bg-canvas px-3 py-2">Key 仅存本地 NAS</div>
          <div className="rounded-lg bg-canvas px-3 py-2">全部数据本地存储</div>
        </div>
      </section>

      {/* LLM 配置弹窗 */}
      <Modal
        title="配置 AI 模型"
        visible={llmModal}
        onCancel={() => setLlmModal(false)}
        onOk={saveLlm}
        okText={saving ? '保存中…' : '保存'}
        cancelText="取消"
        confirmLoading={saving}
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-start gap-2 rounded-lg bg-canvas p-3 text-xs leading-5 text-ink3">
            <IconSafe style={{ fontSize: 14 }} className="mt-0.5 shrink-0 text-primary" />
            <span>
              Key 只保存在你的 NAS 本地，仅由后端发起调用；界面与接口永不回显完整 Key。
              题目文本只会发送到你填写的这个地址。
            </span>
          </div>
          <div>
            <div className="mb-1 text-xs text-ink3">常用接口（选择后自动填充地址与默认模型，可再手动改）</div>
            <Select
              allowClear
              placeholder="选择常用接口，或直接手动填写下方地址"
              value={LLM_PRESETS.find((p) => p.base === baseUrl)?.label ?? undefined}
              onChange={(v) => {
                const p = LLM_PRESETS.find((x) => x.label === v);
                if (p) { setBaseUrl(p.base); setModel(p.model); }
              }}
              options={LLM_PRESETS.map((p) => ({ label: p.label, value: p.label }))}
            />
          </div>
          <div>
            <div className="mb-1 text-xs text-ink3">API 地址（Base URL，OpenAI 兼容）</div>
            <Input value={baseUrl} onChange={setBaseUrl} placeholder="https://api.deepseek.com/v1" />
          </div>
          <div>
            <div className="mb-1 text-xs text-ink3">模型名称</div>
            <Input value={model} onChange={setModel} placeholder="deepseek-chat" />
          </div>
          <div>
            <div className="mb-1 text-xs text-ink3">API Key（留空表示保留已保存的 Key）</div>
            <Input.Password value={apiKey} onChange={setApiKey} placeholder={info?.llm_configured ? '已配置，留空不修改' : 'sk-…'} />
          </div>
          <p className="m-0 text-[11px] leading-4 text-ink3">
            解析建议用便宜模型（如 deepseek-chat / 豆包 lite）；讲解与解析共用同一配置。
          </p>
        </div>
      </Modal>
    </div>
  );
}
