# 商机参谋团 OAC

**Opportunity Advisory Crew** 是一个面向销售、售前和业务团队的商机研究与拜访作战系统。它把“我方企业能力”和“目标客户公开情报”结合起来，自动完成客户主体核验、资料检索、证据分层、商机评级、方案建议、交付预判和拜访问卷生成，帮助团队在初次拜访前形成一份可行动、可追溯、适合手机阅读的作战简报。

OAC 的目标不是替代销售判断，也不是自动生成正式投标方案；它更像一组数字参谋，帮助团队快速回答：

- 这个客户是否值得继续投入。
- 客户可能处在什么经营状态、业务压力和技术阶段。
- 我方能力与客户痛点之间是否存在可验证切入点。
- 首次拜访应该从什么话题切入，必须问出哪些关键信息。
- 售前方案、交付边界和内部风险应该提前如何准备。

## 核心能力

- **我的企业**：先定义供给方的主营业务和核心产品，再围绕该能力研究目标客户，避免生成脱离我方能力的建议。
- **企业主体核验**：结合天眼查等结构化数据和公开搜索，降低同名公司、集团/子公司混淆、招聘页碎片误匹配等风险。
- **证据池**：来源按主体核验、官网/产品、客户案例、招聘、招投标、专利/软著、行业背景、财务/预算等类型保留，不让工商信息挤占业务洞察。
- **敏感信息核验**：法律、信用、股权、财务、重大项目等敏感线索会进入二次核验；未证实内容不会写成确定事实。
- **作战简报**：报告按企业画像、商务分析、方案分析、交付分析、行动指南组织，采用总分结构和观点句，避免堆资料。
- **拜访轮次闭环**：会后可追加会议纪要、客户反馈或文字附件，形成第二轮、第三轮判断，刷新评级、痛点、方案和下一步动作。
- **License 与租户隔离**：支持授权码登录、企业平台对接、用量扣减、设备限制、租户数据隔离和管理员 License 管理。

## 报告结构

OAC 报告不是资料汇编，而是围绕销售、售前和交付三个视角组织的作战卡：

1. **企业画像**：主体与股权/区域、产品与客户、业务洞察、数字化与 AI 线索。
2. **商务分析**：客户优先级、预算/买单能力、决策链/采购路径、近期触发、商务风险。
3. **方案分析**：客户现状、外部压力、痛点机会、解决思路、方案优先级。
4. **交付分析**：先拆 SOW 工作包，再看交付风险、应对方案和前置条件；不输出人天、工期或价格估算。
5. **行动指南**：开场切入、必问问题、内部边界、会后更新。

每个一级栏目都要求是明确观点句，并带有分论点和支撑依据。没有有效观点的信息不会为了凑栏目硬写出来。

## 技术架构

- **前端**：Vite + TypeScript，移动端优先的单页应用。
- **后端**：Netlify Functions，承担授权、主体核验、任务创建、后台生成、报告检索和轮次分析。
- **存储**：本地开发使用 `local-data/`；线上使用 Netlify Blobs 保存租户数据、任务、报告、索引、License 和用量流水。
- **模型**：DeepSeek 官方 API。模型用于检索规划、摘要和综合分析，不直接作为事实来源。
- **数据源**：天眼查结构化数据、Tavily 搜索、Jina/网页读取、年报 PDF 和用户上传/输入内容共同组成证据池。

## 本地运行

复制环境变量模板：

```bash
cp .env.example .env
```

安装依赖：

```bash
npm install
```

启动本地服务：

```bash
start-local.cmd
```

默认打开：

```text
http://localhost:8888
```

停止本地服务：

```bash
stop-local.cmd
```

## 环境变量

本地使用 `.env`，线上在 Netlify 后台配置同名环境变量。不要把真实密钥提交到仓库。

```text
DEEPSEEK_API_KEY=
DEEPSEEK_API_BASE_URL=https://api.deepseek.com
DEEPSEEK_RESEARCH_MODELS=deepseek-v4-flash,deepseek-v4-pro
DEEPSEEK_THINKING_MODE=disabled

TIANYANCHA_API_KEY=
TYC_MCP_ENDPOINT=https://mcp.tianyancha.com/v1

SEARCH_PRIMARY=tavily
TAVILY_API_KEYS=
TAVILY_MODE=always

JINA_API_KEY=

ADMIN_SECRET=
OAC_SESSION_SECRET=
OAC_HASH_SECRET=
OAC_AUTH_DISABLED=false
```

说明：

- `DEEPSEEK_API_KEY` 是必填项。
- `TAVILY_API_KEYS` 可配置多个 Key，用英文逗号或换行分隔。
- `TIANYANCHA_API_KEY` 用于企业主体核验和结构化企业信息补充。
- `ADMIN_SECRET` 只给管理员后台使用。
- `.env`、`local-data/`、日志和构建产物已经在 `.gitignore` 中排除。

## License 与企业对接

OAC 支持两种使用方式：

- **网页授权码登录**：管理员创建 License 后，用户输入授权码进入系统。系统按租户隔离我的企业、任务和报告。
- **企业平台对接**：企业后端使用 Master API Key 换取一次性登录 code，再嵌入 OAC 页面或调用 API 创建任务、查询进度和获取报告。

原始 License Key 和 Master Key 不明文存储；管理员创建或重置后只显示一次。

## 部署到 Netlify

项目包含 `netlify.toml`：

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"
```

部署前先本地检查：

```bash
npm run check:oac-release
```

线上报告数据不会随 GitHub 代码自动同步；需要迁移演示数据时，应通过 Netlify Blobs 或专门脚本导入。

## 发布检查

低成本完整检查：

```bash
npm run check:oac-release
```

该命令覆盖：

- 文案安全和密钥安全。
- License 登录、设备限制、租户隔离和用量扣减。
- Netlify Functions 冒烟测试。
- 任务身份保留、断点续跑相关持久化。
- 报告 JSON/HTML/索引离线端到端落盘。
- 报告质量、商业价值、1.0 对比、移动端渲染和工作台渲染。
- 生产构建和展示页生成。

真实任务金丝雀会消耗搜索和模型额度，默认不会自动运行。执行前先使用：

```bash
npm run canary:oac-check
```

正式运行需显式设置环境变量并确认：

```bash
OAC_CANARY_CONFIRM=RUN
OAC_CANARY_BASE_URL=http://localhost:8888
OAC_CANARY_LICENSE=<license key>
OAC_CANARY_COMPANY_FILE=scripts/canary-company.example.json
npm run canary:oac-real
```

本地中文 payload 测试请使用 UTF-8 JSON 文件或 Node 脚本发送请求。不要用 PowerShell 哈希表加 `ConvertTo-Json` 组装中文企业名，否则可能把中文变成问号。

## 使用流程

1. 在“我的企业”中创建或选择供给方企业。
2. 在“创建”中输入目标客户名称，必要时补充地区、行业、已知需求或年报。
3. 从候选主体中确认正确客户。
4. 创建任务后可关闭页面，稍后在“任务中心”查看进度。
5. 报告生成后，在“报告”中打开作战简报。
6. 拜访后追加会议纪要、客户反馈或文字附件，生成下一轮判断。

## 边界说明

- 报告适合会前研究、初访判断和售前资源分配，不等同于法律、财务或投资尽调报告。
- 公开情报适合生成假设和拜访问题，不应被当作客户内部事实。
- 预算、真实决策链、采购时间表、内部态度和真实痛点优先级仍需通过拜访验证。
- 年报 PDF 目前主要支持文字型 PDF；扫描件需要 OCR 后再处理。
- 模型输出需要结合业务经验复核，尤其是预算、付款、法律风险、决策链和重大项目线索。

## 宣传物料

外发物料位于：

- `docs-assets/oac-promo-poster.html`
- `docs-assets/oac-promo-poster.png`

这些素材用于介绍产品价值，不包含密钥、内部测试信息或个人语境。
