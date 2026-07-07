# scorekeeper 项目计划

## 目标

`scorekeeper` 是一个轻量级多人实时计分 Web 服务，面向朋友聚会、桌游、台球、羽毛球等低门槛场景。

核心目标：

- 通过场次 ID 快速创建、加入、继续计分场次；场次 ID 直接作为房间码。
- 支持管理员和普通玩家两种身份。
- 分数变化实时同步到所有打开页面。
- 所有分数变化写入历史事件，支持撤销最近一次操作。
- 使用 SQLite 持久化到 `data/scorekeeper.sqlite`。
- 使用 Docker 部署到 Ubuntu 云服务器，通过 `http://公网IP` 访问。

非目标：

- 不做账号系统。
- 不做 HTTPS 和域名绑定。
- 不做复杂权限、审计、多人协同冲突解决系统。
- 不引入重型 UI 框架或 TypeScript。

## 技术栈

- 后端：Node.js + Express
- 实时通信：Socket.IO
- 数据库：SQLite
- PIN 哈希：bcrypt
- 前端：React + Vite + 普通 CSS
- 部署：Docker + docker-compose
- 运行端口：容器内 `3000`，宿主机 `80:3000`

选择 Express 的原因：

- 足够简单。
- 社区成熟。
- 对静态托管 Vite 构建产物和 Socket.IO 集成直接。

## 项目结构

```text
scorekeeper/
  server/
    index.js
    db.js
    auth.js
    sessions.js
    sockets.js
  client/
    index.html
    package.json
    vite.config.js
    src/
      main.jsx
      App.jsx
      api.js
      socket.js
      styles.css
      pages/
        HomePage.jsx
        CreateSessionPage.jsx
        JoinSessionPage.jsx
        ScorePage.jsx
        HistoryPage.jsx
  data/
    .gitkeep
  Dockerfile
  docker-compose.yml
  .env.example
  README.md
  DEPLOY.md
  PLAN.md
  package.json
```

说明：

- 根目录 `package.json` 管理后端依赖和构建脚本。
- `client/` 是 Vite React 前端。
- 生产环境由 Express 托管 `client/dist`。
- SQLite 文件固定放在 `data/scorekeeper.sqlite`。
- `server/` 只拆最少模块，避免过度分层。

## 数据库设计

### sessions

保存计分场次。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 主键 |
| room_code | TEXT NOT NULL UNIQUE | 房间码，MVP 中直接使用 sessions.id 的字符串 |
| name | TEXT NOT NULL | 场次名称 |
| type | TEXT | 自定义场景类型，例如台球、羽毛球双打、桌游 |
| admin_pin_hash | TEXT NOT NULL | bcrypt 后的管理员 PIN |
| status | TEXT NOT NULL | active 或 finished |
| created_at | TEXT NOT NULL | ISO 时间 |
| updated_at | TEXT NOT NULL | ISO 时间 |

索引：

- `UNIQUE(room_code)`
- `INDEX(status)`
- `INDEX(updated_at)`

### players

保存场次中的玩家。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 主键 |
| session_id | INTEGER NOT NULL | 关联 sessions.id |
| name | TEXT NOT NULL | 玩家名称 |
| score | INTEGER NOT NULL DEFAULT 0 | 当前分数 |
| created_at | TEXT NOT NULL | ISO 时间 |
| updated_at | TEXT NOT NULL | ISO 时间 |

约束：

- `FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `UNIQUE(session_id, name)`

索引：

- `INDEX(session_id)`

### score_events

保存每次分数变化，用于历史和撤销。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 主键 |
| session_id | INTEGER NOT NULL | 场次 ID |
| operator_type | TEXT NOT NULL | admin 或 player |
| operator_player_id | INTEGER | 操作者玩家 ID，管理员操作时为空 |
| target_player_id | INTEGER NOT NULL | 被修改分数的玩家 ID |
| delta | INTEGER NOT NULL | 变化值 |
| score_before | INTEGER NOT NULL | 修改前分数 |
| score_after | INTEGER NOT NULL | 修改后分数 |
| created_at | TEXT NOT NULL | ISO 时间 |

约束：

- `FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE`
- `FOREIGN KEY(operator_player_id) REFERENCES players(id) ON DELETE SET NULL`
- `FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE CASCADE`

索引：

- `INDEX(session_id, id)`
- `INDEX(target_player_id)`

### 数据库初始化

后端启动时：

1. 确保 `data/` 存在。
2. 打开 `data/scorekeeper.sqlite`。
3. 执行建表迁移。
4. 开启 SQLite 外键：`PRAGMA foreign_keys = ON`。

MVP 阶段使用启动时建表即可，不单独引入迁移框架。

## 权限设计

### 身份类型

管理员：

- 通过场次 ID 和管理员 PIN 登录。
- PIN 只保存 bcrypt 哈希。
- 登录成功后前端保存轻量凭据到 `localStorage`。
- 可以添加玩家、删除玩家、修改任意玩家分数、重置、撤销、结束场次。

普通玩家：

- 通过场次 ID 加入。
- 选择已有玩家身份，或在允许的入口中由管理员添加玩家。
- 前端保存 `roomCode` 和 `playerId` 到 `localStorage`。
- 只能修改自己的分数。
- 可以查看所有玩家分数。

### 凭据策略

MVP 使用轻量 token：

- 管理员登录成功后，后端返回一个签名 token。
- 玩家加入成功后，后端返回一个签名 token。
- token 放在 `localStorage`，请求时通过 `Authorization: Bearer <token>` 发送。
- token 使用 `.env` 中的 `SESSION_SECRET` 签名。

说明：

- 这是朋友/局域/低风险场景，不是高安全账号系统。
- 后端仍必须校验 token 和权限，不能只依赖前端隐藏按钮。

### 权限校验规则

- 修改分数：
  - 管理员可以修改任意玩家。
  - 普通玩家只能修改自己的分数。
- 添加、删除玩家：
  - 仅管理员。
- 重置、撤销、结束场次：
  - 仅管理员。
- 查看场次：
  - 知道房间码即可查看。
- 已结束场次：
  - 默认仍可查看。
  - 继续计分时将状态改回 `active`，需要管理员权限。

## REST API 设计

统一响应格式：

成功：

```json
{
  "data": {}
}
```

失败：

```json
{
  "error": {
    "message": "错误信息"
  }
}
```

### POST /api/sessions

创建场次。

请求：

```json
{
  "name": "台球第1局",
  "type": "billiards",
  "adminPin": "1234",
  "players": ["小明", "小红"]
}
```

行为：

- 校验名称、PIN、玩家名。
- 生成唯一 `roomCode`。
- bcrypt 哈希管理员 PIN。
- 创建 session 和初始 players。
- 返回 session、players、管理员 token。

### GET /api/sessions/history

获取历史场次列表。

查询参数：

- `limit`，默认 50。

返回：

- roomCode
- name
- type
- status
- createdAt
- updatedAt
- playerCount

MVP 不做分页游标，超过需求再加。

### GET /api/sessions/:roomCode

获取场次详情。

返回：

- session 基本信息
- players 当前分数
- 最近若干 score_events，可选，默认不返回完整历史

### POST /api/sessions/:roomCode/join

普通玩家加入场次。

请求：

```json
{
  "playerId": 1
}
```

行为：

- 校验房间存在。
- 校验玩家属于该房间。
- 返回玩家 token。

### POST /api/sessions/:roomCode/admin-login

管理员登录。

请求：

```json
{
  "adminPin": "1234"
}
```

行为：

- bcrypt 校验 PIN。
- 返回管理员 token。

### POST /api/sessions/:roomCode/players

添加玩家，仅管理员。

请求：

```json
{
  "name": "新玩家"
}
```

行为：

- 校验管理员权限。
- 同一场次内玩家名不可重复。
- 新玩家初始分数为 0。
- 广播最新 session 状态。

### DELETE /api/sessions/:roomCode/players/:playerId

删除玩家，仅管理员。

行为：

- 校验管理员权限。
- 删除玩家。
- MVP 不允许删除已有 score_events 的玩家，避免历史事件外键复杂化。
- 如果必须删除有历史的玩家，先提示重置或保留玩家。
- 广播最新 session 状态。

### PATCH /api/sessions/:roomCode/players/:playerId/score

修改分数。

请求：

```json
{
  "delta": 1
}
```

行为：

- 校验身份和权限。
- 管理员可改任意玩家。
- 普通玩家只能改自己。
- 使用数据库事务：
  - 读取目标玩家当前分数。
  - 写入新分数。
  - 写入 score_events。
  - 更新 session.updated_at。
- 广播最新 session 状态。

### POST /api/sessions/:roomCode/undo

撤销最近一次分数操作，仅管理员。

行为：

- 找到该 session 最新一条 score_events。
- 将目标玩家分数恢复到 `score_before`。
- 删除该 score_event，或新增一条反向事件。

MVP 选择：删除被撤销的最近事件。

原因：

- 撤销语义简单。
- UI 只要求撤销最近一次分数操作。
- 不做完整审计系统。

### POST /api/sessions/:roomCode/reset

重置所有玩家分数，仅管理员。

行为：

- 所有玩家分数设为 0。
- 为每个分数变化的玩家写入一条 score_events，`delta = 0 - score_before`。
- 更新 session.updated_at。
- 广播最新 session 状态。

### POST /api/sessions/:roomCode/finish

结束场次，仅管理员。

行为：

- 将 session.status 设置为 `finished`。
- 广播最新 session 状态。

### POST /api/sessions/:roomCode/reopen

重新打开历史场次继续计分，仅管理员。

行为：

- 将 session.status 设置为 `active`。
- 广播最新 session 状态。

## Socket.IO 设计

### 房间规则

- 每个 `roomCode` 对应一个 Socket.IO room。
- 客户端进入计分页面后调用 `session:join` 加入房间。
- 服务端校验 roomCode 存在后执行 `socket.join(roomCode)`。

### 客户端发送事件

`session:join`

```json
{
  "roomCode": "1"
}
```

### 服务端广播事件

`session:updated`

触发场景：

- 分数变化
- 添加玩家
- 删除玩家
- 重置分数
- 撤销
- 结束场次
- 重新打开场次

数据：

```json
{
  "session": {},
  "players": []
}
```

### 同步策略

- REST API 是写入入口。
- Socket.IO 只负责通知和推送最新状态。
- 前端收到 `session:updated` 后直接替换本地页面状态。
- 页面刷新时仍通过 REST API 拉取当前状态。

## 前端页面设计

移动端优先：

- 单列布局。
- 大按钮。
- 玩家卡片便于手指点击。
- 不使用复杂 UI 框架。
- 普通 CSS，必要时使用 CSS grid/flex。

### 首页

路径：`/`

功能：

- 创建新场次入口。
- 输入房间码加入场次。
- 查看历史场次入口。

元素：

- 项目标题。
- 房间码输入框。
- “加入”按钮。
- “创建新场次”按钮。
- “历史场次”按钮。

### 创建场次页面

路径：`/create`

字段：

- 场次名称。
- 自定义场景类型。
- 管理员 PIN。
- 初始玩家列表。

交互：

- 可动态添加/删除玩家输入框。
- 提交后创建场次。
- 创建成功后保存管理员 token 到 `localStorage`。
- 跳转到计分页面。

### 加入场次页面

路径：`/join/:roomCode`

功能：

- 显示场次名称和房间码。
- 显示玩家列表，选择自己的名字进入。
- 提供管理员入口，输入 PIN 后进入。

交互：

- 普通玩家加入后保存玩家 token。
- 管理员登录后保存管理员 token。
- 跳转到计分页面。

### 计分页面

路径：`/sessions/:roomCode`

显示：

- 场次名称。
- 房间码。
- 状态。
- 所有玩家当前分数。

玩家卡片：

- 玩家名称。
- 当前分数。
- 加减分按钮：默认 `+1`、`-1`、`+5`、`-5`。
- 管理员看到所有玩家按钮。
- 普通玩家只在自己的卡片上看到按钮。

管理员操作：

- 添加玩家。
- 删除玩家。
- 撤销最近一次操作。
- 重置分数。
- 结束场次。
- 已结束场次可重新打开。

普通玩家：

- 查看所有分数。
- 修改自己的分数。

状态处理：

- 加载中。
- 房间不存在。
- 权限不足。
- 请求失败提示。
- Socket 断开时显示弱提示，但仍可通过 REST 操作。

### 历史场次页面

路径：`/history`

显示：

- 场次名称。
- 房间码。
- 类型。
- 创建时间。
- 更新时间。
- 玩家数量。
- 是否结束。

操作：

- 继续查看。
- 如果本地已有管理员 token，可直接进入计分页。
- 没有管理员 token 时，进入加入页面选择身份或管理员登录。

## 输入校验

后端校验：

- `name`：1 到 80 字符。
- `type`：允许为空或已知类型。
- `adminPin`：4 到 32 字符。
- `roomCode`：只允许大写字母和数字。
- `player.name`：1 到 30 字符。
- `delta`：整数，范围建议 `-9999` 到 `9999`。
- `playerId`：正整数。

前端校验：

- 提交前提示必填项。
- 禁止空玩家名。
- 禁止重复玩家名。
- 分数按钮只提交整数 delta。

后端错误码：

- `400` 输入错误。
- `401` 未登录或 token 无效。
- `403` 权限不足。
- `404` 房间或玩家不存在。
- `409` 名称冲突或状态冲突。
- `500` 服务端错误。

## 部署设计

### Dockerfile

构建流程：

1. 安装根目录后端依赖。
2. 安装 `client/` 前端依赖。
3. 构建 Vite 前端到 `client/dist`。
4. 启动 Node.js 服务。

运行时：

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_PATH=/app/data/scorekeeper.sqlite`

### docker-compose.yml

服务：

- `scorekeeper`

配置：

- `ports: "80:3000"`
- `volumes: ./data:/app/data`
- `env_file: .env`
- `restart: unless-stopped`

### .env.example

包含：

```text
NODE_ENV=production
PORT=3000
DATABASE_PATH=/app/data/scorekeeper.sqlite
SESSION_SECRET=change-me
```

## Ubuntu 部署步骤

`DEPLOY.md` 需要覆盖：

1. 安装 Docker 和 Docker Compose。
2. clone 仓库。
3. 复制环境变量文件：`.env.example` 到 `.env`。
4. 修改 `SESSION_SECRET`。
5. 创建数据目录：`mkdir -p data`。
6. 启动：`docker compose up -d --build`。
7. 访问：`http://公网IP`。
8. 查看日志：`docker compose logs -f`。
9. 停止服务：`docker compose down`。
10. 更新代码：
    - `git pull`
    - `docker compose up -d --build`
11. 备份数据库：
    - 复制 `data/scorekeeper.sqlite`。
12. 恢复数据库：
    - 停止服务。
    - 替换 `data/scorekeeper.sqlite`。
    - 重新启动服务。

## README 内容计划

`README.md` 需要包含：

- 项目用途。
- 功能列表。
- 技术栈。
- 本地开发方式。
- 生产构建方式。
- Docker 启动方式。
- 数据库位置说明。
- 轻量权限说明。
- 常见问题。

## 验证方式

### 手动验证

1. 创建新场次。
2. 使用房间码在另一个浏览器窗口加入。
3. 普通玩家只能修改自己的分数。
4. 管理员可以修改所有玩家分数。
5. 分数变化实时同步到另一个窗口。
6. 每次分数变化写入 `score_events`。
7. 撤销最近一次分数操作。
8. 重置所有分数。
9. 结束场次。
10. 在历史列表中找到场次。
11. 重新打开历史场次继续计分。
12. 重启容器后数据仍存在。

### 最小自动验证

MVP 保留少量后端自检或脚本，覆盖：

- 创建场次。
- 管理员登录。
- 普通玩家加入。
- 玩家不能修改别人分数。
- 管理员可以修改任意玩家分数。
- 分数事件被写入。
- 撤销恢复分数。

不引入复杂测试框架；如果项目已有 test runner，再接入它。

## 实施顺序

1. 初始化 Node.js + Express + Socket.IO 后端。
2. 初始化 SQLite 连接和建表。
3. 实现 session、player、score event 的核心 REST API。
4. 实现权限 token 和 bcrypt PIN 校验。
5. 实现 Socket.IO room 加入和状态广播。
6. 初始化 React + Vite 前端。
7. 实现首页、创建、加入、计分、历史页面。
8. 接入 Dockerfile、docker-compose、`.env.example`。
9. 编写 README.md 和 DEPLOY.md。
10. 完成手动验证和最小自动验证。

## MVP 边界

本项目第一版只实现朋友场景中真正需要的功能：

- 不做注册登录。
- 不做细粒度成员管理。
- 不做复杂事件时间线 UI。
- 不做 HTTPS。
- 不做 WebSocket 写操作。
- 不做跨设备身份同步。

需要更强安全性时，再增加正式账号、HTTPS、服务端 session、CSRF 防护和更严格审计。
