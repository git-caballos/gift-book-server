require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const giftRoutes = require('./routes/gifts');

const app = express();

// 服务端口：默认 8080，可通过 .env 中的 SERVER_PORT 覆盖（须为 1-65535 的纯数字）
const SERVER_PORT = (process.env.SERVER_PORT || '8080').trim();

if (!/^\d{1,5}$/.test(SERVER_PORT)) {
  console.error(`错误：SERVER_PORT 格式错误（当前值: "${SERVER_PORT}"，必须为纯数字）`);
  process.exit(1);
}

const portNum = Number(SERVER_PORT);
if (portNum < 1 || portNum > 65535) {
  console.error(`错误：SERVER_PORT 超出范围（当前值: ${portNum}，有效范围: 1-65535）`);
  process.exit(1);
}

// JWT 密钥（必配）：缺失或长度不足 32 位时直接启动失败。
// 弱密钥可被暴力猜测后伪造认证令牌，构成完整账号接管
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.trim().length < 32) {
  console.error('错误：JWT_SECRET 未配置或长度不足 32 位（弱密钥可被暴力猜测后伪造令牌）');
  console.error('生成命令: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CLIENT_ROOT = path.join(PROJECT_ROOT, 'client');
const STATIC_ROOT = path.join(CLIENT_ROOT, 'static');
// 是否托管前端（SERVE_STATIC=true 默认开启；false 为纯后端模式）
const SERVE_STATIC = (process.env.SERVE_STATIC ?? 'true').toString().trim().toLowerCase() === 'true';

// 确保启动时初始化数据库
const { getDb, closeDb } = require('./db');
getDb();

// CORS：信任本地回环地址（任意端口），外加 CORS_ORIGINS 白名单（须完整 主机[:端口] 匹配）
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
  .map((s) => {
    try {
      // 归一化为 "主机[:端口]"（如 http://192.168.1.100:8081 → "192.168.1.100:8081"）
      return new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`).host;
    } catch { return null; }
  })
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // 非浏览器请求（curl、同源导航等）直接放行
    let hostname;
    try {
      hostname = new URL(origin).hostname; // 畸形 Origin（如 "null"）解析失败即拒绝
    } catch {
      return cb(null, false);
    }
    // 去除 IPv6 方括号（[::1] → ::1），统一识别回环地址
    const normalizedHostname = hostname.replace(/^\[|\]$/g, '');
    const isLocal = /^(localhost|127\.0\.0\.1|::1)$/i.test(normalizedHostname);
    cb(null, isLocal || CORS_ALLOWED_ORIGINS.includes(new URL(origin).host));
  },
}));

app.use(express.json({ limit: '5mb' }));

// 归一化重复斜杠，兼容客户端 API 地址以 "/" 结尾的情况
app.use((req, _res, next) => {
  if (req.url.includes('//')) {
    const [pathname, query] = req.url.split('?');
    req.url = pathname.replace(/\/{2,}/g, '/') + (query ? `?${query}` : '');
  }
  next();
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api', giftRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// 未知 API 路由返回 JSON 404（而非默认 HTML 404）
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 静态托管前端，实现同源访问
if (SERVE_STATIC) {
  app.get('/', (req, res) => res.sendFile(path.join(CLIENT_ROOT, 'index.html')));
  app.get('/index.html', (req, res) => res.sendFile(path.join(CLIENT_ROOT, 'index.html')));
  app.get('/guest-screen.html', (req, res) => res.sendFile(path.join(CLIENT_ROOT, 'guest-screen.html')));
  app.use('/static', express.static(STATIC_ROOT));
}

// 全局 JSON 错误处理：覆盖 413（body 超限）/400（JSON 解析失败）及 wrapAsync 捕获的异常，
// 统一返回 JSON 而非 Express 默认 HTML 错误页
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message = status === 413
    ? '请求体过大，请减少单次提交的数据量'
    : status === 400
      ? '请求体不是合法的 JSON'
      : (status >= 500 ? '服务器内部错误' : err.message);
  if (status >= 500) console.error('未处理异常:', err);
  res.status(status).json({ error: message });
});

const server = app.listen(SERVER_PORT, () => {
  console.log(`礼簿服务已启动 → http://localhost:${SERVER_PORT}`);
  console.log(`托管模式: ${SERVE_STATIC ? '已开启（托管前端）' : '已关闭（纯后端模式）'}`);
  console.log(`注册功能: ${process.env.REGISTRATION_ENABLED === 'true' ? '已开启' : '已关闭'}`);
});

// 关闭服务：先停收新连接并等待在途请求，再关库后以 0 退出；超时（SHUTDOWN_TIMEOUT_MS）以非零码强制退出。
// better-sqlite3 的 close() 为同步操作，closeDb() 在 server.close 回调内先于 process.exit 完成
const SHUTDOWN_TIMEOUT_MS = 5000;
let shuttingDown = false; // 防重复信号：关闭流程中忽略后续信号
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭服务…`);
  const forceExitTimer = setTimeout(() => {
    console.error(`关闭超时（${SHUTDOWN_TIMEOUT_MS}ms），强制退出`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    closeDb();
    process.exit(0);
  });
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
