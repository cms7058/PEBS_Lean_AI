# =========================================================================
# LeanAI — 精益生产 AI 智能体
# Multi-stage Dockerfile for cloud / private enterprise deployment
# =========================================================================
# Stage 1: build — compile TypeScript server + build React UI bundle
# Stage 2: runtime — slim Node.js image with pre-installed skills in /data
# =========================================================================

# -------- Stage 1: build --------
FROM node:20-bookworm-slim AS builder

# Native build deps for better-sqlite3 (compiled against system headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack (shipped with node 20)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json          packages/core/package.json
COPY packages/skill-charts/package.json  packages/skill-charts/package.json
COPY packages/skill-diagnosis/package.json packages/skill-diagnosis/package.json
COPY packages/skill-knowledge/package.json packages/skill-knowledge/package.json
COPY packages/skill-reports/package.json  packages/skill-reports/package.json

# Fetch deps (uses workspace lockfile)
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages ./packages
COPY docs ./docs
RUN pnpm --filter @lean-ai/core build

# 为带运行时依赖的 skill 重建一份真实 node_modules（pnpm 的 symlink 在
# 拷贝出 monorepo 后会变成死链，技能在 /data/skills/... 下无法 require）。
# skill-charts / skill-diagnosis / skill-knowledge 没有运行时依赖，跳过即可。
#
# 关键：在 workspace 外的 /tmp 目录里用 npm 装一份"真实"node_modules，
# 然后整体替换掉 pnpm 装出来的 symlink 版本。在 workspace 内直接
# `npm install` 会被 pnpm-workspace.yaml / 父级 node_modules 干扰。
RUN mkdir -p /tmp/build-skill-reports \
    && cp /build/packages/skill-reports/package.json /tmp/build-skill-reports/ \
    && cp /build/packages/skill-reports/index.js     /tmp/build-skill-reports/ \
    && cd /tmp/build-skill-reports \
    && npm install --omit=dev --no-audit --no-fund --no-package-lock \
    && rm -rf /build/packages/skill-reports \
    && mv /tmp/build-skill-reports /build/packages/skill-reports \
    && test -f /build/packages/skill-reports/node_modules/docx/package.json \
    && test ! -L /build/packages/skill-reports/node_modules/docx

# -------- Stage 2: runtime --------
FROM node:20-bookworm-slim AS runtime

# Runtime deps for native modules (better-sqlite3 was compiled in builder —
# we only need libstdc++ + tini for PID 1 init). Include python3-minimal for
# a cleaner process tree under docker run.
# fonts-noto-cjk + fontconfig: 让 @napi-rs/canvas 渲染的图表能正确显示中文
# （否则帕累托图 / 鱼骨图 / KPI 对比图中的中文会变成豆腐块）
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini ca-certificates \
        fonts-noto-cjk fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Non-root user — matches host-mounted /data ownership (uid 10001).
# If you mount a pre-existing /data dir, chown it to 10001:10001 beforehand.
RUN groupadd --system --gid 10001 leanai && \
    useradd  --system --uid 10001 --gid leanai --home /home/leanai \
             --shell /usr/sbin/nologin --create-home leanai

WORKDIR /app

# Copy built core package (dist + package.json + production node_modules)
COPY --from=builder /build/packages/core/dist         ./packages/core/dist
COPY --from=builder /build/packages/core/package.json ./packages/core/package.json
COPY --from=builder /build/node_modules               ./node_modules
COPY --from=builder /build/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /build/packages/skill-charts      ./bundled-skills/skill-charts
COPY --from=builder /build/packages/skill-diagnosis   ./bundled-skills/skill-diagnosis
COPY --from=builder /build/packages/skill-knowledge   ./bundled-skills/skill-knowledge
COPY --from=builder /build/packages/skill-reports     ./bundled-skills/skill-reports

# User-facing docs — served by /api/docs so the in-app Help panel can render them
COPY --from=builder /build/docs ./docs
ENV LEANAI_DOCS_DIR=/app/docs

# Entrypoint script: seeds bundled skills into /data/skills/node_modules on
# first boot (or when the image is updated), then execs the server.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN  chmod +x /usr/local/bin/docker-entrypoint.sh

# Data directory — MUST be mounted as a volume in production.
# Contains: config.json, lean-ai.db, vector/, skills/, uploads/, logs/
ENV LEANAI_DATA_DIR=/data \
    LEANAI_HOST=0.0.0.0 \
    LEANAI_PORT=3741 \
    LEANAI_NO_OPEN=1 \
    NODE_ENV=production

RUN mkdir -p /data && chown -R leanai:leanai /data /app
VOLUME ["/data"]

USER leanai

EXPOSE 3741

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LEANAI_PORT||3741)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "/app/packages/core/dist/cli/index.js", "start"]
