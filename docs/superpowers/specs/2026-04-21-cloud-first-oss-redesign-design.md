# clawdi-cloud：云端优先、开源可自托管的改造设计

**日期**：2026-04-21
**作者**：Kingsley × Claude × Codex（双轨分析合并）
**状态**：设计提案，待评审

---

## 0. 摘要

把 `clawdi-cloud` 演进成**开源可自托管的 agent 上下文中枢**，逐步取代老 `clawdi` 平台。核心产品不变（sessions / skills / memory / vault 集中管理），但在边界和能力上做四处关键变化：

1. **砍掉部署编排**——OSS 不管 agent 部署，用户自己处理 agent 在哪跑、怎么跑；agent 镜像、Phala/k3s 调度、多租户计费都归**另起的 clawdi SaaS 层**。
2. **引入 Scope（共享Scope）概念**——不再假设"一个用户所有 agent 都共享全部资源"；且 **scope 可跨用户共享**（朋友 / 团队协作），skill 和 memory 在共享 scope 里可被多人编辑和检索；session 和 vault 在 MVP 阶段严格保持用户私有，即便位于共享 scope 也不跨 user。
3. **Session 跨 agent 检索（RAG 方式）**——Session 只做单向上传（agent → cloud），不跨 agent 下发。跨 agent 的上下文延续通过对 session 内容建索引 + MCP `session_search` 工具按需检索实现，复用 memory 的混合检索基础设施。
4. **Auth 去 Clerk 化**——改为可替换的 `AuthProvider`，内置 Basic（邮箱密码 + SMTP magic link）作为 OSS 默认，Clerk/OIDC 降级为可选插件。

实施分 4 个 phase，约 6-9 个月，不做大爆炸切换。

---

## 1. 产品边界

### 1.1 clawdi-cloud OSS 做什么

| 模块 | 内容 |
|---|---|
| **后端** | FastAPI + PostgreSQL（pgvector + pg_trgm），REST + WebSocket/SSE |
| **Dashboard** | Next.js 15，查看 sessions / memory / skills / vault / settings / environments |
| **CLI** | `clawdi` 所有命令（login / setup / sync / vault / memory / skills / run / daemon…） |
| **MCP 服务器** | stdio 协议，`memory_search` / `memory_add` / `memory_extract` / `session_search` + Composio 代理 |
| **Adapter** | Claude Code / Codex / OpenClaw / Hermes 四个一等公民（本地安装版） |
| **Auth** | Pluggable：`BasicAuthProvider`（默认）+ Clerk / OIDC（可选） |
| **存储** | File store 抽象，默认本地文件系统，可选 S3 / R2 |
| **Memory** | `BuiltinProvider`（pgvector 混合检索）默认，`Mem0Provider` 可选 |
| **打包** | `docker-compose.yml` 一键启动 |
| **迁移** | 老 clawdi → clawdi-cloud 的双边 export/import 工具 |

### 1.2 clawdi-cloud OSS 明确不做

- ❌ 构建或托管 `clawdi-agent` 镜像
- ❌ k8s client / Docker SDK / 容器调度
- ❌ Phala CVM / k3s 集成
- ❌ 多租户隔离（一个实例服务多客户）
- ❌ 计费 / 配额 / 使用量统计
- ❌ "从 Dashboard 帮用户部署 agent"类操作

**自托管用户如何跑 agent**：用户自己的事——本地 Claude Code、自己的 VPS 上 Hermes、自己拉的 OpenClaw 镜像——随便。clawdi-cloud 只关心 agent 启动之后能通过 CLI/daemon 和后端 API 对接。

### 1.3 clawdi SaaS 做什么（独立仓库，不入 OSS 主库）

- `clawdi-agent` Docker 镜像（OpenClaw + Hermes + supervisor + `clawdi daemon`）
- Phala CVM / k3s 部署与生命周期
- 多租户后端（自己的数据库 + 鉴权 + 计费）
- SaaS 后端作为 **clawdi-cloud OSS API 的消费方**，不是内嵌模块
- 可选 SaaS 独享功能（未来）：skill 版本控制、团队 skill 分享、MCP 连接器市场、托管的 memory provider

### 1.4 OSS → SaaS 扩展点

OSS 后端通过以下方式支撑 SaaS，无需 SaaS 代码入 OSS 主干：

| 扩展点 | 作用 |
|---|---|
| **Environment claim API** | `POST /api/environments/claim?token=...` 让容器用一次性 token 注册成某 user 的 AgentEnvironment |
| **Webhook / Event stream** | Outbound 事件（`environment.claimed` / `skill.updated` / `vault.updated` / `session.uploaded`），SaaS 订阅做计费、审计、多租户路由 |
| **Usage counters** | `/api/usage` 提供 session / memory / token 计数，SaaS 读取做计费 |
| **Settings JSONB** | `/api/settings` 用户设置任意可扩展字段（SaaS 可写入 `billing_tier` 等） |

SaaS 需要但 OSS 不提供的——**token 签发、pod 模板、k8s apply、镜像推送、计费流水线**——全部在 SaaS 独立仓库里做。

---

## 2. 目标架构

### 2.1 三层划分

```
┌─────────────────────────────────────────────────────────────┐
│ Presentation                                                │
│   OSS:  Next.js Dashboard + clawdi CLI                      │
│   SaaS: 自家管理 UI / fleet 管理 / billing UI               │
├─────────────────────────────────────────────────────────────┤
│ Control Plane                                               │
│   OSS:  FastAPI + Postgres + File Store + AuthProvider      │
│          REST + WebSocket/SSE（sync event）                  │
│   SaaS: Deployer / Token Issuer / Billing / Fleet Registry  │
│         作为 OSS API 的消费方                                │
├─────────────────────────────────────────────────────────────┤
│ Agent Runtime                                               │
│   OSS-兼容: Claude Code / Codex / OpenClaw / Hermes         │
│            + clawdi daemon（长连 / 实时同步）                │
│   SaaS-托管: clawdi-agent 容器（内含 daemon + supervisor）   │
└─────────────────────────────────────────────────────────────┘
```

**边界原则**：

- 后端永远不 import 任何 agent 的具体代码（OpenClaw / Hermes 类型仅存在于 CLI adapter 里）。
- CLI（含 daemon）是**唯一的 agent 客户端实现**，本地 brew 装的和 SaaS 镜像里装的是同一份二进制。
- SaaS 所有扩展行为通过"订阅 webhook + 消费 API"实现，不往 OSS repo 加 hook。

### 2.2 扩展点矩阵

| OSS 提供 | SaaS 典型用法 | 落在代码里 |
|---|---|---|
| `Environment.claim` API | SaaS 启动容器，发一次性 token，容器换取环境凭证 | 新增 `backend/app/routes/environments.py:claim` |
| Webhook outbound | SaaS 订阅 `environment.claimed` 触发计费开始 | 新增 `backend/app/services/webhooks.py` |
| `/api/usage` | SaaS 定时拉 usage 对每用户计费 | 新增 `backend/app/routes/usage.py` |
| File store abstraction | SaaS 注入 S3 凭证，用自己的 bucket | 现有 `backend/app/services/file_store.py` |
| AuthProvider abstraction | SaaS 实现自家 `OidcProvider`，与自有 IdP 对接 | 新增 `backend/app/core/auth_provider.py` |

---

## 3. Scope——资源容器与共享范围

### 3.1 动机

两类需求推动把 "scope" 从字符串标签升级为一等实体：

**(a) 单用户的上下文隔离**
- 同一个人，"工作"和"个人"的 skill 不同；
- 同一个人，家里和公司 Claude Code 不一定要用同一套 vault；
- "客户 X 的约定"不该泄漏到"个人项目" agent 的 memory 里。

**(b) 跨用户的共享（新增）**
- "我调 OAuth 整理了一套 skill 和 memory，**想分享给朋友让他 agent 也能用**"
- "一个团队**共同维护**一组 skill / memory，每个人的 agent 都能看到并贡献"

(a) 只用字符串标签能解决；(b) 需要所有者、成员、权限——必须是实体。

### 3.2 核心概念

引入 **Scope** 作为一等实体。旧设计里"scope 字符串标签"消失，资源直接关联 scope。

```
Scope
  id, name, owner_user_id, visibility (private | shared), created_at

ScopeMembership
  scope_id, user_id, role (owner | writer | reader)

Skill              → scope_id (nullable, NULL = 用户私有)
Memory             → scope_id (nullable) + author_user_id
Session            → scope_id (nullable，默认继承创建 env)
Vault              → scope_id (nullable)
AgentEnvironment   → scope_ids (list，可订阅多个 scope)
```

**资源单归属** vs 多归属的取舍：MVP 选**单归属**——一份 skill 只属于一个 scope。要放进第二个 scope 就 CLI 复制。理由：语义明确、删除/撤销权限边界清晰、避免 many-to-many 复杂度。

**Environment 侧是列表**——一台机器可订阅多个 scope（"我的工作 + 个人 scope 都想看"）。

### 3.3 角色（3 级）

| 角色 | 权限 |
|---|---|
| `owner` | 资源 CRUD + 邀请 / 踢人 / 改 scope 元数据 / 删 scope |
| `writer` | 资源 CRUD，不能改成员 |
| `reader` | 只读 |

- 为什么不是 2 级：满足不了"只读分享给朋友"场景
- 为什么不是 4 级（加 admin）：MVP 用不上；未来加 role 字符串即可，不改表

### 3.4 可分享的资源矩阵（MVP）

| 资源 | 可跨 user 访问 | 说明 |
|---|---|---|
| **Skill** | ✅ | 团队 skill 库，核心用例 |
| **Memory** | ✅ | 团队事实库，新增 `author_user_id` 做追溯 |
| **Session metadata** | ❌ | 即使 session 在共享 scope，非 owner 不可见 |
| **Session chunks（检索）** | ❌ **严格** | `session_search` 始终加 `session.user_id = caller` 过滤。原始 transcript 可能含密钥、内部代码、敏感对话，MVP 宁可保守 |
| **Vault** | ❌ **MVP 禁止** | 团队共享密钥需要 MFA / 审批 / 单次审计等配套；当前 `/api/vault/resolve` 整批吐明文风险过大，推迟到 V2 |
| **Setting** | ❌ | 个人偏好 |
| **AgentEnvironment** | ❌ | agent 实例归属单 user |

**V2 候选**：Session 逐条 opt-in 分享、Vault 加 per-secret 授权 + MFA + audit log。

### 3.5 可见 / 同步规则

资源 `R` 对环境 `E` 可同步，当且仅当：

```
[私有资源]
  R.scope_id IS NULL  AND  R.owner_user_id = E.owner_user_id
或
[共享资源]
  R.scope_id ∈ E.scope_ids
  AND  E.owner_user_id 是 R.scope 的 member
  AND  （若 R 是 session chunk: R.session.user_id = E.owner_user_id）
```

即：**私有资源只同步给自己；scope 资源同步给成员的订阅 env；session chunks 永不跨 user，即使在共享 scope 里**。

### 3.6 邀请 / 接受流

```bash
# Owner 发邀请
clawdi scope invite alice@example.com \
  --scope oauth-tips --role writer
# → 后端生成单次 token（48h 过期）
# → SMTP 发链接给 alice（用 BasicAuthProvider 的 SMTP 配置）

# 受邀者接受（两条路径）

# 路径 1: Dashboard
#   点邮件链接 → 若未登录引导登录/注册 → "待处理邀请"页接受

# 路径 2: CLI
clawdi scope accept <token>
# 前置：本地已登录账号的邮箱必须与邀请邮箱一致
# 若不一致：CLI 显式报错，绝不静默绑错账号
# 若一致：POST /api/scopes/{id}/accept
# 后端：校验 token（未过期、未用、邮箱匹配）+ 加 membership
```

**Dashboard**：两个视图——「我发出的邀请」（owner）+「我收到的邀请」（受邀者）。

### 3.7 数据模型

```sql
CREATE TABLE scopes (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id),
    visibility TEXT NOT NULL DEFAULT 'private',   -- private | shared
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE scope_memberships (
    scope_id UUID REFERENCES scopes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'writer', 'reader')),
    added_at TIMESTAMP DEFAULT NOW(),
    added_by_user_id UUID REFERENCES users(id),
    PRIMARY KEY (scope_id, user_id)
);

CREATE TABLE scope_invitations (
    id UUID PRIMARY KEY,
    scope_id UUID REFERENCES scopes(id),
    invitee_email TEXT NOT NULL,
    role TEXT NOT NULL,
    token_hash TEXT NOT NULL,        -- 存 hash，发信用原 token
    created_by_user_id UUID,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 资源表加列
ALTER TABLE skills    ADD COLUMN scope_id UUID REFERENCES scopes(id);
ALTER TABLE memories  ADD COLUMN scope_id UUID REFERENCES scopes(id);
ALTER TABLE memories  ADD COLUMN author_user_id UUID NOT NULL REFERENCES users(id);
ALTER TABLE sessions  ADD COLUMN scope_id UUID REFERENCES scopes(id);
ALTER TABLE vaults    ADD COLUMN scope_id UUID REFERENCES scopes(id);

-- Environment 多对多订阅
CREATE TABLE agent_environment_scopes (
    environment_id UUID REFERENCES agent_environments(id) ON DELETE CASCADE,
    scope_id UUID REFERENCES scopes(id),
    PRIMARY KEY (environment_id, scope_id)
);
```

**Alembic 迁移成本低**：当前代码里 `skills` / `memories` / `sessions` 都还没 `scopes` 字段（spec 提过但没落地），所以这一整套是"加列加表"，不是改列。

### 3.8 审计（新增 `audit_events` 表）

共享 scope 出现后，"谁改了什么" 变得非常重要（排 ACL bug、追溯泄漏）。

```sql
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    occurred_at TIMESTAMP DEFAULT NOW(),
    actor_user_id UUID REFERENCES users(id),
    actor_environment_id UUID,
    scope_id UUID REFERENCES scopes(id),
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id UUID,
    target_user_id UUID,                -- invite 目标等
    outcome TEXT NOT NULL,              -- success | denied | error
    request_id TEXT,
    metadata JSONB
);

CREATE INDEX ON audit_events (scope_id, occurred_at DESC);
CREATE INDEX ON audit_events (actor_user_id, occurred_at DESC);
```

MVP 最小记录：
- scope 创建 / 删除
- membership 邀请 / 接受 / 撤销 / 踢人
- shared scope 里的 skill / memory 增删改
- ACL 拒绝事件（`outcome=denied`，**一定要记**，否则排错无从查起）
- `vault/resolve` 调用（成功 + 失败都记）

### 3.9 CLI 与 Dashboard UX

**CLI**：

```bash
clawdi scope create "oauth-tips" --visibility shared
clawdi scope list
clawdi scope members oauth-tips
clawdi scope invite bob@example.com --scope oauth-tips --role writer
clawdi scope accept <token>
clawdi scope leave oauth-tips
clawdi scope delete oauth-tips     # 仅 owner

# 资源绑定
clawdi skill add foo.md --scope oauth-tips
clawdi memory add "Black 胜于 Ruff" --scope oauth-tips
clawdi setup --agent claude_code --subscribe oauth-tips,personal
```

**Dashboard**：

- 左侧栏新增「Scopes」入口，分两组："我拥有的" / "我参与的"
- Scope 详情页：成员列表、资源列表、pending invites、audit log 摘要
- 资源页面（skills / memories）加"Scope"列 + 过滤器
- 顶部栏 scope 切换器（快速按 scope 过滤整个 Dashboard）

### 3.10 MVP 切分（schema 早、UX 晚）

Codex 的建议采纳：**schema 在 phase 1 落地，分享 UX 在 phase 2 开放**。避免 auth 重构 + invite + audit + 隐私一起压进 phase 1 导致交付失控。

| Phase | Scope 相关内容 |
|---|---|
| **Phase 1（OSS 奠基）** | 表全部落地（`scopes` / `memberships` / `invitations` / `audit_events`）；资源加 `scope_id` 字段；API 骨架全部就位；UX 只开放"个人 scope"，分享入口 feature-flag-off |
| **Phase 2（bi-sync + daemon）** | 开放分享 UX（CLI 命令 + Dashboard invite），ACL enforcement 全开，session_search 的 user-private 约束落到 SQL |
| **V2+** | Session 逐次 opt-in 分享、Vault 分享（MFA + audit）、public link、跨实例 federation |

**结果**：OSS v1.0 对个人 self-host 用户是完整产品；v1.1 打开分享，朋友/小团队可用；federation 和 vault 共享再议。

### 3.11 命名

采用 **Scope**（范围）——延续原字符串标签时代的名字，语义升级为一等实体。

- 评估过的备选：`Workspace` 太大（Slack / Notion 里 workspace 都是"一次一个的大容器"，和我们"env 同时订阅多个"的模型不匹配）；`Channel` 带消息流联想；`Group` 偏人不偏内容
- `Scope` 小、可组合、可多订阅，语义贴近"我把资源切成几个 scope，env 订阅一部分"
- 原来担心"Scope 纯过滤器、没 ACL 语义"——但加了 owner + members 之后，英语里 "shared scope" 完全自然
- 中文对外文档：**一律用 "Scope"**，不译成"作用域"、"工作区"、"上下文"等歧义词

---

## 4. 同步模型

### 4.1 资源同步矩阵（修订后）

| 资源 | 方向 | 触发 | 冲突解决 | 传输 | 可见性过滤 |
|---|---|---|---|---|---|
| **Session（metadata）** | ↑ 上行 | agent 关闭 / daemon 检测到新 jsonl | N/A（append-only） | HTTP 批量 POST `/api/sessions/batch` + WS/SSE ack | `session.user_id = caller` |
| **Session（transcript）** | ↑ 上行 | 同上，跟 metadata 分步上传 | N/A；`file_key` upsert | HTTP multipart `/api/sessions/{id}/content` | 随 metadata |
| **Session chunks（索引）** | 服务端后台 | transcript 上传完成后异步 embed | N/A | 后端 task queue | 自动继承 session |
| **Session search** | Query-time | agent 调 `session_search` MCP 工具 | N/A | MCP + HTTP GET `/api/sessions/search` | **强制 `session.user_id = caller`**（即使跨 scope 也不跨 user） |
| **Skill** | ↕ 双向 | Push：CLI / web 上传。Pull：daemon 订阅 `skill.updated` 事件 | 服务端权威 LWW + **local conflict copy**（被覆盖的本地版本保留到 `~/.clawdi/conflicts/skills/<key>-<ts>.tar.gz`） | HTTP + WS/SSE | `skill.scope_id ∈ caller.scopes` 或 `skill.scope_id IS NULL AND skill.owner = caller` |
| **Memory（write）** | ↑ 上行 | `memory_add` MCP 工具 / CLI | N/A，每次 add 新行 | HTTP POST `/api/memories` | 写入时指定 scope；`author_user_id` 自动填 caller |
| **Memory（read）** | Query-time | `memory_search` MCP 工具 | N/A | HTTP GET `/api/memories?q=...&scope=...` | memory.scope ∈ caller.scopes，私有 memory 要求 `memory.author = caller` |
| **Vault（write）** | ↑ 上行 | `clawdi vault set` | N/A | HTTP POST `/api/vault/*`（加密） | 写入时只允许 `scope_id IS NULL`（MVP 禁共享） |
| **Vault（resolve）** | Query-time | `clawdi run` 执行子进程前 | N/A | HTTP POST `/api/vault/resolve`（仅 ApiKey） | **仅 caller 私有 vault**（MVP） |
| **Setting** | 默认 ↓ 下行，CLI 显式 ↑ 上行 | 修改时 push，连接时 reconcile | 服务端权威 | HTTP PATCH + WS/SSE | 用户级，不分 scope |
| **Environment（claim）** | ↑ 一次 | `clawdi env claim <token>` | 服务端权威 | HTTP POST `/api/environments/claim` | N/A |
| **Environment（heartbeat）** | ↑↓ 双向 | daemon 每 60s | LWW | HTTP PUT + WS/SSE | N/A |

**可见性过滤的前置条件——请求必须携带 `environment_id`**：

所有数据平面请求（memory_search / session_search / skill 下行 / vault resolve / 等）都必须在 HTTP header `X-Clawdi-Environment-Id` 或 query param 里带上调用方的 `environment_id`。后端 auth middleware 做两步校验：

1. **Token ↔ Env 绑定**：验证 `environment_id` 的所属 user 与 API key 对应的 user 一致
2. **Env 订阅装配**：从 `agent_environment_scopes` 查出该 env 订阅的所有 scope，注入到请求上下文 `ctx.subscribed_scopes`

之后所有 `可见性过滤` 列里写的 SQL 条件都基于 `ctx.subscribed_scopes` 和 `ctx.caller_user_id`。仅靠 user-wide API key 不足以做 scope ACL——**环境绑定是 ACL 的基石**。

### 4.2 Revision 模型（代替纯客户端游标）

**老问题**（Codex 指出）：`~/.clawdi/sync.json` 作为客户端专有游标，在多设备双向同步场景下不够——同一 user 从两台机器并发写入同一 skill，纯客户端时间戳无法判断谁新。

**改进**：引入**服务端 per-resource revision**：

- 每个资源表加 `revision: int`（每次服务端写入 +1）
- 客户端写入时必须带 `If-Match: revision=N`；服务端校验：
  - 若客户端 `N == db.revision`，接受写入，`revision += 1`
  - 若 `N < db.revision`，返回 `409 Conflict` + 服务端当前内容
- Daemon 订阅 WS 事件，每次变更推送 `{resource: "skill", id: X, revision: N+1}`；daemon 拿到事件后做本地对账
- 老的 `sync.json` 保留为**本地缓存**，不再作为唯一真相源

**落地影响**：

- `skills` 表 `_upsert_skill`（`backend/app/routes/skills.py:290`）要加 revision 前置条件校验
- `memories` 由于是 append-only 不需要 revision
- `vault_items` 要加 revision（用户有可能从多端同时改密钥值）
- `user_settings` 要加 revision（多端并发改偏好）
- `agent_environments` heartbeat 不走 revision，直接 LWW 时间戳

### 4.3 Session 身份的纠错（Codex 指出的 correctness bug）

**现状**：`sessions.py:91` 重复检查只用 `(user_id, local_session_id)`。多设备场景必然碰撞——我家里机器和公司机器各自的 Claude Code 可能独立生成同一个 `local_session_id`（UUID 冲突虽低，但某些 agent 用短 ID 形式）。

**修正**：主键改为 `(user_id, environment_id, local_session_id)`，所有 session 写入必须先解析出来自哪个 environment。

### 4.4 Worked Example：用户在 CLI 上传一个 skill

> 注：此例子**不**假设 Dashboard 支持浏览器内 skill 编辑——现状 Dashboard 只支持 install / delete。编辑一律通过 CLI。

1. 用户在 `~/scope/python-style/SKILL.md` 编辑好了 skill
2. `clawdi skill add python-style --scope oauth-tips`（oauth-tips 是已创建的 shared scope）
3. CLI 打包 tar.gz，带 `If-Match: revision=3` + `X-Clawdi-Environment-Id: env_desktop_codex`，POST `/api/skills/python-style`
4. 后端：
   - 校验 env 绑定：`env_desktop_codex` 属于当前 user → 通过
   - 校验 scope 权限：caller 在 `oauth-tips` 是 writer 或 owner → 通过
   - 校验 revision：`db.revision == 3` → 通过
   - 写 file store（上传 tar.gz）
   - 更新 `skills` 表：`revision: 4, scope_id: <oauth-tips uuid>`
   - 写 `audit_events`：`action=skill.update, actor=caller, scope=oauth-tips, outcome=success`
   - 发 webhook `skill.updated` + 广播 WS 事件
5. `oauth-tips` scope 所有成员的订阅 env 收到 WS 事件——假设：
   - 我自己家里 Claude Code（订阅 `personal`）→ 不订阅 oauth-tips → 不同步
   - 我自己公司 Codex（订阅 `work, oauth-tips`）→ 同步
   - 朋友 Bob 的笔记本 Claude Code（订阅 `oauth-tips`）→ 同步
7. 公司 Codex 的 daemon：
   - 下载 `/api/skills/python-style/download` 得到 tar.gz
   - 调 `CodexAdapter.writeSkillArchive("python-style", tarBytes)` → 写到 `~/.codex/skills/python-style/`
   - 本地缓存 revision = 4

**冲突场景**：公司 Codex 的 daemon 下载 skill 之前，用户在公司机器上也手改了 `~/.codex/skills/python-style/SKILL.md`：

- Daemon 检测到本地 mtime > 上次同步 → 准备上传
- 上传时带 `If-Match: revision=3`（本地缓存值，未追上云端）
- 服务端返回 `409 Conflict`（db.revision 已是 4）
- Daemon 本地保留这份手改版到 `~/.clawdi/conflicts/skills/python-style-20260421-143200.tar.gz`
- Daemon 拉云端 revision=4 覆盖 `~/.codex/skills/python-style/`
- 在 `clawdi daemon status` 和 Dashboard 上显示一个冲突通知："python-style skill 被云端覆盖，本地原版保存到 ~/.clawdi/conflicts/..."
- 用户自行 diff / merge / 重新 `clawdi skill add`

---

## 5. Session 跨 agent 检索（RAG 方式）

### 5.1 设计意图

**之前考虑过的方案**：把 session 变成"可迁移的对话单元"——compact 摘要 + `clawdi session resume` 命令把 session 写到目标 agent 的原生格式。

**放弃原因**：
- compact 摘要信息损失大，跨 agent 体验会"掉线"
- 每个 adapter 都要实现"写目标 agent session 文件"这条路径（Claude Code JSONL / Codex JSONL / OpenClaw JSONL+index / Hermes SQLite），复杂度高且难保证正确
- 真正的用户需求不是**"在另一个 agent 上延续同一个对话"**，而是**"另一个 agent 需要时能看到我在别的 agent 里讨论过的相关上下文"**

**采纳方案**：Session 只做**单向上传**（agent → cloud）。跨 agent 的上下文延续通过**对 session 内容建索引 + 按需检索**实现——和 memory 的混合检索共用同一套基础设施，agent 通过 MCP 工具主动搜。

### 5.2 工作原理

```
[Agent A (Claude Code) 的一次调试会话]
  你: 帮我看下这个 OAuth 流程哪里不对
  Claude: <深入分析 refresh_token 过期问题> ...
  <会话结束>

[Daemon 上传 session]
  → 后端 sessions 表写入 metadata
  → 后端 file store 写入 transcript JSONL
  → 后端 task queue 排一个 embedding job

[后台 worker 处理 session]
  1. 读取 transcript
  2. 切分成 chunk（约 500 tokens/段，overlap 50 tokens）
  3. 为每个 chunk 计算 embedding
  4. 写入 session_chunks 表（只存 chunk_content + embedding + chunk_index +
     session_id；scope / 时间 / agent_type 等元数据查询时 JOIN `sessions`
     和 `agent_environments`，chunks 表不冗余存，避免 scope 调整时的写放大）

[几天后，Agent B (Codex) 另开会话]
  你: 这个 OAuth 库的 token refresh 有问题吗？
  
  Codex 内部 MCP 调用:
    session_search("OAuth token refresh", limit=5)
    // scope 过滤由后端按 env.subscribed_scopes 自动套用
  
  后端混合检索（FTS + trigram + vector + 时间衰减 + MMR，同 memory 流水线）
  返回 5 个相关 chunk，每个带 source_session_id / agent_type / timestamp / content
  
  Codex 看到结果："哦，3 天前你在 Claude Code 里调过这个 OAuth 流程，
                当时发现问题出在 refresh_token 过期时间没对上"
  → 用这个上下文回答用户的问题，或提示用户打开原 session 看完整经过
```

### 5.3 新增 MCP 工具：`session_search`

签名：

```
session_search(
  query: string,
  limit?: number = 10,
  scope?: string[],       // 默认用调用方 env.subscribed_scopes；
                              // 可指定子集缩窄，不能扩大
  agent_type?: string[],      // 可选：只搜某些 agent 类型
  since?: string              // 可选：ISO 日期，只搜之后的
) → [
    {
      // chunks 表本身的字段
      chunk_id, chunk_content, chunk_index, similarity_score,
      // 来自 JOIN sessions 的字段
      session_id, summary, started_at, project_path,
      // 来自 JOIN agent_environments 的字段
      agent_type
    }
  ]
```

`summary` 字段来自 `sessions.summary`（session metadata 里 adapter 写入的摘要），不是任何 compact 动作产物。

MCP tool description（给 agent 看的触发 prompt）：

> 搜索用户的历史对话。当用户问"之前我们讨论过 X 吗 / 上次是怎么解决的 / 继续之前的思路"，
> 或你判断当前问题可能在过去对话中有相关上下文时，主动调用此工具。
> 即便本 agent 没做过这件事，用户在其他 agent 上可能做过——跨 agent 是默认行为。
> 调用成本低（约 100ms），宁可多调也别遗漏。返回 0 条不要慌，继续正常回答即可。

放在 `packages/cli/src/mcp/server.ts`，与 `memory_search` 并列。

**为什么不合并到 `memory_search`**：

- `memory` 是人工策展的长期事实（"我喜欢 Black 而非 Ruff"），颗粒小、准确率高、适合快速取偏好
- `session_chunk` 是原始对话片段，信息量大但噪声多，适合找历史讨论经过
- 分开让 agent 能按场景选工具，也让返回值 schema 各自保持清晰

### 5.4 数据模型

新增 `session_chunks` 表：

```sql
CREATE TABLE session_chunks (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    content_tsv TSVECTOR
        GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    embedding VECTOR(768),
    start_message_idx INT,
    end_message_idx INT,
    embedding_status TEXT DEFAULT 'pending',   -- pending | done | failed
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (session_id, chunk_index)
);

CREATE INDEX ON session_chunks USING GIN (content_tsv);
CREATE INDEX ON session_chunks USING GIN (content gin_trgm_ops);
CREATE INDEX ON session_chunks USING HNSW (embedding vector_cosine_ops)
    WHERE embedding IS NOT NULL;
```

Scope 和 user 过滤通过 JOIN `sessions` 实现（chunks 只存最小字段，scope / owner / created_time 都按需 JOIN 查出来）。

### 5.5 切块（Chunking）策略

- **窗口**：约 500 tokens / 段（~2000 字符），overlap 50 tokens
- **边界**：优先在 user/assistant 消息边界切；若单条消息超过窗口，按段落（空行）切
- **Tool output 处理**：agent 的 tool call output 可能占 transcript 的 80%（大 log、大文件 diff），默认**跳过纯 tool output 块**只保留消息文本；用户可用 `session.chunking.include_tool_output=true` 开关（存在 user_settings 里）
- **异步处理**：session 上传成功后，后端排 task。MVP 用 FastAPI `BackgroundTasks`（免新依赖），量大后换独立 worker
- **失败容忍**：embedding 失败 chunk 标记 `embedding_status=failed`；FTS/trigram 仍可用（不依赖向量）。定时重试 job 扫 `failed` 行

### 5.6 检索策略（复用 Memory 混合检索）

服务层复用 `backend/app/services/memory_provider.py` 的 `BuiltinProvider` 模式。新增 `SessionChunkProvider`，接口与 Memory 对齐：

- FTS（始终开启）
- Trigram 模糊（始终开启）
- pgvector 语义（有 embedding 时；`embedding_status=done`）
- 时间衰减：session 新鲜度比 memory 更重要，**半衰期缩到 7 天**（memory 是 30 天）
- MMR 去重：同一 session 里的多个相似 chunk 只返回得分最高的一个，避免 5 个结果全来自同一个会话

### 5.7 Scope 与 user 约束（关键隐私规则）

**两条硬约束，`session_search` 的 SQL WHERE 必须同时满足**：

1. **永不跨 user**——即使 session 位于共享 scope，其他成员也搜不到：
   ```sql
   WHERE sessions.user_id = :caller_user_id
   ```
   原因：原始 transcript 可能含密钥、内部代码、敏感对话；分享 scope 的默认预期是"共享策展过的 skill / memory"，**不是**"共享我所有对话记录"。

2. **Scope 订阅过滤**：
   ```sql
   AND (sessions.scope_id IS NULL
        OR sessions.scope_id IN :caller_subscribed_scopes)
   ```
   确保共享 scope 外的私有 session 也仅在订阅该 session 所属 scope 的 env 上出现。

两条 AND 叠加：**session 检索是"我自己的对话 + 我订阅的 scope 上下文下"**。

agent 可显式传 `scope=[...]` 进一步缩窄；**不能扩大**（后端强制 `request.scopes ⊆ caller.subscribed_scopes`）。

**V2 考虑**：若用户明确想把某次 session 分享给 scope 成员，加一个"per-session share flag"，仅该 session 绕开约束 1。MVP 不做。

### 5.8 对 Hermes 的影响

Hermes adapter 仍然**只读** `~/.hermes/state.db`（和之前设计一致）。抽取出的 transcript 上传到 cloud 后，chunking / embedding 在服务端做，Hermes 本地零改动。检索时 Hermes 通过 `clawdi daemon` 暴露的 MCP endpoint 调 `session_search`，透明。

这消除了"daemon 要不要写 Hermes SQLite"这个风险——**现在不写了**。

### 5.9 明确不做

- ❌ Session transcript 下发到 agent 机器
- ❌ `clawdi session resume` 命令
- ❌ compact 命令（agent 自己的 `/compact` 原本就有，不碰也不依赖）
- ❌ 跨 user 检索
- ❌ Session chunk 去重（不同 session 里相似对话不合并，保留每次的上下文差异）

### 5.10 索引状态（上传成功 ≠ 立即可搜）

Session 上传是快路径（元数据 + transcript 写 file store），chunking + embedding 是慢路径（后台任务）。必须把这个差异透明化，否则用户以为上传了就能查到，实际还在排队。

**接口表现**：

- `POST /api/sessions/batch`（上传 metadata）返回 `{ session_id, indexing_status: "pending" }`
- `POST /api/sessions/{id}/content`（上传 transcript）返回 `{ job_id, indexing_status: "queued" }`
- 新增 `GET /api/sessions/{id}/indexing`，返回 `{ status: "pending|running|done|failed", chunks_done: N, chunks_total: M, error_message: null }`
- WS 事件 `session.indexed`：chunking + embedding 全部完成时广播，daemon 可用来刷新本地状态

**Dashboard 表现**：

- Sessions 列表页每行有索引状态图标（queued / running / done / failed）
- Session 详情页显示 chunking 进度条
- 长时间卡在 queued 要给出提示（可能 worker 挂了，建议 `clawdi status`）

**Daemon 表现**：
- daemon 显示最近上传 session 的索引状态（`clawdi status` 输出）
- `session_search` 调用失败时如果原因是"相关 session 尚未索引"，返回 HTTP 202 + 提示信息，而非空结果

### 5.11 隐私立场（明确告知）

原始 transcript 会被上传到 clawdi-cloud 并参与 embedding / 索引。MVP 采取**低保障、高透明**策略：

- ❌ **默认不做 secret redaction**——后端不会自动识别并脱敏 API key、密码、token。transcript 有什么就存什么
- ⚠️ **用户责任**：避免把 secret 粘到和 agent 的对话里（这和"别把 secret commit 进 git"同理）
- ✅ **结构性隔离**：session chunks 永不跨 user（§5.7），user 之间互不影响
- 🔜 **V2 预留 hook**：在 chunking 前插入可选 `pre_index_redaction_pipeline`（regex / LLM-based）。OSS operator 可自行启用
- 📜 **文档明确告知**：`docs/self-hosting.md` 会专门写一节"上传什么不上传什么"

### 5.12 成本考虑

Embedding 每个 session 有成本（计算 / 存储）。MVP 方案：

- 默认**所有 session 都 embed**（本地 fastembed 免费；API embedder 按量付费）
- 用户可在 settings 里选**不 embed 某些 scope**（`embed_sessions_opt_out: [<scope_id>]`），比如特别敏感的项目
- Token 级计量通过 `usage` 端点暴露给 SaaS，self-host 用户自行监控

---

## 6. CLI daemon 模式

### 6.1 现状

`sync up` / `sync down` 是一次性命令（`packages/cli/src/commands/sync.ts`），游标在 `~/.clawdi/sync.json`。MCP server（`packages/cli/src/mcp/server.ts`）是另一个 stdio 长进程，负责 memory / Composio 代理。两者没共用机制。

### 6.2 daemon 设计

新增 `clawdi daemon`：

```
┌─────────────────────────────────────────────────┐
│ clawdi daemon (long-running)                    │
│                                                 │
│  ┌──────────────┐    ┌──────────────────────┐   │
│  │ Connection   │    │ Sync Engine          │   │
│  │ Manager      │    │                      │   │
│  │              │    │ - Session watcher    │   │
│  │  WS ──┐      │    │ - Skill push/pull    │   │
│  │  SSE ─┼──→  ─┼────┤ - Memory write       │   │
│  │  Poll ┘      │    │ - Setting reconciler │   │
│  │              │    │ - Env heartbeat      │   │
│  └──────────────┘    │ - Conflict handler   │   │
│                      └──────────┬───────────┘   │
│                                 │                │
│                                 ▼                │
│                      ┌────────────────────┐     │
│                      │ AgentAdapter(s)    │     │
│                      │ (per registered    │     │
│                      │  environment)      │     │
│                      └────────────────────┘     │
│                                                 │
│  MCP stdio 子协议（可选，待评估）               │
└─────────────────────────────────────────────────┘
```

### 6.3 连接降级策略

WebSocket → SSE → Polling，按顺序尝试：

1. **WebSocket**（首选）：`wss://api.clawdi.cloud/api/ws`，订阅自己 user_id 下的资源变更事件
2. **SSE**（若 WS 在代理环境被拦截）：`/api/events/stream`，单向 server→client
3. **Polling**（兜底）：`/api/events/poll?since=<cursor>`，30s 间隔；有变更时下个周期缩到 10s；无变更连续 10 次拉到 60s

### 6.4 代码共用

抽出 `packages/cli/src/lib/sync-engine.ts`：

```
sync-engine.ts
  ├── SyncEngine class
  │     pullLocalSessions(since) → RawSession[]
  │     pushSessions(sessions) → { synced }
  │     pullRemoteSkills(scopes) → Skill[]
  │     applySkillArchive(adapter, skill_key, bytes)
  │     ...
  └── 依赖：AgentAdapter + ApiClient + LocalState
```

消费者：
- `commands/sync.ts`（`sync up` / `sync down`）：一次性调 engine 方法
- `commands/daemon.ts`：起连接 → 循环调 engine + 响应事件
- 保留：`mcp/server.ts`（MCP 独立进程，不合进 daemon；两者通过 API client 共享 token，状态不共享）

### 6.5 Watcher 策略（每 adapter 差异）

| Adapter | 本地数据位置 | Watch 方式 |
|---|---|---|
| Claude Code | `~/.claude/projects/<hash>/*.jsonl` + `~/.claude/skills/` | `fs.watch` 目录 + JSONL 增量 |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` + `~/.codex/skills/` | 同上 |
| OpenClaw | `~/.openclaw/agents/main/sessions/sessions.json` + per-session JSONL + skills | watch index + per-file |
| Hermes | `~/.hermes/state.db`（**只读**） + `~/.hermes/skills/` | **不 watch DB**；定期 `pragma user_version` 或直接定时扫最新 `started_at`。skill 目录 watch 文件 |

**硬约束**：`HermesAdapter` 不暴露任何写 SQLite 的方法（在类型层面就锁死，避免未来被误用）。

### 6.6 容器里的 daemon

在 `clawdi-agent` 镜像里，daemon 作为 supervisord child 启动：

```ini
[program:clawdi-daemon]
command=/usr/local/bin/clawdi daemon
environment=CLAWDI_API_URL=%(ENV_CLAWDI_API_URL)s,CLAWDI_API_KEY=%(ENV_CLAWDI_API_KEY)s
autostart=true
autorestart=true
startretries=999
stdout_logfile=/var/log/supervisor/clawdi-daemon.log
```

和 laptop 上的 daemon 是**同一个二进制**。容器里的 `CLAWDI_API_KEY` 通过下面第 8 节的 claim 流程拿到。

---

## 7. Auth 与身份模型

### 7.1 现状问题

- `backend/app/core/auth.py` 硬绑 Clerk JWT 验证
- `backend/app/models/user.py` 的 `clerk_id` 是 NOT NULL 必填
- Web 层的 `apps/web/src/app/layout.tsx`、`middleware.ts`、`sign-in` 页都是 Clerk 专属组件

Clerk 是商业 SaaS，self-host 用户不会想为这个掏钱。这是 OSS 最大的阻碍。

### 7.2 AuthProvider 抽象

```python
class AuthUser(BaseModel):
    id: str              # clawdi-cloud 内部 user UUID
    email: str
    name: str | None
    provider: str        # "basic" / "clerk" / "oidc" ...

class AuthProvider(ABC):
    @abstractmethod
    async def verify_session_token(self, token: str) -> AuthUser | None: ...
    @abstractmethod
    async def issue_session_token(self, user: AuthUser) -> str: ...
    @abstractmethod
    async def provider_specific_routes(self) -> list[APIRoute]: ...
```

实现：
- **`BasicAuthProvider`**（OSS 默认）——邮箱 + 密码，可选 SMTP magic link
- **`ClerkProvider`**——保留现状逻辑，作为可选模块
- **`OidcProvider`**——通用 OIDC，可接 Keycloak / Auth0 / 自建 IdP

### 7.3 数据模型改动

去掉 `users.clerk_id NOT NULL`，改为：

```sql
CREATE TABLE auth_identities (
    user_id UUID REFERENCES users(id),
    provider TEXT NOT NULL,       -- "basic" / "clerk" / "oidc"
    subject TEXT NOT NULL,         -- provider 内的唯一标识（clerk_id / email / sub）
    metadata JSONB,                -- provider-specific payload
    created_at TIMESTAMP,
    PRIMARY KEY (provider, subject)
);
```

一个 user 可以有多个 identity（某天想从 Basic 切到 Clerk 也支持）。

### 7.4 三种 token 并存

| Token | 使用者 | 发放方 | 生命周期 | 典型前缀 |
|---|---|---|---|---|
| **Session JWT** | Dashboard 浏览器 | AuthProvider | 用户会话（小时-天） | `Bearer <jwt>` |
| **API Key** | CLI / 自动化 | 用户在 Dashboard 手动创建 | 用户设定（默认 90 天） | `clawdi_sk_<random>` |
| **Instance Token** | 容器 bootstrap（SaaS） | **SaaS 后端**（OSS 只提供 claim 端点） | 一次性，5 分钟 | `clawdi_it_<random>` |

**不合并 ApiKey 和 Instance Token**（信任边界不同）：

- ApiKey 代表一个 **user 主体**，可调所有用户资源 API
- Instance Token 只是 **bootstrap 凭证**，换取 environment-scoped key 后即作废；其 scope 限定为 claim / heartbeat / 该 env 的资源同步

共享验证基础设施（都经过同一个 auth middleware 流），但 token 类型保持独立。

### 7.5 Environment 绑定（scope ACL 的基石）

仅靠 user-wide ApiKey 无法做 scope ACL——任何持有 key 的客户端都能冒充任意 environment。因此：

- 所有数据平面请求**必须携带 `environment_id`**（HTTP header `X-Clawdi-Environment-Id` 或 query param）
- auth middleware 额外校验：`environment.user_id == token.user_id`；不匹配返回 401
- 校验通过后把该 env 的 `subscribed_scopes` 注入请求 context
- `clawdi daemon` 启动时把 env_id 固化到客户端（`~/.clawdi/environments/<agent>.json`），后续所有 HTTP 调用自动带上
- Dashboard 的请求在 client side 从当前选中的 scope / environment 推导 env_id

这条约束是 §3（Scope ACL） + §4（Sync 可见性过滤）+ §5（session_search 隐私规则）能实际生效的前提。

### 7.6 Web Auth 重构影响面

不小，Codex 已指出：

- `backend/app/core/auth.py`（auth middleware 改写）
- `backend/app/models/user.py` + `auth_identities` 新表 + Alembic 迁移
- `apps/web/src/app/layout.tsx`（不再 ClerkProvider 包根）
- `apps/web/src/middleware.ts`（provider-agnostic session 校验）
- `apps/web/src/app/(auth)/sign-in/page.tsx`（组件解耦，provider 切换）
- 前端新增 `/auth/basic/login`、`/auth/basic/magic-link` 页面（当 `NEXT_PUBLIC_AUTH_PROVIDER=basic`）

这是一整条穿透链，需专门规划一个 phase。

---

## 8. clawdi-agent 镜像迁移路径

### 8.1 现状（`/Users/kingsley/Programs/clawdi/agent-image/`）

- 多 stage Dockerfile：system-deps → hermes → runtime-glue → base / dev
- `entrypoint.sh` 从 `OPENCLAW_CONFIG_B64` 注入配置、`MASTER_KEY` 派生 auth token、`/data` PVC symlink
- `supervisord` 管理：OpenClaw gateway + Hermes + **Controller**（Hono auth proxy，端口 18789）
- Controller 职责：本地 auth、文件访问、日志流、终端 proxy、gateway 转发
- 镜像推到 `ghcr.io/clawdi-ai/clawdi-agent`
- 部署模板：`openclaw/k8s/pod-template.yaml.j2`，由老 clawdi 后端的 `phala.py` / `k3s.py` 渲染

### 8.2 迁移分阶段

#### 阶段 A：镜像内并存 daemon（不破坏现有部署）

- 在镜像里装 `clawdi` CLI 二进制
- `supervisord.conf` 新增 `[program:clawdi-daemon]`
- `entrypoint.sh` 追加：若有 `CLAWDI_API_URL` 和 `CLAWDI_INSTANCE_TOKEN` 环境变量，则 daemon 启动时自动跑一次 `clawdi env claim <token>`
- **Controller 照常运行**，两者互不干扰
- 老部署流照旧用老 clawdi 后端，新部署流由 SaaS deployer 注入 claim token

#### 阶段 B：SaaS deployer 完全取代老部署路径

- 新的 SaaS deployer（独立仓库）生成简化版 pod 模板，只塞：
  ```
  CLAWDI_API_URL=https://api.clawdi.cloud
  CLAWDI_INSTANCE_TOKEN=<one-time claim token>
  ```
- 老 clawdi 后端的 `deployments.py`、`phala.py`、`k3s.py`、`store_sync.py`、`usage_sync.py` 停止接受新 tenant 的请求
- 现有部署不动，继续走 Controller + 老后端

#### 阶段 C：Controller 去 sync 化

- Controller 里剥离所有 "phone home 到老 clawdi 后端"的逻辑（sync / usage report / 认证部分）
- 保留 Controller 的**本地 proxy 职责**（浏览器访问 / 文件 API / 日志流 / 终端 proxy），这些仍有用
- Controller 的认证改为本地 shared secret（继续用 `GATEWAY_AUTH_TOKEN`），不再远程
- sync 全部走 daemon

#### 阶段 D：老镜像下线

- 所有活跃部署都在新版镜像上运行（SaaS 做滚动升级）
- 老 `agent-image/` 目录归档
- 老 clawdi 后端的部署路由返回 410 Gone

### 8.3 Bootstrap 流程（新版）

```
[SaaS deployer]
  1. 调 OSS `/api/instance-tokens` 生成一次性 claim token
     （该端点仅接受 SaaS 管理员 API key）
  2. 把 token 注入 pod secret：
     CLAWDI_API_URL + CLAWDI_INSTANCE_TOKEN

[容器启动]
  3. entrypoint.sh 跑现有逻辑（/data symlink / master key 派生）
  4. supervisord 拉起 OpenClaw + Hermes + Controller + clawdi daemon

[clawdi daemon 启动]
  5. 读 CLAWDI_INSTANCE_TOKEN
  6. POST /api/environments/claim?token=<it>
     后端：
       - 校验 token（一次性、未过期、未用过）
       - 创建 AgentEnvironment 行，关联给 SaaS 记录的 user
       - 生成一个 environment-scoped API key
       - 返回 { environment_id, api_key, user_id, subscribed_scopes }
  7. daemon 把 api_key 写到 /data/.clawdi/auth.json（容器重启仍在）
  8. daemon 订阅 WS 事件，开始正常同步

[之后]
  9. daemon 周期心跳 PUT /api/environments/{env_id}/heartbeat
  10. SaaS backend 订阅 webhook `environment.claimed` 记录计费开始
```

### 8.4 SaaS 独有、OSS 不做的部分

- 生成 `CLAWDI_INSTANCE_TOKEN`（SaaS 需要自己的 token 签发服务）
- 渲染 pod 模板、调 k8s/Phala API
- 多租户隔离（确认容器属于哪个 tenant）
- 容器生命周期管理（重启、升级镜像、资源限额）
- 镜像构建和推送 CI

---

## 9. 开源打包

### 9.1 Monorepo 结构保持

无需重排，当前划分合理：

```
apps/web/           Next.js Dashboard
packages/cli/       CLI + MCP server + daemon + adapters + sync-engine
packages/shared/    types + consts
backend/            FastAPI + Alembic
docs/               文档（含本 spec）
docker-compose.yml  (新增) OSS 一键起
Dockerfile.backend  (新增)
Dockerfile.web      (新增)
```

### 9.2 分发形式

| 产物 | 方式 | 备注 |
|---|---|---|
| Backend + Web | docker-compose.yml，含 Postgres | OSS 默认 |
| CLI | 多路径：`bun add -g @clawdi/cli`；GitHub release 二进制（`bun build --compile`）；npm wrapper | 单二进制最贴近 UX |
| 开发模式 | `bun install && bun run dev` | 开发者贡献 |

### 9.3 docker-compose.yml 骨架

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: clawdi
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: clawdi
    volumes:
      - ./data/postgres:/var/lib/postgresql/data

  backend:
    build: { context: ., dockerfile: Dockerfile.backend }
    environment:
      DATABASE_URL: postgresql+asyncpg://clawdi:${POSTGRES_PASSWORD}@postgres/clawdi
      AUTH_PROVIDER: basic
      BASIC_AUTH_SECRET: ${BASIC_AUTH_SECRET}
      VAULT_ENCRYPTION_KEY: ${VAULT_ENCRYPTION_KEY}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      FILE_STORE_MODE: local
      FILE_STORE_LOCAL_PATH: /app/data/files
      EMBEDDING_MODE: local
    volumes:
      - ./data/files:/app/data/files
    depends_on: [postgres]
    ports: ["8000:8000"]

  web:
    build: { context: ., dockerfile: Dockerfile.web }
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
      NEXT_PUBLIC_AUTH_PROVIDER: basic
    depends_on: [backend]
    ports: ["3000:3000"]
```

配套 `.env.example`（根目录）+ `scripts/init-keys.sh`（自动生成随机 key 填进 `.env`）。

### 9.4 环境变量参考（精简）

```
# Auth
AUTH_PROVIDER=basic|clerk|oidc           # 默认 basic
BASIC_AUTH_SECRET=<256-bit>              # basic 专用 JWT 签名
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM
CLERK_PEM_PUBLIC_KEY                     # clerk 专用
OIDC_DISCOVERY_URL / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET  # oidc 专用

# Database
DATABASE_URL=postgresql+asyncpg://...

# Encryption (init-keys.sh 生成)
VAULT_ENCRYPTION_KEY=<32 bytes hex>
ENCRYPTION_KEY=<32 bytes hex>

# File Store
FILE_STORE_MODE=local|s3|r2
FILE_STORE_LOCAL_PATH=./data/files
AWS_* / R2_*                             # s3 / r2 专用

# Embedding（memory 与 session chunks 共用同一套基础设施）
EMBEDDING_MODE=local|api
EMBEDDING_API_KEY / EMBEDDING_BASE_URL
# 旧名 MEMORY_EMBEDDING_MODE 保留 1 个 release 做兼容，之后 deprecate

# Optional
COMPOSIO_API_KEY                         # Composio 连接器
SENTRY_DSN
LOG_LEVEL=INFO
```

### 9.5 首次运行流程

1. `git clone` + `cp .env.example .env`
2. `./scripts/init-keys.sh`（生成随机密钥）
3. `docker compose up -d`
4. 访问 `http://localhost:3000` → 自动进入 onboarding 页（因为 DB 里没 user）
5. 填邮箱 + 密码创建第一个用户（自动 admin 角色）
6. 页面跳转 Dashboard，生成首个 ApiKey，显示一次（二维码 + 复制按钮）
7. 本地装 CLI：`npm install -g @clawdi/cli`，`clawdi login --api-url http://localhost:8000`，粘贴 ApiKey
8. `clawdi setup --agent claude_code` → 安装 MCP server + 注册 environment

### 9.6 迁移工具

两端都要动：

- **老 clawdi 一侧**：加 `/api/deprecation/export` 端点（dump 整个用户的 sessions + skills + memories + vault metadata + 加密 vault items），以标准 bundle 格式返回
- **新 clawdi-cloud 一侧**：CLI 命令
  ```bash
  clawdi migrate import --bundle path/to/export.tar.gz --vault-master-key ...
  ```
  逐资源幂等 upsert；vault 用户需要提供原 master key 解密、由新后端重新加密

**不可复用**：老 clawdi 的 `store_sync.py`（marketplace catalog）、`usage_sync.py`（billing outbox）——都是部署平台特有，不迁。

### 9.7 文档债务（Phase 1 必修）

- README.md 里提及 Redis，但架构文档说"目前未用"——去掉 README 的 Redis 段
- README 指向 `apps/web/.env.example`，该文件不存在——补上
- `docs/architecture.md` 更新为"云端优先 + OSS"的新定位
- 新增 `docs/self-hosting.md`（安装、备份、升级、故障排查）
- 新增 `docs/auth-providers.md`（三种 provider 的选择和配置）

---

## 10. 老 clawdi 废弃分阶段

### 阶段 1：OSS 奠基（4-6 周）

- AuthProvider 抽象 + `BasicAuthProvider` + `auth_identities` 表 + Alembic 迁移
- Dashboard 的 Clerk 依赖剥离（provider-agnostic 组件）
- docker-compose 出来、`.env.example` 补齐、README 修正
- Scope 全套表落地（`scopes` / `scope_memberships` / `scope_invitations` / `audit_events`）；资源加 `scope_id` 列；`agent_environment_scopes` 多对多表。**UX 只开自己的 scope**，分享相关入口 feature-flag-off。
- revision 字段加到 skill / vault / settings
- Session duplicate key 改为 `(user_id, environment_id, local_session_id)`

**退出标准**：本地 `docker compose up` 能从零建账号 → CLI 登录 → 一个 agent 完整 sync。Clerk 完全可选。

### 阶段 2：双向同步与 daemon（6-8 周）

- `sync-engine` 抽出
- `clawdi daemon` 命令（WS/SSE/poll 三级）
- Skill 双向 + conflict copy
- Scope 分享 UX 开放：CLI `scope create/invite/accept/members`；Dashboard 邀请流 + 两个视图；ACL enforcement 全开；`session_search` user-private 约束落到 SQL
- Memory / Vault / Setting 的 scope 过滤落到 API（强制 `environment_id` 绑定校验）
- Session chunks 异步 embedding 流水线 + `session_search` MCP 工具
- 冲突检测 UI（Dashboard "Sync Health" 页）

**退出标准**：笔记本上两个 agent（如 Claude Code + Codex）通过 scope 做到资源隔离；一个用户发邀请给另一个用户、对方接受后资源能互通；Dashboard 里改 scope 订阅能在 5s 内下推到所有 daemon；`session_search` 跨 user 时必定返回空。

### 阶段 3：agent-image 集成（4-6 周）

- 镜像并存 daemon（阶段 A）
- `POST /api/environments/claim` + instance token 流程
- SaaS deployer（独立仓库）写出来，用新 claim 流注入 token
- Webhook outbound（SaaS 侧订阅）

**退出标准**：一个金丝雀 SaaS 实例完全用 daemon 同步；老 Controller 降级为本地 proxy（不再 phone home）。

### 阶段 4：老 clawdi 下线（6-8 周）

- SaaS 所有 tenant 迁完
- 老 clawdi repo：
  - 删 `openclaw/k8s/pod-template.yaml.j2`
  - 删 `backend/app/services/k3s.py` / `phala.py`
  - 删 `backend/app/routes/deployments.py` 的部署部分
  - 删 `agent-image/controller/` 的远程 auth / sync 部分
  - 保留 `/api/deprecation/export` 再 30 天
- repo archive

**退出标准**：老 clawdi API 访问量 30 天归零。

---

## 11. 风险与未决

### 高优先级

1. **Auth 重构深度穿透**
   - DB schema（`auth_identities` 表 + `users.clerk_id` 去 NOT NULL）+ middleware + layout + sign-in 页 + CLI 登录命令，全链路改动
   - 低估这个 phase 会拖累后面所有 phase
   - 建议：专人专 sprint 做完再继续

2. **Revision + Scope 两个改动叠加的迁移复杂度**
   - 老数据：revision 默认 1；scope_id 默认 NULL（即私有）；每个 user 自动创建一个"Personal" scope 兜底
   - Alembic 迁移要幂等、可回滚
   - 测试：拿一份 SaaS 真实数据匿名 dump 做 migration 演练

3. **Hermes SQLite 并发仍存在隐患**
   - 即便 adapter 只读，SaaS `clawdi-agent` 容器里 Hermes 进程 + daemon 进程同时访问同一 DB 路径——虽无冲突写，但某些 SQLite 配置下 readers 也会受影响
   - 测试：在 `clawdi-agent` 镜像里长跑一周，监控 Hermes DB corruption 日志
   - 降级方案：daemon 完全禁止触碰 DB 文件句柄，skill/config 走文件系统

4. **Session 检索质量**
   - Chunk 粒度太细（单消息）→ 答案碎片化，agent 拼不回上下文
   - Chunk 粒度太粗（整 session）→ 返回量大浪费 context
   - Tool output 块信噪比低，默认跳过可能漏掉关键诊断信息
   - 时间衰减半衰期 7 天是直觉猜的，真实用户可能要 3 天或 14 天——需上线后用检索日志调
   - 兜底：让 tool description 教 agent "结果 0 条不要慌，正常回答"，避免过度依赖

5. **老部署向后兼容窗口**
   - `clawdi-agent` 镜像里 supervisor 进程名、Controller 端口 18789、`GATEWAY_AUTH_TOKEN` 派生逻辑不能短期改
   - 新功能通过**追加**而非修改现有接口；阶段 A-D 交错执行留出兼容窗口

### 中优先级

6. **Instance token 运行时消费者语义不明**
   - 代码（`entrypoint.sh`、`agent-image/controller/`）里找不到明确消费 `CLAWDI_INSTANCE_TOKEN` 的点——现状可能靠 SaaS 侧硬配置
   - 新设计不复用老假设，claim 流程从零定义，代码上不继承

7. **WebSocket 在企业代理环境通不过**
   - 部分自托管用户部署在企业内网，TLS terminate 后 WS 升级失败
   - SSE → Polling 降级必须做；MCP proxy 已经有 localhost 绕行的先例（`connectors.py:79`、`server.ts:62`）说明这类问题早已出现

8. **Scope 模型的 UX 复杂度**
   - 新手要理解：scope 实体、成员角色、资源归属、环境订阅、私有 vs 共享——概念比原 scope 标签多
   - Phase 1 只暴露"个人 scope"，降低初次接触成本；Phase 2 开分享前，Dashboard 要有专门的入门向导（"创建第一个 scope"、"发第一个邀请"）
   - CLI 默认不需要指定 scope（资源自动归为私有），保留"不碰 scope 也能正常用"的低门槛
   - 风险：文档和 error message 里 "scope / scope / Scope / 上下文" 混用会让用户困惑——**全文统一用 "scope"**（包括中文里也叫 "scope" 或 "Scope"，不再用 "scope" 这个词面向用户）

9. **Scope 共享的新增风险**（Codex 提醒）
   - **语义迁移摩擦**：字符串标签 → 实体，Dashboard 过滤器和 CLI 参数语义变了，文档与 UI 必须一次统一
   - **Memory 质量下降**：多作者共写的事实库，风格和粒度差异影响向量检索——`author_user_id` 字段允许检索时按 author 过滤兜底
   - **API key 粒度不足**：user-wide key + 缺少 env 绑定会让 ACL 在实现层失真——§4.1 的"请求必带 environment_id + 后端校验 token↔env 绑定"是硬性前提，不是 nice-to-have
   - **邀请邮箱-账号冲突**：CLI accept 必须显式报错"本地账号邮箱 ≠ 邀请邮箱"，不可静默绑错
   - **审计只记成功不记拒绝**的坑：ACL bug 排查会抓瞎——必须 `outcome=denied` 也入 `audit_events`

### 低优先级

10. **Self-host ops 负担**
    - 备份（Postgres + file store）、升级、监控不提供开箱方案
    - 出 `docs/operations.md` + `scripts/backup.sh` 脚手架，但不承诺 production-grade ops

11. **Migration 的密钥处理**
    - 老 clawdi 里 vault 用一个 master key 加密；迁到新系统要解密再重加密
    - 用户必须输入老 master key，否则 vault 迁不过来（新系统不存储老 key）
    - 文档里要明确警告

12. **Session 索引后台任务的可靠性**
    - MVP 用 `FastAPI BackgroundTasks`，无持久化队列；进程重启 = 未完成任务丢失
    - 切换到独立 worker（Celery / RQ）的阈值：DAU > 500 或每日 session 量 > 10k 时考虑
    - 过渡期：新增一个 `clawdi backend reindex` 管理命令扫描 `indexing_status=pending` 超 1 小时的 session 触发补偿

---

## 12. 后续

设计评审通过后，进入 `docs/superpowers/plans/` 写实施计划：

- Phase 1（OSS 奠基）的详细任务分解 + 验收点
- 每 phase 的 DB 迁移顺序（Alembic 分支图）
- 测试策略（单元 / 集成 / 端到端 / 真实数据迁移演练）
- 发布策略（OSS v1.0 tag 条件、changelog 模板）
