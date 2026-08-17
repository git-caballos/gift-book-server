# 电子礼簿系统（服务端多用户版）

> 本项目由开源项目 **[gift-book](https://github.com/jingguanzhang/gift-book)**（纯本地单页版）fork 重构而来：在**保留原版全部功能与加密模型**的基础上，新增 **Node.js + SQLite 服务端**与**多用户账号体系**，事项数据与原版 **bin 加密备份双向兼容**，可无缝迁移。

一款为各类红白喜事提供现代化、安全、高效的礼金（份子钱）管理解决方案。支持多用户注册登录、一账号多事项，账号间数据完全隔离；礼金明细全程加密（详见「数据安全」），服务端无法读取明文。

<img width="800" height="437" alt="image" src="https://github.com/user-attachments/assets/8a84a4de-8696-49c8-bfda-27c8cdb393c3" />

> **严正声明**
>
> 本项目开源仅供**个人学习、研究或自用**。
> **严禁任何形式的商业转售**（包括但不限于直接出售源码、打包倒卖、二次封装收费等）。

## 核心特性

### 多用户账号体系

- **注册 / 登录**：账号 + 用户名 + 密码，账号唯一、用户名可重复；密码服务端 bcrypt 哈希存储。
- **JWT 会话**：登录后签发默认 **7 天有效**的 JWT，刷新页面、切换事项、返回首页均保持登录态，仅「退出登录」回到登录页。
- **登录失败锁定**：连续登录失败超过 `LOGIN_MAX_FAILS`（默认 5）次后，该账号锁定 `LOGIN_LOCK_MINUTES`（默认 15）分钟，防止暴力破解。
- **一账号多事项**：每个账号可创建和管理多个事项，事项归属账号、互不干扰。
- **注册开关**：`.env` 中 `REGISTRATION_ENABLED` 一键控制注册接口与前端注册入口的开启 / 关闭。

### 数据安全

- **金融级加密（信封加密模型，借鉴 Bitwarden）**：礼金明细在浏览器端以 **AES-256** 加密后上传，**服务端只存密文**。即便数据库泄露、文件被拷走，礼金明细也无法还原。
- **修改密码 O(1) 秒级完成**：改密时仅用新密码派生的 KEK 重新包裹 DEK（一个密钥块），**无需遍历/重写任何礼金记录**；改密、密钥重包裹与令牌吊销在同一事务内完成。
- **旧数据迁移走 BIN 导入导出**：历史数据请使用 BIN 备份导入导出迁移（各版本备份格式双向兼容），无需旧库升级。
- **越权防护**：所有事项与礼金接口均按用户归属校验，无法访问他人数据。

### 与原版双向兼容

- **原版 → 本系统**：原版导出的 bin 加密备份，导入时输入**原事项密码**即可完整还原，数据自动改用当前账号数据密钥（DEK）加密保存。
- **本系统 → 原版**：本系统导出的 bin 加密备份，在原版中导入时输入导出时设置的密码即可还原，双向互通。
- **JSON 备份**：支持导出明文 JSON，不提供 JSON 导入；恢复数据请使用 bin 加密备份。

### 专业级记录与报表（原版功能全部保留）

- **秒级记账**：姓名、金额、渠道（微信/支付宝/现金）全键盘操作，回车即录。
- **智能风控**：实时检测重名、重复金额，防止「记重了、记错了」；金额自动转中文大写（壹仟元整）。
- **语音播报**：TTS 语音朗读（"张三 贺礼 一千元整"），方便宾客现场核对金额。
- **访客副屏**：实时投射数据到外接屏幕/电视，隐私脱敏、收款码展示；主页面刷新后副屏自动重连。
- **真·PDF 引擎**：内置 PDF-Lib 渲染器，支持自定义字体、封面图、背景纹理；记录超 1008 条（84 页）时自动分批打印/导出，防止渲染卡死。
- **Excel 导出**：标准 `.xlsx` 报表，含完整修改日志。
- **双重备份**：JSON 明文备份 + BIN 加密备份（导出时设置导出密码，导入时需输入该密码，可跨版本互通）。
- **批量导入/删除**：礼金批量导入与删除走**单事务批量接口**（一次请求完成，任一条失败整体回滚），导入自动分批提交避免单请求过大。
- **从备份新建事项**：首页可直接选择一个 BIN 加密备份，解密后创建为全新的独立事项并导入全部礼金，不影响现有事项。
- **导出数据提醒**：事项结束日期过后若尚未导出过数据，自动提醒尽快导出 Excel / PDF / 备份文件，防止活动结束数据丢失。
- **免密验证**：敏感操作（改礼金、作废、补录、删事项等）验证账号密码时可勾选「5 分钟内不再校验」，兼顾安全与高频录入体验。
- **本地离线版（`local.html`）**：纯浏览器本地存储实现，开箱即用。
- **审计留痕**：全链路修改历史时间轴，支持软删除（作废），每一笔变动有迹可循。
- **双色主题**：内置「喜庆红（喜事）」与「肃穆灰（白事）」两套皮肤，适应红白喜事不同场景。

***

## 界面预览

<img width="1330" height="1067" alt="image" src="https://github.com/user-attachments/assets/ecd3e44a-a7f6-465c-899a-87485435ef96" />
<img width="1118" height="787" alt="image" src="https://github.com/user-attachments/assets/a7975e91-b302-4a1c-8345-761c8739269d" />
<img width="1121" height="788" alt="image" src="https://github.com/user-attachments/assets/5c001e4b-5a8e-496c-ab34-09485c2e1e25" />
## 开发者指南

本项目前端原生基于 **Vanilla JS + HTML** 开发，核心代码内嵌于单页应用；后端基于 **Node.js + Express + SQLite**，结构简单、依赖极少。

### 1. 获取代码 (Git)

首先将仓库克隆到本地：

```bash
# 克隆项目
git clone https://github.com/git-caballos/gift-book-server.git

# 进入目录
cd gift-book-server
```

### 2. 环境准备

需要 **Node.js 18.11+** 运行时（`npm run dev` 依赖 `node --watch`，推荐 20 LTS 或更高；npm 随 Node 自带），以及一个代码编辑器（推荐 **VS Code**）和一个现代浏览器（Chrome/Edge）。其余依赖（Express、better-sqlite3 等）均由 `npm install` 自动安装，无需额外手动配置。

### 3. 启动开发

本项目前端为纯静态单页应用（`client/index.html`，另有本地离线版 `client/local.html` 与访客副屏 `client/guest-screen.html`），由后端 Express 统一托管（`SERVE_STATIC=true`，自动挂载 `/`、`/index.html`、`/local.html`、`/guest-screen.html` 与 `/static/*`），**无需单独启动静态服务器**：

```bash
# 进入后端目录
cd server

# 安装依赖
npm install

# 配置环境变量：首次运行必须创建 server/.env，内容参考下方示例
```

```bash
# JWT 签名密钥（必配，≥32 位随机字符串；若被泄露请重新生成）
JWT_SECRET=60a4acd1796···(请自行替换)
# JWT 有效期：默认 7d，支持 jsonwebtoken 格式（如 2h、7d、30m、3600s）
# JWT_EXPIRES_IN=7d
# 服务端口（应用读取 SERVER_PORT）：默认 8080
# SERVER_PORT=8080
# 开启注册功能：默认关闭
# REGISTRATION_ENABLED=true
# 是否托管前端静态文件：默认开启
# SERVE_STATIC=false
# 跨域白名单（精确匹配 协议://主机[:端口]，逗号分隔多域名；同源托管无需配置）
# CORS_ORIGINS=https://app.gift-book-server.com
# CORS 放行模式（允许任意来源跨域，仅限开发调试/演示，生产请保持关闭）
# CORS_OPEN_MODE=false
# 登录失败锁定：连续失败超过 LOGIN_MAX_FAILS 次后锁定 LOGIN_LOCK_MINUTES 分钟（内存版，重启后重置）
# LOGIN_MAX_FAILS=5
# LOGIN_LOCK_MINUTES=15
```

生成随机密钥：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

启动开发（文件变更自动重启）：

```bash
npm run dev
```

浏览器访问 <http://localhost:8080> 即可使用；数据库文件自动生成于 `server/data/gift.db`（无需手工初始化）。前端默认**同源模式**（`client/static/config.js` 中 `API_BASE_URL` 留空，请求自动走后端托管地址）；若以静态方式在非 8080 端口预览（如 IDE 预览 5500），需将 `API_BASE_URL` 改为 `http://localhost:8080` 才能调通后端。

### 4. 项目结构

```
.                        # 项目根目录
├── client/              # 前端（原生单页应用，核心代码内嵌 HTML）
│   ├── index.html       # 主入口（在线版，配合后端多用户使用）
│   ├── local.html       # 本地离线版（纯浏览器 IndexedDB 本地存储，无需后端）
│   ├── guest-screen.html  # 访客副屏显示页面
│   └── static/          # 静态资源目录
│       ├── config.js    # 运行时配置（API 后端地址，部署时修改）
│       ├── tailwindcss.js   # 样式引擎
│       ├── xlsx.full.min.js # Excel 导出库
│       ├── pdf-lib.min.js   # PDF 生成引擎
│       ├── GiftListPDFGenerator.js  # 自定义 PDF 渲染器（封面/字体/纹理）
│       ├── crypto-js.min.js # 加密库（客户端 AES-256）
│       ├── fontkit.umd.min.js & *.ttf  # 字体文件（用于 PDF 生成）
│       └── gridjs.umd.js / remixicon / pell / mermaid.min.css / 主题图片等
└── server/              # Node.js 后端
│   ├── .env             # 环境变量（JWT 密钥、端口、注册开关、跨域等）
│   ├── package.json
│   ├── data/
│   │   └── gift.db      # SQLite 数据库（自动生成）
│   └── src/
│       ├── index.js     # 服务入口：API 路由 + 静态托管 + CORS
│       ├── db.js        # SQLite 连接与建表（自动创建 data 目录）
│       ├── auth.js      # 密码哈希 / JWT 鉴权中间件
│       ├── routes/      # auth / events / gifts 路由
│       └── services/    # 事项、礼金业务逻辑（camelCase DTO + 归属校验）
```

### 5. 部署上线

本项目需要 **Node.js 运行时**，前端无需构建、源码即产物。支持**同源托管**与**前后端分离**两种部署方式，前端指向后端的地址与端口均由配置文件手动指定。

**方式一：同源托管（推荐，单机）**——后端 `SERVE_STATIC=true`（默认）同时托管前端，单端口即可访问、无跨域问题：

```bash
# 服务器上
cd server
npm install --production

# 配置 server/.env（JWT_SECRET 必配，详见「部署注意事项」）
npm start
```

- 前端 `client/static/config.js` 的 `API_BASE_URL` 默认空字符串（同源托管，请求自动走后端托管地址，无需修改）；前后端分离部署时须改为后端正式地址；
- `.env` 中 `SERVE_STATIC` 保持 `true`（默认）即可，启动日志会显示"托管模式: 已开启（托管前端）"；
- 建议使用 PM2 / systemd 守护进程保持服务常驻；
- 迁移时备份 `server/data/` 目录即可。

**方式二：前后端分离部署**——前端部署于独立静态服务器 / CDN，后端仅提供 API：

1. **后端**：按方式一部署，并在 `.env` 中配置 `SERVE_STATIC=false`（纯后端模式）、`SERVER_PORT`（后端端口）与 `CORS_ORIGINS`（放行前端域名）；
2. **前端**：将 `client/` 目录（`index.html`、`local.html`、`guest-screen.html`、`static/`）上传至任意静态服务器（Nginx / Vercel / 对象存储等）；
3. **配置**：编辑前端 `client/static/config.js`，将 `API_BASE_URL` 设为后端完整地址（如 `https://api.example.com`）。

### 6. 原版数据迁移

1. 在**原版**中导出 bin（或 JSON）备份。
2. 在本系统登录账号并进入目标事项，使用「导入备份」。
3. bin 文件输入**原事项密码**即可解密导入。

***

## 部署注意事项

- **JWT 密钥（必配）**：首次部署必须配置 `JWT_SECRET`（≥32 位随机字符串）。**未配置时服务直接启动失败**（提示生成命令），避免所有认证/受保护 API 在运行时返回 500。
- **JWT 有效期**：默认 7 天，可用 `JWT_EXPIRES_IN` 调整，支持带单位格式（`2h`、`7d`、`30m`、`3600s`）。注意：环境变量读入均为字符串，纯数字（如 `3600`）会被按**毫秒**解析（等于 3.6 秒），秒数请带 `s` 单位。
- **服务端口（可选）**：默认 `8080`；如需修改可在 `server/.env` 中配置 `SERVER_PORT`（如 `SERVER_PORT=3000`）。配置值非纯数字或超出 1-65535 范围时服务启动失败并提示。
- **前端托管（SERVE\_STATIC）**：默认 `true`，后端托管前端页面（同源访问）；前后端分离部署时设为 `false`（纯后端模式）。
- **跨域（CORS）**：同源托管不涉及跨域，无需配置；前后端分离部署时，须将前端域名按 **`协议://主机[:端口]`** **精确匹配**加入 `CORS_ORIGINS`（逗号分隔，如 `https://app.example.com`，默认端口可省略；协议不同即视为不同来源），其余外部来源一律拒绝。另有 `CORS_OPEN_MODE=true` 放行模式（允许任意来源跨域，仅限开发调试 / 对外演示，生产环境请保持关闭）。
- **登录失败锁定**：连续登录失败超过 `LOGIN_MAX_FAILS`（默认 5）次后锁定 `LOGIN_LOCK_MINUTES`（默认 15）分钟；为内存版，重启后重置。
- **前端地址配置**：同源托管无需配置；前后端分离部署时，前端请求后端的地址在 `client/static/config.js` 的 `API_BASE_URL` 中指定（后端端口在 `server/.env` 的 `SERVER_PORT`），两者均手动配置、无自动识别。
- **数据持久化**：所有数据存于 `server/data/`，迁移部署时备份该目录即可。

***

## 技术栈

- **Core**：Vanilla JS (ES6+)，OOP 架构
- **Backend**：Node.js、Express、cors、dotenv、better-sqlite3（SQLite，WAL 模式）
- **Auth**：@sajibjashore/easy-auth（密码哈希 / 令牌签发 / 校验）
- **Style**：Tailwind CSS
- **Crypto**：WebCrypto（PBKDF2 密钥派生）+ CryptoJS（AES-256，客户端加密，服务端只存密文）
- **Export**：SheetJS（Excel）、PDF-Lib & Fontkit（客户端 PDF 生成）
- **UI**：Grid.js（表格）、RemixIcon（图标）

***

## 免责声明

请妥善保管账号密码与 JWT 密钥（`server/.env`），忘记密码将无法找回加密数据。

数据无价，活动结束后，请立即使用 **导出 Excel / PDF / 备份文件** 功能将数据保存到安全的地方。

**开发者不对因使用本应用造成的任何数据丢失承担责任。**
