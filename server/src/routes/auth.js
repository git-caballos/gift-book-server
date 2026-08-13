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

/** POST /api/auth/register — 注册（account 为登录账号，username 为显示名，可空） */
router.post('/register', wrapAsync(async (req, res) => {
  if (process.env.REGISTRATION_ENABLED !== 'true') {
    return res.status(403).json({ error: '注册功能已关闭' });
  }

  const { account, username, password } = req.body || {};
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
    db.prepare('INSERT INTO users (account, username, password) VALUES (?, ?, ?)').run(acc, displayName, hashed);
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
  const user = db.prepare('SELECT id, account, username, password, token_version FROM users WHERE account = ?').get(acc);
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

  // 加密由客户端完成（账号密码作为密钥），服务端 JWT 仅承载用户身份；
  // tokenVersion 用于改密后吊销旧令牌
  const token = generateToken(
    { id: user.id, account: user.account, username: user.username, tokenVersion: user.token_version },
    process.env.JWT_SECRET,
    { expiresIn },
  );

  res.json({
    token,
    user: { id: user.id, account: user.account, username: user.username },
  });
}));

/** GET /api/auth/me — 获取当前用户信息 */
router.get('/me', jwtAuth, (req, res) => {
  res.json({ id: req.user.id, account: req.user.account, username: req.user.username });
});

/** PUT /api/auth/password — 修改密码（校验旧密码）
 * 事务内先重写全部礼金密文（客户端用新密码加密后随请求提交），再更新密码哈希；
 * 任一步失败整体回滚，避免"密码已改但数据仍用旧密钥加密而永久无法解密"
 */
router.put('/password', jwtAuth, wrapAsync(async (req, res) => {
  const { oldPassword, newPassword, reencryptedGifts } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: '旧密码和新密码不能为空' });
  }
  if (reencryptedGifts !== undefined && !Array.isArray(reencryptedGifts)) {
    return res.status(400).json({ error: 'reencryptedGifts 必须是数组' });
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

  const giftList = reencryptedGifts || [];

  // 前置校验密文格式与 id 唯一性，避免重复 id 绕过数量校验、改密后部分礼金永久无法解密
  const seenIds = new Set();
  for (const gift of giftList) {
    if (!gift || !Number.isInteger(gift.id) || typeof gift.encryptedData !== 'string') {
      return res.status(400).json({ error: '礼金数据格式不正确' });
    }
    if (seenIds.has(gift.id)) {
      return res.status(400).json({ error: '礼金数据包含重复记录，请刷新后重试' });
    }
    seenIds.add(gift.id);
  }

  // 校验数量与归属须在事务内进行：hashPassword 的异步间隙（bcrypt 约百毫秒）可能有
  // 并发写入新礼金，事务外校验会让漏传的礼金仍用旧密钥加密、改密后永久无法解密

  const hashed = await hashPassword(newPassword);

  try {
    const changePassword = db.transaction(() => {
      // 事务内重查总数与归属（better-sqlite3 事务同步执行、事件循环不让步，关闭竞态窗口）
      const totalGifts = db.prepare(
        'SELECT COUNT(*) AS count FROM gifts WHERE event_id IN (SELECT id FROM events WHERE user_id = ?)'
      ).get(req.user.id).count;
      if (giftList.length !== totalGifts) {
        throw new Error('DATA_CHANGED');
      }
      const ownedCount = db.prepare(
        'SELECT COUNT(*) AS count FROM gifts WHERE id IN (' +
        giftList.map(() => '?').join(',') + ') AND event_id IN (SELECT id FROM events WHERE user_id = ?)'
      ).get(...giftList.map((g) => g.id), req.user.id).count;
      if (ownedCount !== giftList.length) {
        throw new Error('DATA_CHANGED');
      }

      // 仅更新当前用户自己事件下的礼金，防止越权篡改他人数据
      const updateGift = db.prepare(`
        UPDATE gifts SET encrypted_data = ?, updated_at = datetime('now','localtime')
        WHERE id = ? AND event_id IN (SELECT id FROM events WHERE user_id = ?)
      `);
      for (const gift of giftList) {
        const result = updateGift.run(gift.encryptedData, gift.id, req.user.id);
        if (result.changes === 0) {
          throw new Error('越权访问礼金记录');
        }
      }
      db.prepare('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?').run(hashed, req.user.id);
    });
    changePassword();
    // 改密成功：token_version 已递增，失效用户缓存并吊销旧令牌
    invalidateUserCache(req.user.id);
  } catch (error) {
    // 事务内校验失败：改密期间数据发生变化，事务已回滚，提示刷新后重试
    if (error.message === 'DATA_CHANGED') {
      return res.status(400).json({ error: '礼金数据在修改期间发生变化，请刷新后重试' });
    }
    // 不暴露内部校验细节（如越权判断），统一返回通用提示；事务已整体回滚
    return res.status(400).json({ error: '密码修改失败，数据已回滚，请重试' });
  }

  res.json({ message: '密码修改成功' });
}));

/** GET /api/auth/config — 前端获取认证配置 */
router.get('/config', (_req, res) => {
  res.json({ registrationEnabled: process.env.REGISTRATION_ENABLED === 'true' });
});

module.exports = router;
