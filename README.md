# Arcade

托管经典 Flash 游戏的网站。目前只有 OIDC 登录和一个 Hello World 页面。

## 组成

Go + SQLite（无 CGO），前端（Vite + React + Tailwind）embed 进二进制，OIDC 登录逻辑与 homepage、posts 相同。

## 配置

见 [config.example.yaml](config.example.yaml)。容器挂载两个目录（宿主机上是 `/root/only/selfhost/arcade/config` 和 `/root/only/selfhost/arcade/games`）：

```
config/            → /app/config
├─ config.yaml
├─ games.yaml      # 游戏目录：分区、游戏标题和首页展示顺序，见 games.example.yaml，修改后重启
└─ arcade.db       # 自动创建，位置由 database 决定（相对路径以 config.yaml 所在目录为准）
games/             → /app/games（games_dir）
└─ zmxy-1/         # 目录名是游戏 key，前端按 key 拼图片地址
   ├─ imgs/        # icon、card、poster、background 原图，以及 task images:placeholders 生成的 *.blur.webp
   └─ sources/     # games.yaml 里 swf 指向的游戏文件，以及它自己加载的关卡等文件
```

容器内的 `config.yaml` 应设置 `games_dir: "/app/games"`。前端通过 `GET /api/catalog` 拿到 games.yaml 里的分区和游戏（含磁盘上已有的图片种类），再按 key 请求 `GET /games/<key>/imgs/<name>`；游戏文件走 `GET /games/<key>/sources/<path>`（只放行 swf、xml、图片、mp3 等类型，不能跳出 sources 目录）。这些都需要登录。

游戏由用户浏览器里的 [Ruffle 扩展](https://chromewebstore.google.com/detail/donbcfbmhbcapadipfkeojnmajbakjdc)运行，没装扩展时游戏区域会提示安装。

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
mkdir -p .data && cp config.example.yaml .data/config.yaml   # 设置 dev_user 跳过 OIDC，games_dir 改为 "../games"
cp games.example.yaml .data/games.yaml
task run:server                      # 终端 1，arcade.db 在 .data 下
task run:web                         # 终端 2，打开 http://localhost:5173
```

验证：`task test`（gofmt、go vet、前端类型检查和 Go 测试）。
