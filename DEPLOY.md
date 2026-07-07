# Ubuntu 云服务器部署

目标：通过 `http://公网IP` 访问 scorekeeper，不需要域名和 HTTPS。

## 1. 安装 Docker

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

允许当前用户使用 Docker：

```bash
sudo usermod -aG docker $USER
```

重新登录服务器后生效。

## 2. 获取代码

```bash
git clone <你的仓库地址> scorekeeper
cd scorekeeper
```

## 3. 配置环境变量

```bash
cp .env.example .env
nano .env
```

至少修改：

```text
SESSION_SECRET=换成一段足够随机的字符串
```

## 4. 创建数据目录

```bash
mkdir -p data
```

数据库会保存到：

```text
data/scorekeeper.sqlite
```

## 5. 启动服务

```bash
docker compose up -d --build
```

访问：

```text
http://公网IP
```

如果云厂商有安全组，请放行 TCP 80 端口。

## 6. 查看日志

```bash
docker compose logs -f
```

## 7. 停止服务

```bash
docker compose down
```

## 8. 更新代码

```bash
git pull
docker compose up -d --build
```

## 9. 备份数据库

```bash
mkdir -p backups
cp data/scorekeeper.sqlite backups/scorekeeper-$(date +%Y%m%d-%H%M%S).sqlite
```

## 10. 恢复数据库

先停止服务：

```bash
docker compose down
```

替换数据库：

```bash
cp backups/你的备份文件.sqlite data/scorekeeper.sqlite
```

重新启动：

```bash
docker compose up -d
```

## 11. 常用排查

查看容器状态：

```bash
docker compose ps
```

确认端口监听：

```bash
sudo ss -lntp | grep ':80'
```

查看最近日志：

```bash
docker compose logs --tail=100
```
