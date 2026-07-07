# scorekeeper

轻量级多人实时计分 Web 服务，适合朋友聚会、桌游、台球、羽毛球等场景。

## 功能

- 创建独立计分场次，场次 ID 就是房间码。
- 玩家通过房间码，也就是场次 ID 加入。
- 管理员 PIN 使用 bcrypt 哈希保存。
- 管理员可添加/删除玩家、修改任意分数、撤销、重置、结束和重新打开场次。
- 普通玩家只能修改自己的分数。
- 所有人都能查看完整比分。
- 分数变化通过 Socket.IO 实时同步。
- 每次分数变化写入 `score_events`。
- SQLite 数据库持久化到 `data/scorekeeper.sqlite`。

## 技术栈

- Node.js
- Express
- Socket.IO
- SQLite
- React + Vite
- Docker + docker-compose

本地直接运行需要 Node.js 22 或更新版本，因为服务端使用 Node 自带的 SQLite 模块。

## 本地开发

```bash
node -v
npm install
npm --prefix client install
npm run dev
```

另开一个终端启动前端开发服务器：

```bash
npm --prefix client run dev
```

访问 Vite 输出的本地地址。前端会把 `/api` 和 `/socket.io` 代理到后端 `3000` 端口。

## 生产构建

```bash
npm install
npm --prefix client install
npm run build
npm start
```

访问：

```text
http://localhost:3000
```

## Docker 运行

```bash
cp .env.example .env
docker compose up -d --build
```

访问：

```text
http://服务器公网IP
```

## 数据库

默认数据库路径：

```text
data/scorekeeper.sqlite
```

Docker 部署时，`./data` 会挂载到容器内 `/app/data`，容器重建不会丢数据。

## 权限说明

这是朋友/局域/低风险场景的轻量权限模型：

- 管理员 PIN 不明文保存。
- 登录后的 token 保存在浏览器 `localStorage`。
- 后端 API 会校验权限。
- 这不是高安全账号系统；公网使用时请设置足够随机的 `SESSION_SECRET` 和不易猜的管理员 PIN。

## 自检

```bash
npm run smoke
```

该脚本会启动临时服务和临时 SQLite 数据库，验证创建场次、登录、权限、计分和撤销。
