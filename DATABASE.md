# 数据库说明

`scorekeeper` 使用 SQLite 保存数据。数据库文件默认位于：

```text
data/scorekeeper.sqlite
```

Docker 部署时，宿主机目录 `./data` 会挂载到容器内 `/app/data`，所以数据库文件会持久化保存。

## 1. 使用方式

后端启动时会自动：

1. 创建 `data/` 目录。
2. 打开 SQLite 数据库文件。
3. 启用外键：

```sql
PRAGMA foreign_keys = ON;
```

4. 如果表不存在，则自动创建表。

不需要手动初始化数据库。

## 2. 表结构

数据库包含三张核心表：

- `sessions`：计分场次
- `players`：场次中的玩家
- `score_events`：分数变化记录

## 3. sessions 表

保存每一个计分场次。

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT,
  admin_pin_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| id | 自增主键 |
| room_code | 房间码；当前版本直接使用 `id` 的字符串，例如 `1` |
| name | 场次名称，例如“台球第1局” |
| type | 自定义场景类型，例如“台球”“羽毛球双打” |
| admin_pin_hash | bcrypt 哈希后的管理员 PIN |
| status | 场次状态，`active` 或 `finished` |
| created_at | 创建时间，ISO 字符串 |
| updated_at | 更新时间，ISO 字符串 |

索引：

```sql
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
```

## 4. players 表

保存每个场次中的玩家。

```sql
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE(session_id, name)
);
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| id | 自增主键 |
| session_id | 所属场次 ID |
| name | 玩家名称 |
| score | 当前分数 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

约束：

- 同一个场次内，玩家名称不能重复。
- 删除场次时，该场次的玩家会一起删除。

索引：

```sql
CREATE INDEX idx_players_session_id ON players(session_id);
```

## 5. score_events 表

保存每一次分数变化。

```sql
CREATE TABLE score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  operator_type TEXT NOT NULL,
  operator_player_id INTEGER,
  target_player_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  score_before INTEGER NOT NULL,
  score_after INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(operator_player_id) REFERENCES players(id) ON DELETE SET NULL,
  FOREIGN KEY(target_player_id) REFERENCES players(id) ON DELETE CASCADE
);
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| id | 自增主键 |
| session_id | 所属场次 ID |
| operator_type | 操作者类型，`admin` 或 `player` |
| operator_player_id | 操作者玩家 ID；管理员操作时为空 |
| target_player_id | 被修改分数的玩家 ID |
| delta | 分数变化值 |
| score_before | 修改前分数 |
| score_after | 修改后分数 |
| created_at | 操作时间 |

索引：

```sql
CREATE INDEX idx_score_events_session_id ON score_events(session_id, id);
CREATE INDEX idx_score_events_target_player_id ON score_events(target_player_id);
```

## 6. 核心数据流程

### 创建场次

写入：

1. `sessions`
2. 初始玩家写入 `players`

当前版本中，创建成功后会把 `sessions.id` 写回 `room_code`。

示例：

```text
id = 1
room_code = "1"
```

用户看到的房间码就是 `1`。

### 加入场次

读取：

1. 根据 `room_code` 查询 `sessions`
2. 查询该场次下的 `players`

普通玩家选择一个玩家身份进入，不会新增数据库记录。

### 修改分数

写入发生在一个事务中：

1. 查询目标玩家当前分数。
2. 更新 `players.score`。
3. 写入一条 `score_events`。
4. 更新 `sessions.updated_at`。

支持两种修改方式：

```json
{ "delta": 5 }
```

表示在当前分数上加 5。

```json
{ "score": 12 }
```

表示直接把分数设为 12。

无论哪种方式，都会记录成一次 `score_events`。

### 撤销

撤销最近一次分数操作：

1. 查询当前场次最新一条 `score_events`。
2. 把目标玩家分数恢复到 `score_before`。
3. 删除这条 `score_events`。
4. 更新 `sessions.updated_at`。

当前版本选择“删除被撤销事件”，不是写入反向事件。

### 重置分数

管理员重置时：

1. 查询当前场次所有玩家。
2. 将非 0 分数改为 0。
3. 每个被改变的玩家写入一条 `score_events`。
4. 更新 `sessions.updated_at`。

### 结束场次

只更新：

```sql
UPDATE sessions SET status = 'finished'
```

玩家和分数事件都会保留。

## 7. 常用查询

进入 SQLite：

```bash
sqlite3 data/scorekeeper.sqlite
```

查看所有表：

```sql
.tables
```

查看表结构：

```sql
.schema sessions
.schema players
.schema score_events
```

查看历史场次：

```sql
SELECT id, room_code, name, type, status, created_at, updated_at
FROM sessions
ORDER BY updated_at DESC;
```

查看某个场次的玩家：

```sql
SELECT id, name, score
FROM players
WHERE session_id = 1
ORDER BY id;
```

查看某个场次的分数变化：

```sql
SELECT id, operator_type, operator_player_id, target_player_id,
       delta, score_before, score_after, created_at
FROM score_events
WHERE session_id = 1
ORDER BY id DESC;
```

统计每个场次玩家数量：

```sql
SELECT s.id, s.name, COUNT(p.id) AS player_count
FROM sessions s
LEFT JOIN players p ON p.session_id = s.id
GROUP BY s.id
ORDER BY s.updated_at DESC;
```

## 8. 备份数据库

推荐在服务器上执行：

```bash
mkdir -p backups
cp data/scorekeeper.sqlite backups/scorekeeper-$(date +%Y%m%d-%H%M%S).sqlite
```

如果服务正在高频写入，建议先停服务再备份：

```bash
docker compose down
cp data/scorekeeper.sqlite backups/scorekeeper-$(date +%Y%m%d-%H%M%S).sqlite
docker compose up -d
```

## 9. 恢复数据库

停止服务：

```bash
docker compose down
```

替换数据库文件：

```bash
cp backups/<备份文件名>.sqlite data/scorekeeper.sqlite
```

重新启动：

```bash
docker compose up -d
```

## 10. 注意事项

- 不要把 `data/scorekeeper.sqlite` 提交到 GitHub。
- `.gitignore` 已经忽略 `data/*.sqlite`。
- `admin_pin_hash` 是哈希值，不是原始 PIN，无法反查原始 PIN。
- 如果忘记某个场次的管理员 PIN，当前版本没有找回功能。
- 手动改数据库前建议先备份。
