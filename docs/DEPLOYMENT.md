# LeanAI 部署指南

> 本文档涵盖 LeanAI 在 **云端 Linux 服务器 / 企业私有化** 环境下的完整部署流程。支持两种部署方式：**Docker Compose（推荐）** 和 **Git 裸机部署（systemd）**。按本文档任一流程操作均可一次成功。

---

## 目录

- [部署前准备](#部署前准备)
- [方式 A：Docker Compose 部署（推荐）](#方式-adocker-compose-部署推荐)
- [方式 B：Git 裸机部署（systemd）](#方式-bgit-裸机部署systemd)
- [反向代理 / HTTPS（Nginx / Caddy）](#反向代理--https-nginx--caddy)
- [升级](#升级)
- [备份与恢复](#备份与恢复)
- [卸载](#卸载)
- [故障排查](#故障排查)
- [环境变量参考](#环境变量参考)

---

## 部署前准备

### 最低硬件要求

| 项目 | 最低 | 推荐（多用户企业私有化） |
| --- | --- | --- |
| CPU | 2 核 | 4 核 |
| 内存 | 2 GB | 4 GB+ |
| 磁盘 | 5 GB | 20 GB+（知识库文档/向量索引会随使用增长） |
| 系统 | Ubuntu 22.04 / Debian 12 / CentOS Stream 9 / RHEL 9 / Rocky 9 | 同左 |

### 网络与端口

- 默认监听 **3741/tcp**，如需公网访问请确保安全组/防火墙放行
- 如需绑定 80/443，请通过 Nginx/Caddy 反向代理（见下文）

### LLM API Key 准备

LeanAI 仅是"壳"，真正对话的大模型由以下任一 Provider 提供，请至少准备其中一个的 Key：

| Provider | 获取地址 |
| --- | --- |
| Claude (Anthropic) | https://console.anthropic.com/settings/keys |
| OpenAI GPT | https://platform.openai.com/api-keys |
| DeepSeek | https://platform.deepseek.com/api_keys |
| 通义千问（阿里云） | https://dashscope.console.aliyun.com/apiKey |
| MiniMax | https://platform.minimaxi.com/user-center/basic-information/interface-key |
| 文心一言（百度云） | https://console.bce.baidu.com/iam/#/iam/accesslist |
| Ollama（本地模型） | 参见 https://ollama.ai/ |

> API Key **不需要**在部署阶段填入，部署完成后进浏览器"设置"页粘贴即可。

---

## 方式 A：Docker Compose 部署（推荐）

最简方式，适合绝大多数场景。要求服务器已安装 **Docker 20.10+** 和 **docker compose 插件（V2）**。

### 1. 安装 Docker（如果还没有）

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sudo bash
sudo systemctl enable --now docker

# 把当前用户加进 docker 组，注销后生效（可选）
sudo usermod -aG docker $USER
```

### 2. 获取源码

```bash
# 方式 1：Git clone（有仓库地址时）
git clone <你的仓库地址> lean-ai
cd lean-ai

# 方式 2：离线环境，把项目目录上传到服务器后 cd 进去
# scp -r PEBS_lean_AI/ user@server:/home/user/lean-ai
# ssh user@server 'cd /home/user/lean-ai'
```

### 3. 配置 .env

```bash
cp .env.example .env

# 必填：生成一个强随机 license 签名密钥
openssl rand -hex 32
# 把输出填到 .env 的 LEANAI_LICENSE_SECRET=
vim .env
```

最小配置示例：
```env
LEANAI_LICENSE_SECRET=1f2e3d4c5b6a79887766554433221100aabbccddeeff00112233445566778899
LEANAI_HOST_PORT=3741
LEANAI_BIND_ADDR=0.0.0.0
TZ=Asia/Shanghai
```

### 4. 构建镜像并启动

```bash
docker compose up -d --build
```

首次构建约需 3–8 分钟（视网络）。后续启动秒级完成。

### 5. 验证

```bash
# 容器状态
docker compose ps

# 应该看到 STATUS 为 Up ... (healthy)
# 健康检查
curl http://127.0.0.1:3741/api/health
# 预期输出: {"status":"ok","version":"1.0.0"}

# 日志
docker compose logs -f lean-ai
```

浏览器访问 `http://<服务器IP>:3741`，进入**设置**填入任一 Provider API Key，即可开始使用。

### 6. 数据持久化

所有运行时数据都保存在 Docker 命名卷 `lean-ai-data`，对应容器内 `/data` 路径，包括：

```
/data/config.json              # 主配置（API Key 等）
/data/lean-ai.db               # SQLite 对话库
/data/vector/                  # LanceDB 向量索引
/data/skills/node_modules/     # 已安装技能
/data/uploads/                 # 用户上传文档
/data/exports/                 # 生成的 Word/PDF 报告
/data/logs/                    # 运行日志
```

> 如需改成挂载主机目录（方便备份），把 `docker-compose.yml` 的 volumes 改为：
> ```yaml
> volumes:
>   - /srv/lean-ai/data:/data
> ```
> 并事先 `sudo chown -R 10001:10001 /srv/lean-ai/data`（镜像中运行用户 UID 固定为 10001）。

---

## 方式 B：Git 裸机部署（systemd）

适合不想用 Docker 的场景，直接把 Node 进程跑在系统 systemd 下。

### 1. 上传源码到服务器

```bash
# 方式 1：git clone
ssh user@server
git clone <你的仓库地址> /tmp/lean-ai-src
cd /tmp/lean-ai-src

# 方式 2：从本地 rsync
rsync -avz --exclude=node_modules --exclude=dist --exclude='.git' \
    ./ user@server:/tmp/lean-ai-src/
ssh user@server "cd /tmp/lean-ai-src"
```

### 2. 执行一键部署脚本

```bash
sudo bash scripts/deploy.sh
```

脚本会自动完成：

1. 安装 Node.js 20、pnpm、编译依赖
2. 创建系统用户 `leanai`
3. 将代码复制到 `/opt/lean-ai/`
4. 安装 npm 依赖并构建前后端
5. 将内置技能预装到 `/var/lib/lean-ai/skills/node_modules/`
6. 生成 license 签名密钥并保存到 `/var/lib/lean-ai/.license_secret`
7. 安装并启动 `lean-ai.service`（开机自启）

完成后输出类似：

```
================================================================
  ✅ LeanAI 部署完成
  服务地址：  http://<服务器IP>:3741
  数据目录：  /var/lib/lean-ai
  代码目录：  /opt/lean-ai
  运行用户：  leanai
================================================================
```

### 3. 自定义路径或端口（可选）

在执行脚本前 export 覆盖默认值：

```bash
export LEANAI_INSTALL_DIR=/srv/lean-ai
export LEANAI_DATA_DIR=/srv/lean-ai-data
export LEANAI_PORT=8080
sudo -E bash scripts/deploy.sh
```

### 4. 服务管理

```bash
systemctl status  lean-ai        # 状态
systemctl restart lean-ai        # 重启
systemctl stop    lean-ai        # 停止
systemctl disable lean-ai        # 禁用开机自启
journalctl -u lean-ai -f         # 实时日志
journalctl -u lean-ai --since "1 hour ago"
```

---

## 反向代理 / HTTPS（Nginx / Caddy）

生产环境强烈建议在前面套一层反向代理做 HTTPS。

### Caddy（最简，自动签 Let's Encrypt）

`/etc/caddy/Caddyfile`：

```caddy
leanai.example.com {
    reverse_proxy 127.0.0.1:3741 {
        # SSE 流式对话需要这两个
        flush_interval -1
        transport http {
            read_timeout 300s
        }
    }
}
```

然后 `sudo systemctl reload caddy`。别忘了把 `LEANAI_CORS_ORIGIN=https://leanai.example.com` 加到部署环境变量里（Docker 在 `.env`，裸机在 systemd unit 的 Environment=）。

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name leanai.example.com;

    ssl_certificate     /etc/letsencrypt/live/leanai.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leanai.example.com/privkey.pem;

    # SSE 关键参数
    proxy_read_timeout 300s;
    proxy_buffering off;
    proxy_cache off;

    client_max_body_size 100m;  # 允许上传大文件到知识库

    location / {
        proxy_pass http://127.0.0.1:3741;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }
}
```

### 防火墙示例（UFW）

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
# 只走反向代理的话，3741 不用对外暴露
sudo ufw deny 3741/tcp
```

---

## 升级

### Docker 模式

```bash
cd lean-ai
git pull
docker compose up -d --build
# 如需跟随新镜像升级内置技能，可手动删除旧技能目录让 entrypoint 重新 seed：
# docker compose exec lean-ai rm -rf /data/skills/node_modules/@lean-ai
# docker compose restart lean-ai
```

### 裸机 systemd 模式

```bash
cd /opt/lean-ai
sudo -u leanai git pull                             # 如果用 git 部署
sudo -u leanai pnpm install --frozen-lockfile
sudo -u leanai pnpm --filter @lean-ai/core build
sudo systemctl restart lean-ai
```

---

## 备份与恢复

### 备份要点

唯一需要备份的是**数据目录**：Docker 的 `lean-ai-data` 卷或裸机的 `/var/lib/lean-ai/`。代码可通过 `git pull` 或重新执行 `deploy.sh` 重建。

```bash
# Docker：把卷导出到 tar 包
docker run --rm -v lean-ai-data:/data -v $(pwd):/backup alpine \
    tar czf /backup/lean-ai-backup-$(date +%F).tar.gz -C /data .

# 裸机
sudo tar czf lean-ai-backup-$(date +%F).tar.gz -C /var/lib/lean-ai .
```

建议每天做一次增量备份，保留 7–30 天。

### 恢复

```bash
# Docker
docker compose down
docker run --rm -v lean-ai-data:/data -v $(pwd):/backup alpine \
    sh -c 'cd /data && tar xzf /backup/lean-ai-backup-XXXX.tar.gz'
docker compose up -d

# 裸机
sudo systemctl stop lean-ai
sudo tar xzf lean-ai-backup-XXXX.tar.gz -C /var/lib/lean-ai
sudo chown -R leanai:leanai /var/lib/lean-ai
sudo systemctl start lean-ai
```

---

## 卸载

### Docker

```bash
docker compose down                       # 停服并删容器（保留数据卷）
docker compose down -v                    # 连数据卷一起删除（谨慎）
docker rmi lean-ai:latest
```

### 裸机

```bash
sudo systemctl disable --now lean-ai
sudo rm /etc/systemd/system/lean-ai.service
sudo systemctl daemon-reload
sudo rm -rf /opt/lean-ai
# 数据目录如不再需要：
sudo rm -rf /var/lib/lean-ai
sudo userdel leanai
```

---

## 故障排查

| 症状 | 排查步骤 |
| --- | --- |
| `docker compose up` 构建卡在 `better-sqlite3` | 构建机器内存不足，增加 swap 或用更大规格的 VM 重新构建 |
| 容器一直 `unhealthy` | `docker compose logs lean-ai` 查具体报错；通常是 `LEANAI_LICENSE_SECRET` 未设置 |
| 浏览器打不开 | 确认 `curl http://127.0.0.1:3741/api/health` 本机能通 → 再查防火墙/安全组 |
| 页面 500 / 登录无响应 | 查日志：`docker compose logs -f` 或 `journalctl -u lean-ai -f` |
| 对话流式输出卡顿 | 反向代理没关 buffering（见 Nginx 配置的 `proxy_buffering off`） |
| `EADDRINUSE 3741` | 端口被占：`LEANAI_HOST_PORT=3742` 重启，或查 `lsof -i:3741` 释放占用者 |
| better-sqlite3 报错 `Could not locate the bindings file` | 重建：`pnpm rebuild better-sqlite3`（裸机）或 `docker compose build --no-cache`（Docker） |
| 知识库上传后搜不到 | 等待 `journalctl -u lean-ai` 里出现 `ingest ok`；向量化首次会下载嵌入模型（约 100MB） |
| 诊断/图表/报告技能没有出现在侧边栏 | 裸机：检查 `/var/lib/lean-ai/skills/node_modules/@lean-ai/` 是否有 4 个子目录；Docker：`docker compose exec lean-ai ls /data/skills/node_modules/@lean-ai/` |

---

## 环境变量参考

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LEANAI_DATA_DIR` | `~/.lean-ai`（容器内 `/data`） | 数据根目录：config / DB / 向量 / 技能 / 上传 |
| `LEANAI_HOST` | `127.0.0.1`（容器内 `0.0.0.0`） | 监听地址 |
| `LEANAI_PORT` | `3741` | 监听端口 |
| `LEANAI_NO_OPEN` | 未设置 | 置任意非空值禁用自动打开浏览器（容器/服务器必填） |
| `LEANAI_CORS_ORIGIN` | 同源 | 反向代理后的前端域名白名单，多个用英文逗号分隔，`*` 表示全开放（仅内网可用） |
| `LEANAI_LICENSE_SECRET` | 无 | 订阅/激活码签名密钥，**生产必填**；建议 `openssl rand -hex 32` |
| `TZ` | `UTC` | 容器时区（推荐 `Asia/Shanghai`） |

---

## 多用户 / 多实例提示

LeanAI 默认是**单实例单用户**架构（数据在 SQLite + 本地向量库）。如果你要在企业内部给多个团队用，有两条路径：

1. **每个团队一个实例**：用 docker-compose 多开（每份独立 `LEANAI_DATA_DIR` 和端口），前面用 Caddy/Nginx 按子域名路由——最简单。
2. **共享单实例**：目前多用户隔离尚未内置，请通过反向代理的 basic auth / OAuth 代理（如 `oauth2-proxy`）锁定访问范围。

后续版本会增加原生多租户支持。
