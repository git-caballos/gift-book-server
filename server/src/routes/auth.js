const { Router } = require('express');
const { hashPassword, comparePassword, generateToken, jwtAuth, invalidateUserCache } = require('../auth');
const { getDb } = require('../db');

const router = Router();

// 登录失败锁定（内存版，重启后重置）
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
// 配置校验：非法或 <1 回退默认值；必须 >=1，否则小数值会取整为 0 分钟锁定（立即失效）
function safePositiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}
const maxFails = safePositiveInt(LOGIN_MAX_FAILS, 5);
const lockMinutes = safePositiveInt(LOGIN_LOCK_MINUTES, 15);
// 失败记录保留时长：超过后清除，防止未认证接口持续提交不同账号刷爆内存
const LOGIN_FAILS_TTL_MS = 30 * 60 * 1000;
const loginFails = new Map(); // account -> { fails, lockedUntil, lastFailAt }

/** 清理超时未再失败的记录，限制 Map 无上限增长（登录/记录失败时调用） */
function pruneLoginFails() {
  const now = Date.now();
  for (const [account, rec] of loginFails) {
    const expiry = rec.lockedUntil && rec.lockedUntil > now ? rec.lockedUntil : rec.lastFailAt + LOGIN_FAILS_TTL_MS;
    if (now >= expiry) loginFails.delete(account);
  }
}

/** 剩余锁定分钟数；0 表示未锁定（顺带清理过期记录） */
function getLoginLockMinutes(account) {
  const rec = loginFails.get(account);
  if (!rec) return 0;
  if (!rec.lockedUntil) return 0; // 有记录但未触发锁定
  if (Date.now() >= rec.lockedUntil) {
    loginFails.delete(account);
    return 0;
  }
  return Math.ceil((rec.lockedUntil - Date.now()) / 60000);
}

/** 记录登录失败，达阈值则触发锁定 */
function recordLoginFail(account) {
  pruneLoginFails();
  const rec = loginFails.get(account) || { fails: 0, lockedUntil: 0, lastFailAt: 0 };
  rec.lastFailAt = Date.now();
  // 锁定期内不刷新锁定时间（防止并发失败无限延长锁定）
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    loginFails.set(account, rec);
    return;
  }
  rec.fails += 1;
  if (rec.fails >= maxFails) {
    rec.lockedUntil = Date.now() + lockMinutes * 60 * 1000;
    rec.fails = 0;
  }
  loginFails.set(account, rec);
}

function resetLoginFails(account) {
  loginFails.delete(account);
}

/** 包裹 async 处理器：捕获 rejected promise（Express 4 不自动捕获 async 异常） */
function wrapAsync(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/** POST /api/auth/register — 注册（account 为登录账号，username 为显示名，可空）
 * 信封加密：客户端生成随机 DEK 并用密码派生的 KEK 包裹，kdfSalt/kdfIterations/dekEncrypted 随请求入库
 */
router.post('/register', wrapAsync(async (req, res) => {
  if (process.env.REGISTRATION_ENABLED !== 'true') {
    return res.status(403).json({ error: '注册功能已关闭' });
  }

  const { account, username, password, kdfSalt, kdfIterations, dekEncrypted } = req.body || {};
  if (!account || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }

  const acc = String(account).trim();
  if (!acc) {
    return res.status(400).json({ error: '账号不能为空' });
  }
  if (!password) {
    return res.status(400).json({ error: '密码不能为空' });
  }

  // 信封加密参数（必需）：客户端生成随机 DEK 并用密码派生的 KEK 包裹后随请求入库
  const iterations = Number(kdfIterations);
  if (typeof kdfSalt !== 'string' || !kdfSalt.trim() ||
      !Number.isInteger(iterations) || iterations < 1 || iterations > 1000000 ||
      typeof dekEncrypted !== 'string' || !dekEncrypted.trim()) {
    return res.status(400).json({ error: '加密参数缺失或格式不正确' });
  }

  // 显示名：未填时默认用账号（acc 已保证非空，displayName 恒有值）
  const displayName = (username && String(username).trim()) || acc;

  const db = getDb();
  const existsAccount = db.prepare('SELECT id FROM users WHERE account = ?').get(acc);
  if (existsAccount) {
    return res.status(409).json({ error: '账号已被占用' });
  }

  const hashed = await hashPassword(password);
  try {
    // 并发注册时先查后插存在竞态，INSERT 抛 UNIQUE 约束错误，统一转 409
    db.prepare('INSERT INTO users (account, username, password, kdf_salt, kdf_iterations, dek_encrypted) VALUES (?, ?, ?, ?, ?, ?)')
      .run(acc, displayName, hashed, String(kdfSalt).trim(), iterations, String(dekEncrypted).trim());
  } catch (err) {
    if (err && err.code && String(err.code).includes('UNIQUE')) {
      return res.status(409).json({ error: '账号已被占用' });
    }
    throw err;
  }

  res.status(201).json({ message: '注册成功' });
}));

/** POST /api/auth/login — 登录（带失败锁定） */
router.post('/login', wrapAsync(async (req, res) => {
  const { account, password } = req.body || {};
  if (!account || !password) {
    return res.status(400).json({ error: '账号和密码不能为空' });
  }

  const acc = String(account).trim();

  // 锁定期间直接拒绝，不做密码校验（避免暴露账号是否存在）
  const remainingLockMinutes = getLoginLockMinutes(acc);
  if (remainingLockMinutes > 0) {
    return res.status(429).json({ error: `尝试次数过多，请 ${remainingLockMinutes} 分钟后再试` });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, account, username, password, token_version, kdf_salt, kdf_iterations, dek_encrypted FROM users WHERE account = ?').get(acc);
  if (!user) {
    recordLoginFail(acc);
    return res.status(401).json({ error: '账号或密码错误' });
  }

  const match = await comparePassword(password, user.password);
  if (!match) {
    recordLoginFail(acc);
    return res.status(401).json({ error: '账号或密码错误' });
  }

  resetLoginFails(acc);

  // 服务端认证配置缺失时快速失败，避免 generateToken 抛出未处理异常
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: '服务器认证配置错误' });
  }

  // JWT_EXPIRES_IN 非法时回退默认 7 天，避免 jwt.sign 抛错导致登录 500
  const expiresIn = process.env.JWT_EXPIRES_IN && /^\d+(ms|s|m|h|d|w|y)?$/.test(process.env.JWT_EXPIRES_IN.trim())
    ? process.env.JWT_EXPIRES_IN.trim()
    : '7d';

  // 加密由客户端完成（密码→KEK→解出 DEK），服务端 JWT 仅承载用户身份；
  // kdf 返回客户端用于派生 KEK 并解开 DEK（kdf 为 null 表示旧版账号，前端将触发一次性升级）
  const kdf = user.kdf_salt
    ? { salt: user.kdf_salt, iterations: user.kdf_iterations, dekEncrypted: user.dek_encrypted }
    : null;

  const token = generateToken(
    { id: user.id, account: user.account, username: user.username, tokenVersion: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn },
  );

  res.json({
    token,
    user: { id: user.id, account: user.account, username: user.username },
    kdf,
  });
}));

/** GET /api/auth/me — 获取当前用户信息（含信封加密参数，供会话恢复时解出 DEK） */
router.get('/me', jwtAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, account, username, kdf_salt, kdf_iterations, dek_encrypted FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }
  const kdf = user.kdf_salt
    ? { salt: user.kdf_salt, iterations: user.kdf_iterations, dekEncrypted: user.dek_encrypted }
    : null;
  res.json({ id: user.id, account: user.account, username: user.username, kdf });
});

/** PUT /api/auth/password — 修改密码（校验旧密码）
 * 信封加密下改密为 O(1) 操作：数据密钥（DEK）不变，仅用新密码派生的 KEK 重新包裹 DEK，
 * 完全无需遍历/重写任何礼金记录（旧版"全量重加密"逻辑已移除）。
 * 客户端提交：oldPassword、newPassword、kdfSalt、kdfIterations、dekEncrypted（新 KEK 包裹后的 DEK 密文）
 */
router.put('/password', jwtAuth, wrapAsync(async (req, res) => {
  const { oldPassword, newPassword, kdfSalt, kdfIterations, dekEncrypted } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '旧密码和新密码不能为空' });
  }
  const iterations = Number(kdfIterations);
  if (typeof kdfSalt !== 'string' || !kdfSalt.trim() ||
      !Number.isInteger(iterations) || iterations < 1 || iterations > 1000000 ||
      typeof dekEncrypted !== 'string' || !dekEncrypted.trim()) {
    return res.status(400).json({ error: '加密参数缺失或格式不正确，请重新登录后重试' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }

  const match = await comparePassword(oldPassword, user.password);
  if (!match) {
    return res.status(400).json({ error: '旧密码错误' });
  }

  const hashed = await hashPassword(newPassword);

  // 仅更新密码哈希与 DEK 密文（O(1)），不触碰任何礼金记录
  db.prepare(
    'UPDATE users SET password = ?, kdf_salt = ?, kdf_iterations = ?, dek_encrypted = ?, token_version = token_version + 1 WHERE id = ?'
  ).run(hashed, kdfSalt.trim(), iterations, dekEncrypted.trim(), req.user.id);

  // 改密成功：token_version 已递增，失效用户缓存并吊销旧令牌
  invalidateUserCache(req.user.id);

  res.json({ message: '密码修改成功' });
}));

/** GET /api/auth/config — 前端获取认证配置 */
router.get('/config', (_req, res) => {
  res.json({ registrationEnabled: process.env.REGISTRATION_ENABLED === 'true' });
});

module.exports = router;
