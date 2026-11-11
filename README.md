# 辽东湾近岸海域智慧生态巡护与污染风险预警平台

面向海洋保护区管理、岸线生态巡查和基层海洋环境监管的一体化平台，覆盖：

- 海洋生态地图：GIS 态势、环境监测、港口/养殖区/保护区图层与动态追踪；
- 污染风险预警：多因子风险评分、风险分级、趋势与预警转处置；
- 海洋问题上报：巡护人员与公众图片、定位、文字上报；
- 事件处理闭环：审核、分派、现场处置、复核、归档全过程留痕；
- 统计分析看板：问题类型、区域分布、处理时效和风险趋势。

项目采用“一套前端、两种运行模式”：

| 运行模式 | 数据存储 | 适用场景 |
| --- | --- | --- |
| GitHub Pages 静态演示 | 浏览器 `localStorage` | 在线展示、产品答辩、无服务器演示 |
| 服务器模式 | SQLite + 持久化图片目录 | 内部试点、局域网或云服务器部署 |

前端会自动检测同域 `/api/health`。检测成功时写入服务器数据库；纯静态部署时自动降级为浏览器本地演示数据。

## GitHub Pages 部署

1. 新建 GitHub 仓库，将本项目中除 `server/`、`data/`、`uploads/` 外的工程文件上传到仓库；也可以直接解压 `辽东湾智慧生态巡护平台_GitHub网页版.zip` 后上传。
2. 打开仓库 `Settings > Pages`，在 `Build and deployment` 中将 Source 选择为 `GitHub Actions`。
3. 推送到 `main` 分支后，工作流 `.github/workflows/pages.yml` 会自动发布 `docs/`。
4. 完成后访问 `https://<用户名>.github.io/<仓库名>/`。

静态模式的所有变更只保存在当前浏览器，不会同步给其他访问者。清除浏览器数据后会恢复初始演示数据。

### 每日监测数据刷新

`.github/workflows/pages.yml` 已配置每日定时任务，北京时间每天约 07:10 执行以下流程：

1. 运行 `scripts/update_map_data.py`；
2. 更新 `docs/data.json` 并自动提交到仓库；
3. 重新构建和发布 GitHub Pages。

没有配置远程数据源时，脚本会按当天日期稳定生成一组新的模拟监测数据，并在页面标注“模拟点位”。接入真实数据时，在仓库 `Settings > Secrets and variables > Actions > Variables` 中添加：

```text
MAP_DATA_SOURCE_URL=https://你的数据接口地址
```

接口应返回监测站数组，或返回 `{ "stations": [...] }`；记录以 `id` 与平台内置站点匹配，可提供 `water_temp_c`、`salinity_psu`、`dissolved_oxygen_mg_l`、`ph`、`turbidity_ntu`、`chlorophyll_a`、`lat`、`lng`、`updated_at` 等字段。远程请求失败时，工作流会保留可用的模拟数据，不会中断页面发布。

### 在线地图配置

页面使用 Leaflet 加载真实可缩放、可拖动的海域底图，所有监测站、风险区、港口、保护区、养殖区和生态问题均按经纬度叠加并可点击查看总结卡片。

在 `docs/assets/config.js` 中填写天地图浏览器端密钥：

```js
tdtKey: "你的天地图密钥"
```

同时需要在天地图开发者控制台配置 GitHub Pages 域名白名单，例如 `https://<用户名>.github.io`。密钥为空或天地图不可用时，页面自动切换到 OpenStreetMap；在线底图完全不可用时，才使用内置本地示意地图。

当前 `docs/data.json` 中的监测站和事件坐标均为平台验证用模拟点位，不代表官方实时监测站、事故位置或权属边界。

## 服务器部署

### 方式一：Docker Compose（推荐）

服务器需安装 Docker 与 Docker Compose，然后执行：

```bash
unzip 辽东湾智慧生态巡护平台_服务器部署版.zip -d ecoguard
cd ecoguard
cp .env.example .env
docker compose up -d --build
```

浏览器打开 `http://服务器IP:8000`。健康检查地址为 `http://服务器IP:8000/api/health`。

默认使用两个 Docker 数据卷，容器重建不会丢失数据：

- `ecoguard-liaodong-bay-data`：SQLite 数据库与审计记录；
- `ecoguard-liaodong-bay-uploads`：事件现场图片。

常用命令：

```bash
docker compose logs -f
docker compose restart
docker compose down
```

不要使用 `docker compose down -v`，该命令会删除数据卷。

### 方式二：Python 直接运行

要求 Python 3.10 或更高版本，无需安装第三方依赖。

Linux：

```bash
chmod +x scripts/start.sh scripts/backup.sh
PORT=8000 ./scripts/start.sh
```

Windows PowerShell：

```powershell
.\scripts\start.ps1 -Port 8000
```

默认数据目录为 `data/`，图片目录为 `uploads/`。请将这两个目录纳入服务器备份。

服务器版可每天执行一次前端地图数据刷新：

```bash
python3 scripts/update_map_data.py
```

可使用 Linux `cron` 或 Windows 任务计划程序定时运行。如果接入远程数据接口，先设置 `MAP_DATA_SOURCE_URL` 环境变量；接口不可用时会保留本地模拟数据。刷新脚本只更新 `docs/data.json`，不会覆盖服务器 SQLite 中的事件和预警数据。

### Nginx 与 systemd

`deploy/nginx.conf` 提供反向代理示例，`deploy/ecoguard.service` 提供 systemd 服务示例。直接部署到 `/opt/ecoguard` 时：

```bash
sudo useradd --system --home /opt/ecoguard --shell /usr/sbin/nologin ecoguard
sudo chown -R ecoguard:ecoguard /opt/ecoguard
sudo cp deploy/ecoguard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ecoguard
sudo cp deploy/nginx.conf /etc/nginx/conf.d/ecoguard.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 数据接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 服务健康状态 |
| GET | `/api/events` | 事件列表 |
| GET | `/api/alerts` | 风险预警列表 |
| POST | `/api/events` | 新建上报事件 |
| PATCH | `/api/events/{id}/transition` | 审核、分派、提交结果、归档 |
| PATCH | `/api/events/{id}/assign` | 调整责任单位和负责人 |
| POST | `/api/alerts/{id}/dispatch` | 风险预警生成处置事件 |

服务器首次启动会自动写入 24 条模拟事件和 8 条风险预警。后续启动不会覆盖现有数据。

## 数据备份与恢复

Linux 可使用：

```bash
./scripts/backup.sh /path/to/backups
```

Docker 部署可分别备份两个数据卷，或进入容器/临时容器将 `/app/data` 与 `/app/uploads` 打包。恢复时停止服务，将备份内容放回对应目录或数据卷后再启动。

## 上线前注意

- 当前版本定位为原型和试点，未内置账号、角色权限与操作员认证。公网部署前应在 Nginx 增加 Basic Auth，或接入单位统一身份认证/单点登录。
- 生产环境应配置 HTTPS、防火墙、定期备份和日志留存策略。
- 风险评分与统计洞察为演示模型，正式业务使用前需由海洋环境业务人员校准权重与阈值。
- 服务器模拟数据与公开环境数据用于功能验证，接入浮标、无人船、遥感和巡护终端时，应在服务端增加数据接入适配层。
- 天地图密钥仅配置在部署环境中，不要将个人或单位密钥提交到公开代码仓库。

## 技术说明

- 前端：原生 HTML、CSS、JavaScript，无构建步骤，兼容 GitHub Pages；
- 服务端：Python 标准库 HTTP 服务，无第三方依赖；
- 数据库：SQLite，WAL 模式，包含事件、预警和审计日志表；
- 图片：服务端解码并校验 JPEG、PNG、WebP、GIF，存储于持久化目录；
- 部署：Docker Compose、systemd、Nginx。
