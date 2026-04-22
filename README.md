# LeanAI — 精益生产 AI 智能体

面向制造业的可私有化部署 AI 智能体：对话驱动的精益诊断、图表生成、报告导出、知识库检索。类似 Claude Code 的形态，但针对工厂场景。

## 快速开始

### 本地开发

```bash
pnpm install
pnpm --filter @lean-ai/core dev
# 浏览器访问 http://localhost:5173（UI 开发模式）
# 或 pnpm --filter @lean-ai/core build && node packages/core/dist/cli/index.js
```

### 云端/企业部署

**Docker（推荐）**：

```bash
cp .env.example .env    # 填入 LEANAI_LICENSE_SECRET
docker compose up -d --build
```

**裸机 systemd**：

```bash
sudo bash scripts/deploy.sh
```

完整步骤见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 文档

- 📘 [部署指南](./docs/DEPLOYMENT.md)（Docker / Git / systemd / 反代 / 备份）
- 📗 [使用说明](./docs/USER_GUIDE.md)（首次配置 / 对话 / 图表 / 报告 / 知识库）

## 项目结构

```
packages/
  core/                 # CLI + 服务器 + UI（@lean-ai/core）
  skill-diagnosis/      # 精益诊断技能
  skill-charts/         # 图表生成（鱼骨/Pareto/VSM/箱型）
  skill-reports/        # 8D / DMAIC / 综合报告
  skill-knowledge/      # RAG 知识库
docs/                   # 部署 + 使用文档
scripts/                # 部署脚本（docker-entrypoint.sh / deploy.sh / lean-ai.service）
Dockerfile              # 多阶段构建
docker-compose.yml      # 一键启动
```

## 主要技术栈

Node.js 18+ / TypeScript / Express / React 18 + Vite / SQLite (better-sqlite3) / LanceDB 向量库 / pnpm workspace + Turborepo。

## 支持的 LLM Provider

Claude · OpenAI · DeepSeek · 通义千问 · MiniMax · 文心一言 · Ollama（本地）。
