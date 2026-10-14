# 爱刷题

> Slogan：练一题 · 进一步

面向飞牛 fnOS 的开源刷题应用：导入你自己的题库（TXT / Excel / Word / PDF），生成答题练习；每题可按需调用你自己配置的大模型讲解，**所有 AI 调用手动触发、全程隐私透明**。

- 前端：React 18 + Vite + TypeScript + Arco Design + Tailwind CSS 4（单工程，PC / 移动自适应）
- 后端：Node.js 原生 `node:http` + `node:sqlite`，零原生依赖（仅 xlsx / mammoth / pdf-parse 三个纯 JS 解析库）
- 主题：浅色 / 深色 / 跟随系统 三态切换，持久化记忆
- 练习闭环：顺序练习（断点续练/判分/错题归集）、模拟卷（组卷/交卷/回看）、错题集（移除/掌握）
- 体验：题目收藏、学习统计（正确率/章节分布/14 天趋势）、模板记忆（同文件二次导入免解析）、权限校验（私有题库仅属主可读）
- 开源：AGPL-3.0 License，无任何遥测

## 目录结构

```
shuatixia/
├── manifest                 # fnOS 应用清单（爱刷题）
├── cmd/                     # fnOS 生命周期脚本（9 个）
├── config/                  # resource / privilege
├── wizard/uninstall         # 卸载向导（保留/删除数据）
├── app/
│   ├── server/              # 后端（node:http + node:sqlite）
│   │   ├── server.js        # HTTP 服务 + 路由 + multipart
│   │   ├── db.js            # SQLite schema（题目/题库/答题记录/错题/收藏/AI 用量）
│   │   ├── judge.js         # 客观题判分
│   │   ├── import/          # 识别引擎：detect → worker → excel/word/pdf → rules
│   │   └── tests/           # 自测（识别引擎 / API 集成 / 真实 PDF）
│   ├── ui/                  # 图标等静态资源
│   └── www/                 # 前端构建产物（后端静态托管）
├── frontend/                # 前端工程（React18 + Arco + Tailwind4）
├── dev.bat                  # 一键双窗口调试（后端 18099 / 前端 5173）
└── _legacy/                 # 旧版实现备份（不参与打包）
```

## 本地调试

```bat
dev.bat        :: 同时启动后端（18098，.devdb2）与前端（5173，HMR）
```

或用 VS Code：`.vscode/launch.json` 的 compound 配置一键启动前后端。

后端接口（开发态前缀 `/api`，fnOS 部署态网关前缀 `/app/shuatixia/`）：

```
GET  /api/health                   健康检查
POST /api/banks                    创建题库
GET  /api/banks                    题库列表
GET  /api/banks/:id                题库详情
GET  /api/banks/:id/questions      题目列表（分页）
POST /api/banks/:id/import         上传文件识别（multipart）
GET  /api/imports/:token           识别预览
POST /api/imports/:token/commit    确认入库（追加模式，支持分批）
GET  /api/settings / PUT /api/settings      设置（主题等）
PUT  /api/settings/llm                      保存 LLM 配置（Key 仅后端存储，只回脱敏尾号）
POST /api/ai/explain                        按题生成 AI 讲解（缓存优先，同题不重复计费）
POST /api/ai/parse                          导入 AI 解析（仅手动触发，分批省 token）
GET  /api/ai/usage                          AI 用量记录（不含题目内容）
POST /api/banks/:id/practice/reset            顺序练习重置进度（重新开始一轮）
GET  /api/banks/:id/practice                  顺序练习（断点续练）
POST /api/banks/:id/practice/answer           答题判分（错题归集/进度推进）
POST /api/banks/:id/papers                    组卷（随机抽题）
GET  /api/papers / GET /api/papers/:id        试卷列表 / 回看（含用户答案）
POST /api/papers/:id/submit                   交卷计分
GET  /api/wrong / DELETE /api/wrong/:id       错题集（增删）
POST /api/questions/:id/favorite              收藏 / 取消收藏
GET  /api/favorites                           收藏列表（可按题库过滤）
GET  /api/stats                               学习统计（正确率/章节/趋势）
```

## 打包发布

```bash
cd frontend && npm run build      # 1. 构建前端
xcopy frontend\dist\* app\www\    # 2. 拷贝到应用目录
fnpack build                      # 3. 打包（产物 shuatixia.fpk，可在应用中心安装）
```

## 导入识别

识别引擎按 快速规则 → 手动 AI 兜底 两级设计：

- **规则通道（本地、免费、即时）**：支持编号排版（`1. xxx` / `A. xxx` / `答案：C` / `解析：…` / 章节标题）、
  标记格式（`[Q]题干 [A]选项 [T]答案 [P]知识点 [I]题型码`，无线电/驾考导出常见）、
  Excel 表格式（题号/题干/选项/答案/解析列）、Word 与文本型 PDF 抽取后走同一规则。
- **AI 兜底（手动触发）**：规则识别失败或低置信的题目保留原文，在预览页点「用 AI 解析」逐块调用你配置的模型识别。不会自动消耗 token。

## AI 使用与隐私

- **完全手动**：AI 解析与 AI 讲解都只在你点击时触发；关闭 AI 不影响建库、导入、练习等核心功能。
- **Key 只存 NAS**：你在设置页配置的大模型 API Key 仅保存在 NAS 本地，配置后不再回显；所有 AI 调用只在后端发起，浏览器不接触 Key。
- **省 token**：AI 讲解按需生成并本地缓存（每题只生成一次）；失败题只发送原文与必要上下文；批量识别单次不超过 20 题分批发送；可配置更便宜的模型。
- **可审计**：所有 AI 调用集中在后端单一模块；`ai_usage` 记录只含调用时间/模型/耗 token，**不包含题目内容**。
- **开源透明**：本项目 AGPL-3.0 开源、无遥测，AI 调用机制全部代码可查。

## 兼容性

- fnOS ≥ 1.2.0401，需要 nodejs_v22 应用
- 浏览器：Chrome / Edge / Safari 最新两个大版本

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)（另见仓库内 LICENSE 文件）
