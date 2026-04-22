#!/usr/bin/env bash
# =========================================================================
# LeanAI 裸机 / Git 部署脚本
#
# 用法（在目标 Linux 服务器上以有 sudo 权限的用户执行）：
#   sudo bash scripts/deploy.sh
#
# 默认行为：
#   1. 安装 Node.js 20（NodeSource 官方源）+ pnpm + 必要编译依赖
#   2. 在 /opt/lean-ai 存放代码（当前目录内容复制过去），在 /var/lib/lean-ai 存放数据
#   3. 创建 leanai 系统用户并设置权限
#   4. 安装 systemd 服务 lean-ai.service 并启用开机自启
#
# 环境变量（可在执行前 export 覆盖默认值）：
#   LEANAI_INSTALL_DIR   代码目录（默认 /opt/lean-ai）
#   LEANAI_DATA_DIR      数据目录（默认 /var/lib/lean-ai）
#   LEANAI_SERVICE_USER  运行用户（默认 leanai）
#   LEANAI_PORT          监听端口（默认 3741）
#   LEANAI_HOST          监听地址（默认 0.0.0.0）
#   LEANAI_LICENSE_SECRET  订阅签名密钥（未设置时自动生成 openssl rand -hex 32）
# =========================================================================
set -euo pipefail

# ---------- 可配置变量 ----------
INSTALL_DIR="${LEANAI_INSTALL_DIR:-/opt/lean-ai}"
DATA_DIR_VAR="${LEANAI_DATA_DIR:-/var/lib/lean-ai}"
SERVICE_USER="${LEANAI_SERVICE_USER:-leanai}"
PORT="${LEANAI_PORT:-3741}"
HOST_BIND="${LEANAI_HOST:-0.0.0.0}"
LICENSE_SECRET="${LEANAI_LICENSE_SECRET:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"

# ---------- 辅助 ----------
log()  { printf "\033[1;36m[deploy]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[warn]\033[0m  %s\n" "$*"; }
die()  { printf "\033[1;31m[fatal]\033[0m %s\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请使用 sudo / root 执行：sudo bash scripts/deploy.sh"

# 探测包管理器
if   command -v apt-get >/dev/null 2>&1; then PKG=apt
elif command -v dnf     >/dev/null 2>&1; then PKG=dnf
elif command -v yum     >/dev/null 2>&1; then PKG=yum
else die "不支持的发行版：仅支持 Debian/Ubuntu/CentOS/RHEL/Rocky/AlmaLinux"
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "未在 $SRC_DIR 找到 package.json。请在解压后的项目根目录执行本脚本。"

# ---------- 1. 系统依赖 ----------
log "安装系统依赖..."
if [ "$PKG" = "apt" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git python3 make g++ build-essential
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
    log "安装 Node.js $NODE_MAJOR（NodeSource）..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
else
  $PKG install -y ca-certificates curl gnupg2 git python3 make gcc-c++ which
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt "$NODE_MAJOR" ]; then
    log "安装 Node.js $NODE_MAJOR（NodeSource）..."
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    $PKG install -y nodejs
  fi
fi

# pnpm via corepack
log "启用 corepack + pnpm ..."
corepack enable
corepack prepare pnpm@9.15.0 --activate

# ---------- 2. 系统用户 ----------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "创建系统用户 $SERVICE_USER ..."
  useradd --system --home-dir "$DATA_DIR_VAR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
    || useradd --system -d "$DATA_DIR_VAR" -s /sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$DATA_DIR_VAR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR_VAR"

# ---------- 3. 部署代码 ----------
log "同步代码到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
# 排除 node_modules / dist 等生成物，保持干净
(cd "$SRC_DIR" && tar cf - \
    --exclude=node_modules --exclude='**/node_modules' \
    --exclude=dist --exclude='**/dist' \
    --exclude=.git --exclude='.turbo' --exclude='**/.turbo' \
    --exclude='.env' --exclude='.env.local' \
    .) | (cd "$INSTALL_DIR" && tar xf -)

chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# ---------- 4. 安装依赖 + 构建 ----------
log "安装依赖（pnpm install --frozen-lockfile）..."
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"

log "构建前端 + 后端..."
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && pnpm --filter @lean-ai/core build"

# 预安装内置 skills 到数据目录
log "预装内置技能到 $DATA_DIR_VAR/skills/node_modules ..."
sudo -u "$SERVICE_USER" mkdir -p "$DATA_DIR_VAR/skills/node_modules/@lean-ai"
for skill in skill-charts skill-diagnosis skill-knowledge skill-reports; do
  src="$INSTALL_DIR/packages/$skill"
  if [ -d "$src" ]; then
    name=$(node -e "console.log(require('$src/package.json').name)")
    dest="$DATA_DIR_VAR/skills/node_modules/$name"
    if [ ! -d "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp -R "$src" "$dest"
      chown -R "$SERVICE_USER":"$SERVICE_USER" "$dest"
      log "  - 已安装 $name"
    else
      log "  - 已存在，跳过 $name（如需升级请删除 $dest 后重跑）"
    fi
  fi
done

# ---------- 5. 生成 license 密钥（如未提供）----------
if [ -z "$LICENSE_SECRET" ]; then
  if [ -f "$DATA_DIR_VAR/.license_secret" ]; then
    LICENSE_SECRET="$(cat "$DATA_DIR_VAR/.license_secret")"
    log "复用已存在的 license 密钥"
  else
    LICENSE_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf "%s" "$LICENSE_SECRET" > "$DATA_DIR_VAR/.license_secret"
    chmod 600 "$DATA_DIR_VAR/.license_secret"
    chown "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR_VAR/.license_secret"
    log "已生成新的 license 密钥并保存到 $DATA_DIR_VAR/.license_secret"
  fi
fi

# ---------- 6. systemd 服务 ----------
log "安装 systemd 单元 /etc/systemd/system/lean-ai.service ..."
cat > /etc/systemd/system/lean-ai.service <<EOF
[Unit]
Description=LeanAI 精益生产 AI 智能体
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=LEANAI_DATA_DIR=$DATA_DIR_VAR
Environment=LEANAI_HOST=$HOST_BIND
Environment=LEANAI_PORT=$PORT
Environment=LEANAI_NO_OPEN=1
Environment=LEANAI_DOCS_DIR=$INSTALL_DIR/docs
Environment=LEANAI_LICENSE_SECRET=$LICENSE_SECRET
ExecStart=/usr/bin/node $INSTALL_DIR/packages/core/dist/cli/index.js start
Restart=on-failure
RestartSec=5s
# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR_VAR
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lean-ai.service
systemctl restart lean-ai.service

log "等待服务启动..."
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    log "健康检查通过：http://127.0.0.1:$PORT/api/health"
    break
  fi
  sleep 1
done

ip_hint=$(hostname -I 2>/dev/null | awk '{print $1}')
ip_hint="${ip_hint:-<服务器IP>}"
cat <<EOT

================================================================
  ✅ LeanAI 部署完成

  服务地址：  http://${ip_hint}:${PORT}
  数据目录：  $DATA_DIR_VAR
  代码目录：  $INSTALL_DIR
  运行用户：  $SERVICE_USER

  常用命令：
    systemctl status  lean-ai      # 查看运行状态
    systemctl restart lean-ai      # 重启
    journalctl -u lean-ai -f       # 查看实时日志

  升级流程：
    cd $INSTALL_DIR && sudo -u $SERVICE_USER git pull
    sudo -u $SERVICE_USER pnpm install --frozen-lockfile
    sudo -u $SERVICE_USER pnpm --filter @lean-ai/core build
    sudo systemctl restart lean-ai

  下一步：在浏览器打开上面的地址，进入"设置"页填入 LLM API Key。
================================================================
EOT
