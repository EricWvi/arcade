# Cloudflare 部署

公开给别人玩的版本跑在 Cloudflare，和 homelab 并行，数据互不相通，游戏列表也可以不同。

| | homelab | Cloudflare |
|---|---|---|
| 后端 | Go 二进制（`cmd/arcade`） | Worker（`worker/`，TypeScript） |
| 前端 | embed 进二进制 | Static Assets，同一份 `frontend/dist` |
| 登录 | Authelia（OIDC） | GitHub（OAuth app） |
| 数据库 | SQLite 文件 | D1 `arcade`，schema 同 `internal/store/migrate.go` |
| 游戏文件 | 挂载的 games 目录 | R2 bucket `arcade-games` |
| 游戏目录 | 每次请求读 games.yaml 和磁盘 | 发布时 `arcade catalog build` 算好的 `catalog.json` |
| 站点地址 | config.yaml 的 `public_url` | `4399.onlyquant.top`（wrangler.jsonc 的 routes），代码里用请求本身的 origin |

HTTP API 两边一致，前端不区分。一致性由契约测试保证：`worker/contract/api.ts` 同一套用例分别跑 Go 服务和 Worker（`task test:contract`），只有登录不在契约里。

## 部署

打 `v*` tag 时，[release.yml](../.github/workflows/release.yml) 的 `worker` job 和 homelab 镜像一起发布：跑 Worker 测试（含契约）、构建前端、D1 和 R2 不存在就创建、执行 `worker/migrations/` 里的迁移、部署并写入 secrets。自定义域名 `4399.onlyquant.top` 随部署绑定，workers.dev 和预览地址都关闭。wrangler.jsonc 只按名字引用 D1 和 R2，不需要填 id。

首次发布前在网页上准备：

1. GitHub OAuth app（Settings → Developer settings → OAuth Apps），callback URL 填 `https://4399.onlyquant.top/auth/callback`。
2. Cloudflare API token（My Profile → API Tokens → Create Token），权限：
   - Account：Workers Scripts、D1、Workers R2 Storage，均为 Edit
   - Zone `onlyquant.top`：Workers Routes Edit（绑定自定义域名）
3. GitHub 仓库 Settings → Secrets and variables → Actions 添加：

   | Secret | 内容 |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | 第 2 步的 token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 面板 Workers 页面右侧的 Account ID |
   | `OAUTH_CLIENT_ID` | OAuth app 的 Client ID |
   | `OAUTH_CLIENT_SECRET` | OAuth app 生成的 client secret |

   GitHub 不允许 secret 名以 `GITHUB_` 开头，所以叫 `OAUTH_*`，部署时写成 Worker 的 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。

本地手动部署（需要 `npx wrangler login`，secrets 用 `npx wrangler secret put` 设置）：`task deploy:worker`。

## 发布游戏

在 homelab 上用一次性容器完成，不需要仓库。Cloudflare 自己的 games.yaml 放在 `/root/only/selfhost/arcade/cf/games.yaml`，只上架其中 shelves 列出的游戏，游戏文件直接读 homelab 已有的 games 目录。

R2 的 S3 凭据在 Cloudflare 面板 R2 → Manage API tokens 创建（Object Read & Write，限定 `arcade-games`），写进 `/root/only/selfhost/arcade/cf/rclone.env`：

```bash
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_ACCESS_KEY_ID=...
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=...
RCLONE_S3_NO_CHECK_BUCKET=true
```

每次发布三步：

```bash
cf=/root/only/selfhost/arcade/cf
games=/root/only/selfhost/arcade/games

# 1. 校验 games.yaml，生成 catalog.json 和上传清单 files.txt
docker run --rm --entrypoint /app/arcade -v $games:/app/games:ro -v $cf:/cf \
  ghcr.io/<owner>/arcade:<tag> catalog build -catalog /cf/games.yaml -out /cf/dist

# 2. 上传游戏文件，没变的会跳过
docker run --rm --env-file $cf/rclone.env -v $games:/games:ro -v $cf/dist:/dist:ro \
  rclone/rclone:1.75.1 copy /games r2:arcade-games --files-from /dist/files.txt

# 3. 最后上传 catalog.json，保证它引用的文件都已就位
docker run --rm --env-file $cf/rclone.env -v $cf/dist:/dist:ro \
  rclone/rclone:1.75.1 copyto /dist/catalog.json r2:arcade-games/catalog.json
```

Worker 每分钟检查一次 `catalog.json` 是否变化，不需要重新部署。下架的游戏文件不会从 R2 删除，但不在 catalog.json 里的游戏无法打开、存档和记录游玩。

## 本地开发

```bash
task install:worker
echo 'DEV_USER=eric' > worker/.dev.vars          # 跳过 GitHub 登录
task build:frontend                              # Static Assets 读 frontend/dist
task run:worker                                  # http://localhost:8787，本地 D1/R2 在 worker/.wrangler
```

往本地 R2 放文件：`npx wrangler r2 object put arcade-games/<路径> --file <文件> --local`（在 `worker/` 下执行）。要改前端时，`ARCADE_BACKEND=http://localhost:8787 task run:web` 让 Vite 把 API 代理到 Worker。

测试：`task test:worker`，在 workerd 里跑真实的 D1 和 R2，GitHub 接口用 mock。
