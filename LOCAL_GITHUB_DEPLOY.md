# 本地测试、上传 GitHub、服务器部署流程

本文档说明从本地运行 `scorekeeper` 到上传 GitHub，再到 Ubuntu 云服务器部署的完整命令。

## 0. 前提

本地需要安装：

- Node.js 22 或更新版本
- npm
- Git
- Docker Desktop，可选，用于本地 Docker 测试

服务器需要：

- Ubuntu
- 公网 IP
- TCP 80 端口已在云厂商安全组放行

## 1. 本地启动测试

进入项目目录：

```bash
cd scorekeeper
```

确认 Node 版本，必须是 22 或更新版本：

```bash
node -v
npm -v
```

如果显示的是 Node 18，例如 `v18.20.1`，请先升级 Node，否则会报：

```text
No such built-in module: node:sqlite
```

安装后端依赖：

```bash
npm install
```

安装前端依赖：

```bash
npm --prefix client install
```

构建前端：

```bash
npm run build
```

运行后端自检：

```bash
npm run smoke
```

启动本地服务：

```bash
npm start
```

浏览器访问：

```text
http://localhost:3000
```

本地测试建议：

1. 创建一个新场次。
2. 记住房间码。
3. 打开另一个浏览器窗口或无痕窗口。
4. 使用房间码加入。
5. 测试普通玩家只能修改自己的分数。
6. 测试管理员可以修改所有玩家分数。
7. 测试撤销、重置、结束场次、历史场次。

停止本地服务：

```bash
Ctrl+C
```

## 2. 本地 Docker 测试，可选

复制环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`，至少修改：

```text
SESSION_SECRET=换成一段随机字符串
```

启动 Docker：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost
```

查看日志：

```bash
docker compose logs -f
```

停止：

```bash
docker compose down
```

## 3. 上传到 GitHub

先确认当前文件：

```bash
git status
```

初始化 Git，若项目还没有初始化：

```bash
git init
```

添加文件：

```bash
git add .
```

提交：

```bash
git commit -m "Initial scorekeeper app"
```

在 GitHub 创建一个空仓库，例如：

```text
https://github.com/<你的用户名>/scorekeeper.git
```

绑定远程仓库：

```bash
git remote add origin https://github.com/<你的用户名>/scorekeeper.git
```

设置主分支并推送：

```bash
git branch -M main
git push -u origin main
```

如果远程仓库已经绑定过，使用：

```bash
git remote -v
git push
```

## 4. Ubuntu 服务器安装 Docker

登录服务器：

```bash
ssh <用户名>@<服务器公网IP>
```

安装 Docker：

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc > /dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

允许当前用户运行 Docker：

```bash
sudo usermod -aG docker $USER
```

退出并重新登录：

```bash
exit
ssh <用户名>@<服务器公网IP>
```

验证 Docker：

```bash
docker --version
docker compose version
```

## 5. 服务器下载并部署

下载代码：

```bash
git clone https://github.com/<你的用户名>/scorekeeper.git
cd scorekeeper
```

创建环境变量文件：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
nano .env
```

至少修改：

```text
SESSION_SECRET=换成一段随机字符串
```

创建数据目录：

```bash
mkdir -p data
```

启动服务：

```bash
docker compose up -d --build
```

查看容器状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

访问：

```text
http://<服务器公网IP>
```

## 6. 服务器开放 80 端口

如果访问不了，先确认云厂商安全组已放行：

```text
TCP 80
来源 0.0.0.0/0
```

如果服务器启用了 UFW：

```bash
sudo ufw allow 80/tcp
sudo ufw status
```

确认端口监听：

```bash
sudo ss -lntp | grep ':80'
```

## 7. 更新服务器代码

进入项目目录：

```bash
cd scorekeeper
```

拉取最新代码：

```bash
git pull
```

重新构建并启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker compose logs -f
```

## 8. 备份数据库

数据库文件位置：

```text
data/scorekeeper.sqlite
```

备份：

```bash
mkdir -p backups
cp data/scorekeeper.sqlite backups/scorekeeper-$(date +%Y%m%d-%H%M%S).sqlite
```

下载备份到本地：

```bash
scp <用户名>@<服务器公网IP>:~/scorekeeper/backups/<备份文件名>.sqlite .
```

## 9. 恢复数据库

停止服务：

```bash
docker compose down
```

覆盖数据库：

```bash
cp backups/<备份文件名>.sqlite data/scorekeeper.sqlite
```

重新启动：

```bash
docker compose up -d
```

## 10. 常见问题

### 端口 80 被占用

查看占用：

```bash
sudo ss -lntp | grep ':80'
```

如果已有 Nginx 或 Apache，需要先停止它，或修改 `docker-compose.yml` 的端口映射。

### docker compose up 失败

查看日志：

```bash
docker compose logs --tail=100
```

重新构建：

```bash
docker compose build --no-cache
docker compose up -d
```

### 数据没有保存

确认 `data` 目录存在：

```bash
ls -lah data
```

确认 `docker-compose.yml` 包含：

```yaml
volumes:
  - ./data:/app/data
```

### GitHub 推送需要登录

GitHub 现在通常需要 Personal Access Token，不能直接用账号密码。

推送时用户名填 GitHub 用户名，密码位置填 Token。
