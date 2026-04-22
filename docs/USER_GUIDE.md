# LeanAI 使用说明

> 一份面向最终用户的操作手册：从首次启动到完整走完"诊断 → 图表 → 报告"全流程。部署相关请看 [DEPLOYMENT.md](./DEPLOYMENT.md)。

---

## 目录

1. [产品简介](#产品简介)
2. [启动与访问](#启动与访问)
3. [第一次使用：三步上手](#第一次使用三步上手)
4. [界面总览](#界面总览)
5. [对话基础](#对话基础)
6. [技能（Skills）](#技能skills)
7. [知识库](#知识库)
8. [图表生成（含 Excel 导入）](#图表生成含-excel-导入)
9. [报告导出](#报告导出)
10. [订阅与授权](#订阅与授权)
11. [常见问题](#常见问题)
12. [开发扩展](#开发扩展)

---

## 产品简介

LeanAI 是一款面向制造业的**精益生产 AI 智能体**，定位类似"Claude Code，但专注工厂和精益"。核心能力：

- **自然语言诊断**：问题描述 → 自动分类（效率/质量/库存/交期） → 收集现场数据 → 根因分析 → 改善方案
- **精益图表即答即画**：鱼骨图、Pareto、价值流图（VSM）、箱型图，对话中直接内嵌渲染
- **报告生成**：8D、DMAIC、综合改善报告，支持 Word / PDF 导出
- **知识库**：上传你自己的作业标准、历史案例、培训资料，AI 自动引用
- **多模型支持**：Claude / OpenAI / DeepSeek / 通义千问 / 文心一言 / MiniMax / Ollama，可随时切换

---

## 启动与访问

根据部署方式不同：

| 部署方式 | 访问地址 |
| --- | --- |
| 本地 `npm install -g lean-ai` 后 `lean-ai` 启动 | http://localhost:3741（自动打开浏览器） |
| Docker Compose | http://&lt;服务器IP&gt;:3741 |
| 裸机 systemd | http://&lt;服务器IP&gt;:3741（见 `systemctl status lean-ai`） |
| Nginx/Caddy 反代 | 你的域名（https） |

首次启动后端会自动创建数据目录（默认 `~/.lean-ai/`，容器下 `/data/`），同时生成一份空白配置。此时直接用会提示"尚未配置 API Key"——这是正常的，进入第 3 节。

---

## 第一次使用：三步上手

### 1. 进入"设置"

点击右上角 ⚙️ 图标。

### 2. 填入一个 LLM 的 API Key

选一个你已经有的 Provider，点击对应的输入框粘贴 API Key，然后点"保存"。页面会显示连通性测试结果（✅ 或具体错误）。

> API Key 本地加密存储在配置文件里，**不会**上传到任何第三方服务器；页面读取时也是脱敏显示（`***`），不会泄露给浏览器。

### 3. 选择模型并开始对话

- 顶部下拉：选 Provider（如 `Claude (Anthropic)`）
- 右侧下拉：选具体模型（如 `claude-sonnet-4-6`）
- 回到主页面，在底部输入框输入：
  > 我们焊接工段的产能不够，节拍时间超标 30%，怎么办？

回车发送，你会看到 AI 主动调用 `start_diagnosis` → `classify_problem` → `probe_data` 等一系列工具，逐步引导你走完诊断流程。

---

## 界面总览

```
┌───────────────────────────────────────────────────────────────────┐
│  LeanAI   [Provider▼][Model▼]                          [⚙ 设置]  │
├────────────────┬──────────────────────────────────────────────────┤
│  💡 已安装技能  │  对话区域                                         │
│  ─────────     │                                                  │
│  ✓ 精益诊断     │  [AI 消息 支持 Markdown]                          │
│  ✓ 图表生成     │                                                  │
│  ✓ 报告生成     │  ▸ 工具调用：generate_vsm（VSM 价值流图）         │
│  ✓ 知识库       │   ┌────────────────────────────┐                 │
│                │   │   [内嵌 SVG 图表]           │                 │
│  💬 对话历史    │   └────────────────────────────┘                 │
│  ─────────     │                                                  │
│  今天          │   [用户消息]                                      │
│   > 会话 1     │                                                  │
│   > 会话 2     │  ┌──────────────────────────────────────┐         │
│  昨天          │  │ 📎 导入数据   消息内容...   [发送 ▶] │         │
│   > ...        │  └──────────────────────────────────────┘         │
└────────────────┴──────────────────────────────────────────────────┘
```

- **顶部栏**：Provider + 模型切换、设置入口
- **左侧**：已安装技能开关（每个技能可独立启用/禁用）、对话历史（按日期分组）
- **中间**：对话流 + 内嵌图表
- **底部输入**：文字输入 / 拖拽上传数据文件 / 快捷按钮

---

## 对话基础

### 输入与发送

- 直接在底部输入框写消息
- **Enter** 发送；**Shift+Enter** 换行
- 正在回复时 Enter 会被忽略（等 AI 答完）

### 消息内 Markdown 支持

AI 返回的消息支持：标题、列表、代码块、表格、数学公式、内嵌图表。表格/图表在消息流中直接可视化。

### 工具调用展示

AI 每次调用技能工具时，会在消息里插入一张可折叠卡片：

```
▸ 工具调用：probe_data (效率类问题)
  入参: { "problemId": "..." }
  结果: 请提供以下数据 ...
```

点击展开可看到完整的入参 / 返回。调试或给同事讲流程时很有用。

### 历史对话

- 每次刷新页面都会回到"上一个对话"
- 左侧"对话历史"列表点开可切换；右键可删除
- 对话中产生的所有消息、工具调用、artifact 都会持久化到本地 SQLite

---

## 技能（Skills）

LeanAI 的功能通过**插件化技能**组织。默认已内置四个：

| 技能 | 主要工具 | 适用场景 |
| --- | --- | --- |
| **精益诊断**（skill-diagnosis） | start_diagnosis / classify_problem / probe_data / analyze_root_cause / generate_solution | 问题诊断 5 阶段引导：分类 → 探查 → 根因 → 确认 → 方案 |
| **图表生成**（skill-charts） | generate_fishbone / generate_pareto / generate_vsm / generate_boxplot | 精益常用图表即答即画 |
| **报告生成**（skill-reports） | generate_8d / generate_dmaic / generate_comprehensive / export_report | 输出可交付的 Word/PDF 报告 |
| **知识库**（skill-knowledge） | search_knowledge / upload_document / list_documents | 检索企业自有资料 |

### 开/关技能

左侧"已安装技能"列表，每项右侧有开关。关闭后 AI 不再看到该技能的工具，也就不会调用它们。

### 安装第三方技能

通过 CLI：
```bash
lean-ai skill install <npm 包名或本地路径或 git URL>
lean-ai skill list
lean-ai skill remove <包名>
```

> 容器化部署下，技能装在容器里的 `/data/skills/node_modules/`（持久化），重启容器不会丢。

### 自己写技能

见 [开发扩展](#开发扩展) 小节。

---

## 知识库

### 上传文档

1. 左侧栏 → "知识库"入口（或直接问 AI"把这个文档加入知识库"并拖入）
2. 支持：PDF / Word (.docx) / Excel (.xlsx/.xls) / Markdown / 纯文本
3. 上传后后台自动解析 → 分块 → 生成嵌入向量

> 首次使用会下载嵌入模型（约 100MB），仅下载一次。

### 检索与使用

- 对话中直接问："我们有没有关于焊接飞溅的作业标准？" —— AI 会自动调用 `search_knowledge`
- 或主动要求："检索知识库 '8D 报告模板' 相关的章节"

### 手动管理

- 文档列表可查看 / 删除单个文件
- 删除文档会连带清除对应的向量索引

---

## 图表生成（含 Excel 导入）

### 直接画图

最简方式——在对话里自然说出来：

- "帮我画一个焊接缺陷的鱼骨图，主因是人/机/料/法/环"
- "这组数据做个 Pareto 图：{不良项:件数}"
- "画出当前焊装线的价值流图，工序包括冲压/焊接/涂装/总装"
- "这批零件直径测量值，做个箱型图"

AI 会调用对应的 `generate_*` 工具，内嵌 SVG 图直接渲染在消息里，可右键另存。

### 从 Excel / CSV 导入数据

**方式 1：拖拽到输入框**

把 `.xlsx` / `.xls` / `.csv` / `.tsv` 文件拖入底部输入框，松开即上传。服务器会解析所有 sheet，返回表头 + 预览，消息框自动填入类似：

```
（已导入 quality_defects.xlsx：1 个 sheet / 120 行，表头: 缺陷类型, 件数, 工位）
请基于上面这份数据生成 Pareto 图。
```

**方式 2：点击📎"导入数据"按钮**

和拖拽等价，只是用文件选择对话框。

导入后直接回车发送，AI 会自动识别结构并生成正确的图表。

### 支持的图表类型

| 类型 | 典型用途 |
| --- | --- |
| 鱼骨图（Ishikawa） | 根因分析，5M1E 分类 |
| Pareto | 缺陷 / 停机类型 80-20 分析 |
| VSM（价值流图） | 物流信息流、识别浪费、计算 Lead Time |
| 箱型图 | 测量数据分布、过程能力 |

---

## 报告导出

用自然语言要求生成：

- "把今天的诊断整理成一份 8D 报告并下载为 Word"
- "把我们上周的改善案例做成综合报告，PDF 给我"

AI 会调用 `generate_8d_report` / `generate_dmaic_report` / `generate_comprehensive_report` + `export_report`，文件生成后消息中会出现下载链接。所有生成的报告也会放在数据目录的 `exports/` 下，方便归档。

---

## 订阅与授权

LeanAI 区分三档订阅：

| Plan | 适合 | 主要限制 |
| --- | --- | --- |
| **Free** | 个人体验 | 知识库条目 / 文档上传 / 每月消息次数有上限 |
| **Personal** | 单人深度使用 | 上限放宽，解锁全部技能 |
| **Enterprise** | 团队 / 企业私有化 | 无限制 + 多席位 |

### 查看当前计划

UI 右上角 → "订阅"入口（或"设置 → 订阅"）查看当前计划、使用量、到期时间。

### 激活授权码

1. 联系销售获取 license key（或在私有化部署中由管理员本地签发）
2. "订阅"页 → 粘贴 license → 激活

> 私有化部署的 license 由 `LEANAI_LICENSE_SECRET` 签名。企业可以自己用这份密钥给内部员工签发永久 / 限期授权。

### 降级到 Free

"订阅"页有"降级到 Free"按钮，立即生效，已生成的数据不受影响。

---

## 常见问题

**Q: 连通性测试失败，提示 401 / 403？**

A: 多半是 API Key 填错或没激活对应 Provider 的计费。按提示到对应厂商后台核实。

**Q: 对话一直"思考中"卡住不动？**

A: 后端大概率丢失了 SSE 连接。检查：① 浏览器控制台 Network 面板看 `/api/chat` 是不是 `pending`；② 反向代理是否关了 `proxy_buffering`（见 DEPLOYMENT.md）。

**Q: 切换模型后之前的对话还能用吗？**

A: 可以。每条消息只跟随当时的 Provider / 模型记录，切换只影响"下一条"消息的调用。

**Q: 知识库里的文档 AI 会发送给云端吗？**

A: 分块后的**向量嵌入**完全在本地计算（使用开源 BAAI/bge-small 模型）。只有当 AI 实际回答时，匹配到的**原文片段**会随提问一起发给你配置的云端 LLM（这是 RAG 的必然）。如需完全本地，换用 Ollama provider 即可。

**Q: 对话历史会在哪里？**

A: 本地 SQLite：`~/.lean-ai/lean-ai.db`（或容器/裸机的数据目录下）。`lean-ai reset` 可清除，`--hard` 选项一并清掉知识库。

**Q: 我想在私有内网离线使用？**

A: 配置 Ollama provider 指向内网模型服务，其余功能完全可用，无需外网。嵌入模型也可以预先放到 `~/.cache/huggingface/` 对应目录。

**Q: 生成的 VSM 图不好看 / 想要 Draw.io 格式？**

A: 右键图表 → "另存为 SVG"；Draw.io 可直接导入 SVG 继续编辑。未来会增加直接导出 Draw.io XML。

---

## 开发扩展

### 添加自定义技能

1. 新建一个 npm 包，`package.json` 里加：
   ```json
   {
     "name": "my-lean-skill",
     "leanAiSkill": true,
     "main": "index.js"
   }
   ```
2. `index.js` 导出 `ISkill` 接口对象：
   ```js
   module.exports = {
     packageName: 'my-lean-skill',
     displayName: '我的技能',
     description: '简短描述（AI 会看到）',
     version: '1.0.0',
     tools: [{
       name: 'my_tool',
       description: 'AI 看到的工具说明',
       inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
       async execute(input, ctx) {
         // ctx.db / ctx.vectorDb / ctx.dataDir 可用
         return { content: '结果文字' }
       }
     }]
   }
   ```
3. 安装：
   ```bash
   lean-ai skill install ./path/to/my-skill
   # 或发布到 npm 后
   lean-ai skill install my-lean-skill
   ```

详细接口字段见源码 `packages/core/src/skills/types.ts`。

### CLI 速查

```bash
lean-ai                              # 启动
lean-ai --port 8080 --no-open        # 自定义端口 / 不打开浏览器
lean-ai config get                   # 查看配置（API Key 脱敏）
lean-ai config set llm.provider openai
lean-ai config set apiKeys.openai sk-...
lean-ai skill list
lean-ai skill install @lean-ai/skill-diagnosis
lean-ai skill remove @lean-ai/skill-diagnosis
lean-ai auth status
lean-ai reset                        # 清空对话历史
lean-ai reset --hard                 # 连知识库一起清
```

---

有更多问题欢迎通过 issue / 内部 IM 反馈。
