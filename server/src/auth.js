const { hashPassword, comparePassword, generateToken, verifyToken } = require('@sajibjashore/easy-auth');
const { getDb } = require('./db');

const userCache = new Map(); 

/** JWT 认证中间件：验证 Authorization: Bearer <token>，将用户信息注入 req.user */
function jwtAuth(req, res, next) {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ error: '服务器认证配置错误' });
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token, process.env.JWT_SECRET);
  if (!payload) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }
  let user = userCache.get(payload.id);
  if (!user) {
    const db = getDb();
    user = db.prepare('SELECT id, account, username, token_version, created_at FROM users WHERE id = ?').get(payload.id);
    if (!user) {
      return res.status(401).json({ error: '用户不存在' });
    }
    userCache.set(payload.id, user);
  }
  // 改密后 token_version 递增：旧令牌（携带旧版本号）立即失效，防止泄露的令牌继续删除/篡改数据
  if (payload.tokenVersion !== user.token_version) {
    return res.status(401).json({ error: '登录状态已过期，请重新登录' });
  }
  req.user = user;
  next();
}

/** 使指定用户的缓存失效（改密后调用，下次请求重新读库拿到新 token_version） */
function invalidateUserCache(id) {
  userCache.delete(id);
}

module.exports = { hashPassword, comparePassword, generateToken, jwtAuth, invalidateUserCache };
