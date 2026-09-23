/**
 * api.ts — 后端 API 封装
 * BASE = vite BASE_URL + 'api'：构建态（fnOS 网关 /app/shuatixia/）→ /app/shuatixia/api，
 * 后端剥离前缀后按 /api 路由；开发态（base=/）→ /api，由 vite 代理到后端。
 */
const BASE = `${import.meta.env.BASE_URL}api`;

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as BodyInit;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const j = await res.json().catch(() => ({ ok: false, error: '网络错误' }));
  if (!res.ok || j.ok === false) {
    throw new Error(j.error || `请求失败(${res.status})`);
  }
  return j.data as T;
}

export interface Bank {
  id: string;
  name: string;
  category: string | null;
  visibility: string;
  total_count: number;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  seq: number;
  type: 'single' | 'multiple' | 'judge' | 'unknown' | string;
  stem: string;
  options: { k: string; text: string }[] | null;
  answer: string;
  explanation: string | null;
  explanation_ai: string | null;
  chapter: string | null;
  confidence: number;
}

export interface ImportSummary {
  total: number;
  failed: number;
  lowConf: number;
  needAi: number;
  byType: Record<string, number>;
}

export interface ImportResult {
  format: string;
  name: string;
  ok: boolean;
  mode?: string;
  questions: Question[];
  failed: string[];
  raw?: string;
  empty?: boolean;
  hint?: string;
  summary: ImportSummary;
}

/** AI 识别格式：样例 + AI 建议规范 */
export interface FormatHint {
  kind: 'text' | 'excel';
  sample: string;
  headers: string[];
  hint: Record<string, unknown>;
}

/** 文本格式规范（kind='text'）：每个字段 { regex } */
export interface TextSpec {
  kind: 'text';
  stem: { regex: string };
  options: { regex: string };
  answer: { regex: string };
  explanation?: { regex: string };
  chapter?: { regex: string };
  chapterTitle?: { regex: string };
  typeMark?: { regex: string };
  defaultType?: 'single' | 'multiple' | 'judge' | null;
}

/** Excel/CSV 格式规范（kind='excel'）：列名映射 */
export interface ExcelSpec {
  kind: 'excel';
  headerRow: number;
  columns: {
    stem: string;
    answer: string;
    options: string[];
    explanation?: string;
    chapter?: string;
    type?: string;
  };
}

export type ImportSpec = TextSpec | ExcelSpec;

export interface SettingsInfo {
  theme: string;
  llm_configured: boolean;
  llm_model: string | null;
  llm_base: string | null;
  llm_key_tail: string | null;
}

export interface AiUsageItem {
  id: number;
  kind: 'explain' | 'parse';
  model: string | null;
  questions: number;
  chars: number;
  created_at: string;
}

export interface PracticeQuestion {
  id: string;
  seq: number;
  type: string;
  stem: string;
  options: { k: string; text: string }[] | null;
  chapter: string | null;
}

export interface PracticeState {
  total: number;
  last_seq: number;
  question: PracticeQuestion | null;
}

export interface AnswerResult {
  correct: boolean | null;
  answer: string;
  explanation: string | null;
  explanation_ai: string | null;
  next_seq: number;
  finished: boolean;
}

export interface Paper {
  id: string;
  bank_id: string;
  title: string;
  status: 'in_progress' | 'submitted';
  score: number | null;
  total: number | null;
  started_at: string;
  submitted_at: string | null;
  config: string;
  question_ids: string[];
  questions: Question[];
  user_answers: Record<string, { user_answer: string; correct: boolean }>;
}

export interface WrongItem {
  id: string;
  bank_id: string;
  seq: number;
  type: string;
  stem: string;
  options: { k: string; text: string }[] | null;
  answer: string;
  explanation: string | null;
  chapter: string | null;
  wrong_count: number;
  last_wrong_at: string;
  status: number;
}

export const api = {
  health: () => request<{ name: string; version: string }>('GET', '/health'),
  banks: () => request<{ banks: Bank[] }>('GET', '/banks'),
  createBank: (name: string, category?: string) =>
    request<Bank>('POST', '/banks', { name, category }),
  bankDetail: (id: string) => request<Bank>('GET', `/banks/${id}`),
  questions: (id: string, page = 1, size = 20) =>
    request<{ total: number; page: number; size: number; questions: Question[] }>(
      'GET',
      `/banks/${id}/questions?page=${page}&size=${size}`
    ),
  importFile: (bankId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ token: string; summary: ImportSummary | null; format: string; name: string; ok: boolean; empty?: boolean; hint?: string; error?: string; template_hit?: { bank_id: string; imported: number } | null; spec_hit?: { kind: string; signature: string } | null }>(
      'POST',
      `/banks/${bankId}/import`,
      fd,
      true
    );
  },
  importResult: (token: string) => request<ImportResult>('GET', `/imports/${token}`),
  commitImport: (token: string, questions?: Question[]) =>
    request<{ bank_id: string; imported: number }>('POST', `/imports/${token}/commit`, { questions }),
  // AI 识别格式：生成建议规范 / 应用并保存规范
  formatHint: (token: string) => request<FormatHint>('POST', `/imports/${token}/format-hint`, {}),
  applyFormat: (token: string, spec: ImportSpec) => request<ImportResult>('POST', `/imports/${token}/apply-format`, { spec }),
  settings: () => request<SettingsInfo>('GET', '/settings'),
  saveSettings: (theme: string) => request<{ ok: boolean }>('PUT', '/settings', { theme }),
  saveLlm: (body: { baseUrl: string; apiKey: string; model: string; clearKey?: boolean }) =>
    request<SettingsInfo>('PUT', '/settings/llm', body),
  aiExplain: (questionId: string) =>
    request<{ cached: boolean; text: string }>('POST', '/ai/explain', { question_id: questionId }),
  aiParse: (token: string) =>
    request<{ questions: Question[]; parsed: number; remaining_blocks: number }>('POST', '/ai/parse', { token }),
  aiUsage: () => request<{ usage: AiUsageItem[] }>('GET', '/ai/usage'),
  // 练习
  practice: (bankId: string) => request<PracticeState>('GET', `/banks/${bankId}/practice`),
  practiceAnswer: (bankId: string, questionId: string, answer: string) =>
    request<AnswerResult>('POST', `/banks/${bankId}/practice/answer`, { question_id: questionId, answer }),
  // 模拟卷
  createPaper: (bankId: string, count: number, title?: string) =>
    request<{ paper: Paper }>('POST', `/banks/${bankId}/papers`, { count, title }),
  papers: () => request<{ papers: Paper[] }>('GET', '/papers'),
  paper: (id: string) => request<{ paper: Paper }>('GET', `/papers/${id}`),
  submitPaper: (id: string, answers: Record<string, string>) =>
    request<{ score: number; total: number; results: { question_id: string; seq: number; correct: boolean | null; user_answer: string; answer: string }[] }>(
      'POST',
      `/papers/${id}/submit`,
      { answers }
    ),
  // 错题
  wrong: (bankId?: string) => request<{ wrong: WrongItem[] }>('GET', `/wrong${bankId ? `?bank_id=${bankId}` : ''}`),
  removeWrong: (questionId: string) => request<{ removed: boolean }>('DELETE', `/wrong/${questionId}`),
  // M4：练习重置 / 收藏 / 统计
  resetPractice: (bankId: string) => request<{ reset: boolean }>('POST', `/banks/${bankId}/practice/reset`),
  favorite: (questionId: string, fav: boolean) =>
    request<{ favorited: boolean }>('POST', `/questions/${questionId}/favorite`, { favorite: fav }),
  favorites: (bankId?: string) =>
    request<{ favorites: WrongItem[] }>('GET', `/favorites${bankId ? `?bank_id=${bankId}` : ''}`),
  stats: () => request<Stats>('GET', '/stats'),
};

export interface Stats {
  answered: number;
  correct: number;
  wrong_rate: number;
  wrong_total: number;
  wrong_mastered: number;
  favorites: number;
  papers: number;
  active_days: number;
  by_type: { type: string; count: number; correct: number; rate: number }[];
  by_chapter: { chapter: string; count: number; correct: number; rate: number }[];
  trend: { date: string; count: number; correct: number }[];
}
