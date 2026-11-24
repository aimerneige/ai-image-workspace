# AI Image Workspace · AI 图片工作台

一个自托管的图片模型工作台，针对 **ChatGPT Image（OpenAI `gpt-image` 系列）** 和 **Nano Banana Pro（Google `gemini-3-pro-image`）** 做了专门优化。

- 后端：Go + Gin + GORM，单个二进制文件，内嵌前端
- 前端：Vite + React + TypeScript，所有控件均为自研组件（没有原生下拉框，也没有 `alert` / `confirm`）
- 数据库：默认 SQLite（纯 Go 驱动，无需 cgo），改配置即可切换到 MySQL 或 PostgreSQL

## 功能

**生图与编辑**

- 参数面板会根据所选模型自动切换：
  - **GPT Image 2 / ChatGPT Image**：按「比例 + 1K/2K/4K 档位」或「自定义宽高」出图。尺寸自动满足 16 的倍数、1:3–3:1、0.66–8.3 MP、最长边 3840 等限制。另有质量、透明背景、输出格式 / 压缩率、审核强度可调；`gpt-image-1.5` 额外支持输入保真度。
  - **Nano Banana Pro / Nano Banana 2**：支持 10+ 种画面比例、1K/2K/4K 分辨率和 Google 搜索增强。模型思考过程中产生的中间图会被过滤；模型返回的文字也会一并展示。
- 参考图：可拖入、在页面任意位置粘贴，或点击添加（GPT 最多 16 张，Nano Banana Pro 最多 14 张）。生成结果可以一键「用作参考图」接着改，不必重复上传。
- 任务异步执行：可以同时跑多个任务，每个任务带实时计时，并且可以随时取消。切换页面不影响任务，完成后会弹出通知。
- 结果查看：大图预览支持滚轮缩放、拖拽平移、方向键切换，可复制图片、下载，或「复用参数」「再来一次」。

**历史与审计**

- 所有请求都写入数据库：提示词、参数、上游请求（图片数据已剥离）、上游响应元数据（用量、模型版本、finish reason 等）、错误信息、耗时、输入图与输出图。
- 历史记录支持搜索、按状态 / 服务商筛选、收藏和无限滚动。详情面板可以查看完整的请求 / 响应 JSON。
- 所有操作都会写入审计日志：登录（含失败）、注册、生成、取消、删除、服务商和用户的变更等。管理员能看到全部日志，普通用户可以在「账户」页查看自己的记录。

**账户与安全**

- 必须登录才能使用。会话 Cookie 为 HttpOnly + SameSite=Lax，数据库里只保存令牌的 SHA-256；所有写请求都要求带自定义请求头，以防 CSRF。登录和注册接口有限流。
- 配置文件里可以关闭注册（`auth.allow_registration: false`），此时只有管理员能创建账户。第一个注册的用户自动成为管理员，也可以通过配置预置管理员。
- **API Key 只存在服务器上**：在数据库中用 AES-256-GCM 加密保存，前端只能看到掩码（`sk-…1234`），上游请求全部由服务器发出。
- 不能禁用、降级或删除最后一个可用的管理员。

**界面**

- 亮色 / 暗色 / 跟随系统三种主题，切换时有从按钮位置扩散开的圆形过渡动画（View Transitions API）。
- 内置中文、日文、英文三种语言，并预留了扩展能力（见下文）。
- 按钮按下时有弹性缩放和涟漪效果，开关、分段控件、标签页的指示器都带弹簧动画。尊重系统的「减少动态效果」设置。
- 支持完整的键盘操作：`Ctrl/⌘ + Enter` 生成；下拉框支持方向键和首字母跳转；对话框会锁定焦点，按 `Esc` 关闭。
- 移动端适配：底部固定生成按钮，对话框改为底部弹出。
- 页面右上角有 GitHub 图标，指向本仓库。

## 快速开始

### Docker Compose（PostgreSQL）

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env      # 修改其中所有 CHANGE_ME
docker compose up -d --build
```

打开 <http://localhost:8080>，用 `.env` 里的 `AIW_ADMIN_USERNAME` / `AIW_ADMIN_PASSWORD` 登录，然后在 **管理 → 服务商** 中添加 OpenAI 或 Gemini 的 API Key。

> 单容器 + SQLite：`docker run -p 8080:8080 -v aiw:/data -e AIW_SECRET_KEY=... ai-image-workspace`

### 本地运行

依赖 Go 1.26+ 和 Node 20+。

```bash
make web            # 构建前端，输出到 internal/webui/dist（会被嵌入二进制）
make build          # 生成 bin/aiw
cp config.example.yaml config.yaml
./bin/aiw           # 默认使用 SQLite，数据写入 ./data
```

### 没有 API Key 时体验

```bash
make mock           # 在 :9090 启动一个模拟的 OpenAI + Gemini 上游，会返回生成的渐变图
```

在管理页添加服务商时，Base URL 分别填 `http://localhost:9090/v1`（OpenAI）和 `http://localhost:9090`（Gemini），API Key 随便填。提示词里包含 `fail` 时会模拟上游报错。

## 配置

完整的带注释示例见 [`config.example.yaml`](config.example.yaml)。读取顺序：`-config` 参数 → `$AIW_CONFIG` → `./config.yaml`；文件不存在时使用默认值。配置文件中可以用 `${VAR}` 引用环境变量。

| 配置项 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `server.addr` | `AIW_ADDR` | `:8080` | 监听地址 |
| `database.driver` | `AIW_DB_DRIVER` | `sqlite` | `sqlite` / `mysql` / `postgres` |
| `database.dsn` | `AIW_DB_DSN` | `data/app.db` | 连接串（MySQL 会自动补 `parseTime=true`） |
| `auth.allow_registration` | `AIW_ALLOW_REGISTRATION` | `true` | 是否允许注册 |
| `auth.admin.*` | `AIW_ADMIN_USERNAME` / `AIW_ADMIN_PASSWORD` | 空 | 数据库中没有用户时创建的初始管理员 |
| `auth.cookie_secure` | `AIW_COOKIE_SECURE` | `false` | 启用 HTTPS 后请设为 `true` |
| `storage.dir` | `AIW_STORAGE_DIR` | `data` | 图片文件和 `secret.key` 的存放目录 |
| `security.secret_key` | `AIW_SECRET_KEY` | 自动生成 | 用于加密 API Key 的主密钥 |
| `generation.timeout` | — | `6m` | 单次上游请求的超时时间 |
| `providers` | — | `[]` | 通过配置文件声明的服务商，在界面中只读 |

**服务商**：可以在管理界面添加（加密保存到数据库），也可以写在配置文件的 `providers` 中（每次启动时同步，界面里只读）。两种方式都支持自定义 Base URL，所以 OpenAI 兼容的中转服务也能用。OpenAI 类型如果只填了域名（例如 `https://api.302.ai`），会自动补上 `/v1`。「测试连接」会先请求 `GET /models`；中转服务往往没有这个接口，这时会改发一个不带提示词的生成请求来验证地址和 Key。这个请求会被上游直接拒绝，不会生成图片，也不会计费。Gemini 类型在使用非 Google 官方地址时，会同时通过 `x-goog-api-key` 和 `Authorization: Bearer` 两个请求头发送 Key，以兼容 302.AI 这类中转服务。以 302.AI 为例，Base URL 填 `https://api.302.ai/google/v1`，模型 ID 填 `gemini-3-pro-image-preview`。

**命令行工具**（例如注册已关闭、又忘记了管理员密码时）：

```bash
aiw user create <用户名> <密码> admin
aiw user passwd <用户名> <新密码>
```

## 开发

```bash
make mock       # 终端 1：模拟上游（可选）
make dev-api    # 终端 2：后端 :8080
make dev-web    # 终端 3：Vite 开发服务器 :5173，/api 会代理到 :8080
make test       # Go 测试 + 前端类型检查
```

### 目录结构

```
cmd/server            服务入口与 CLI
cmd/mock-upstream     模拟 OpenAI / Gemini 的开发工具
internal/config       YAML + 环境变量配置
internal/database     GORM 连接（sqlite / mysql / postgres）与迁移
internal/model        数据模型
internal/provider     上游适配器：openai.go（ChatGPT Image），gemini.go（Nano Banana）
internal/service      业务逻辑：用户与会话、服务商、生成任务调度、审计
internal/storage      图片存储与缩略图
internal/secret       API Key 加密
internal/api          Gin 路由、中间件、SPA 托管
internal/webui        go:embed 嵌入的前端产物
web/                  React 前端
  src/components/ui   自研组件库（Select、Menu、Dialog、Toast、Segmented、Slider……）
  src/lib/models.ts   模型能力表与尺寸计算（新增模型从这里开始）
  src/i18n            国际化
```

### 新增界面语言

在 `web/src/i18n/locales/` 下新建文件（例如 `ko.ts`），它会通过 `import.meta.glob` 自动注册：

```ts
import type { LocaleModule } from '../types'

const locale: LocaleModule = {
  meta: { code: 'ko', name: '한국어', match: ['ko'] },
  messages: { nav: { workspace: '작업 공간' } /* … */ },
}
export default locale
```

`messages` 可以只翻译一部分，缺失的键会回退到英文。如果把类型标注为 `Messages`（参考 `zh-CN.ts`），TypeScript 会强制要求翻译完整。日期、相对时间和数字格式会自动使用对应语言的 `Intl` 格式。

### 新增模型

1. 在 `web/src/lib/models.ts` 的 `LABELS` 中加上显示名，并在 `capabilities()` 里声明该模型支持的参数。
2. 如果上游有新的参数校验规则，在 `internal/provider/openai.go` 或 `gemini.go` 中补上。
3. 模型 ID 本身在管理界面中按服务商配置，不需要改代码。

### API 概览

所有接口都在 `/api` 下，使用 Cookie 会话鉴权；写请求需要带 `X-Requested-With` 请求头。错误统一返回 `{"error":{"code","message"}}`，其中 `code` 由前端翻译成对应语言。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/auth/login` · `/auth/register` · `/auth/logout` | 登录 / 注册 / 退出 |
| `GET` | `/providers` | 当前可用的服务商与模型 |
| `POST` | `/generations` | 发起生成：JSON，或 multipart（`payload` 字段 + 多个 `images` 文件） |
| `GET` | `/generations` · `/generations/:id` | 历史列表（支持筛选）/ 详情（含上游请求与响应） |
| `POST` | `/generations/:id/cancel` | 取消正在运行的任务 |
| `PATCH` / `DELETE` | `/generations/:id` | 收藏 / 删除 |
| `GET` | `/images/:id[?variant=thumb][&download=1]` | 获取图片（仅限本人或管理员） |
| — | `/admin/providers` · `/admin/users` · `/admin/audit-logs` | 管理接口 |

## 许可

MIT
