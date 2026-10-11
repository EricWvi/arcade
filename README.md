# Arcade

托管经典 Flash 游戏的网站。目前只有 OIDC 登录和一个 Hello World 页面。

## 组成

Go + SQLite（无 CGO），前端（Vite + React + Tailwind）embed 进二进制，OIDC 登录逻辑与 homepage、posts 相同。

## 配置

见 [config.example.yaml](config.example.yaml)。容器挂载一个目录（宿主机上是 `/root/only/selfhost/arcade/config`）：

```
config/            → /app/config
├─ config.yaml
└─ arcade.db       # 自动创建，位置由 database 决定（相对路径以 config.yaml 所在目录为准）
```

OIDC client secret 建议用环境变量 `ARCADE_OIDC_CLIENT_SECRET`。在 Authelia 注册回调地址 `<public_url>/auth/callback`。

## 部署

镜像由 GitHub Actions 在打 `v*` tag 时构建并推送到 GHCR（[release.yml](.github/workflows/release.yml)），不在本地构建。

compose 服务定义在 dotfiles 仓库的 `selfhost/only/docker-compose.yaml`（服务名 `arcade`），`ARCADE_OIDC_CLIENT_SECRET` 和其他 secrets 一样由 compose 环境变量提供。

```bash
mkdir -p /root/only/selfhost/arcade/config
cp config.example.yaml /root/only/selfhost/arcade/config/config.yaml   # 修改 public_url、oidc
chown -R 65532:65532 /root/only/selfhost/arcade/config                 # distroless nonroot
cd /root/dotfiles/selfhost/only && docker compose up -d arcade
```

Caddy 把 arcade 的域名反代到 `arcade:36753`；arcade 自己做 OIDC 登录，不加 `forward_auth`。

## 本地开发

```bash
task install:frontend
mkdir -p .data && cp config.example.yaml .data/config.yaml   # 设置 dev_user 跳过 OIDC
task run:server                      # 终端 1，arcade.db 在 .data 下
task run:web                         # 终端 2，打开 http://localhost:5173
```

验证：`task test`（gofmt、go vet、前端类型检查和 Go 测试）。
