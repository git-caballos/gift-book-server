const { Router } = require('express');
const { jwtAuth } = require('../auth');
const giftService = require('../services/giftService');
const eventService = require('../services/eventService');

const router = Router();

/** 严格解析正整数 ID：拒绝 0x10/1e2/负数/小数/超长等非常规写法 */
function parseId(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

/** 校验事项归属当前登录用户 */
function ensureEventOwnership(req, res, next) {
  const eventId = parseId(req.params.eventId);
  // 非正整数 ID 直接 404，避免 NaN 传给 SQLite 导致异常（返回 HTML 500）
  if (eventId === null) {
    return res.status(404).json({ error: '事项不存在' });
  }
  const event = eventService.getById(eventId, req.user.id);
  if (!event) return res.status(404).json({ error: '事项不存在' });
  req.event = event;
  next();
}

/** GET /api/events/:eventId/gifts — 获取事项下所有礼金（密文，按等级排序） */
router.get('/events/:eventId/gifts', jwtAuth, ensureEventOwnership, (req, res) => {
  res.json(giftService.listEncrypted(req.event.id, req.user.id));
});

/** POST /api/events/:eventId/gifts — 新增礼金（保存客户端密文） */
router.post('/events/:eventId/gifts', jwtAuth, ensureEventOwnership, (req, res) => {
  const eventId = req.event.id;
  const { encryptedData, guestLevelWeight, levelUpdateTime } = req.body || {};

  if (!encryptedData) return res.status(400).json({ error: '礼金数据不能为空' });

  const gift = giftService.create(eventId, req.user.id, {
    encryptedData,
    guestLevelWeight: guestLevelWeight ?? 0,
    levelUpdateTime: levelUpdateTime ?? 0,
  });

  res.status(201).json(gift);
});

/** 单次批量导入最大条数（防滥用；5000 条密文约 2-3MB，低于 body 5mb 上限） */
const BATCH_IMPORT_MAX = 5000;
/** 单次批量导入序列化体积上限（4MB，低于 express.json 5mb 上限，防大密文记录溢出 body 限制） */
const BATCH_IMPORT_MAX_BYTES = 4 * 1024 * 1024;

/** POST /api/events/:eventId/gifts/batch — 批量导入礼金（单事务，替代逐条请求）
 * 请求体：{ gifts: [{ encryptedData, guestLevelWeight, levelUpdateTime }, ...] }
 */
router.post('/events/:eventId/gifts/batch', jwtAuth, ensureEventOwnership, (req, res) => {
  const eventId = req.event.id;
  const { gifts } = req.body || {};

  if (!Array.isArray(gifts) || gifts.length === 0) {
    return res.status(400).json({ error: '缺少批量礼金数据' });
  }
  if (gifts.length > BATCH_IMPORT_MAX) {
    return res.status(400).json({ error: `单次批量导入最多 ${BATCH_IMPORT_MAX} 条` });
  }
  // 体积校验：极端场景下大密文记录可能突破 body 5mb 上限，按序列化体积二次拦截
  const estimatedBytes = Buffer.byteLength(JSON.stringify(gifts), 'utf8');
  if (estimatedBytes > BATCH_IMPORT_MAX_BYTES) {
    return res.status(400).json({
      error: `单次批量导入数据量过大（约 ${Math.ceil(estimatedBytes / 1024)}KB），请分批导入（每批上限 ${BATCH_IMPORT_MAX} 条或 4MB）`,
    });
  }
  for (const g of gifts) {
    if (!g || typeof g.encryptedData !== 'string' || !g.encryptedData.trim()) {
      return res.status(400).json({ error: '礼金数据不能为空' });
    }
  }

  const imported = giftService.createBatch(eventId, req.user.id, gifts);
  if (imported === null) return res.status(404).json({ error: '事项不存在' });
  res.status(201).json({ imported });
});

/** DELETE /api/events/:eventId/gifts/batch — 批量删除礼金（单事务，替代逐条请求）
 * 请求体：{ ids: [number, ...] }
 */
router.delete('/events/:eventId/gifts/batch', jwtAuth, ensureEventOwnership, (req, res) => {
  const eventId = req.event.id;
  const { ids } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '缺少要删除的记录 ID' });
  }
  if (ids.length > BATCH_IMPORT_MAX) {
    return res.status(400).json({ error: `单次批量删除最多 ${BATCH_IMPORT_MAX} 条` });
  }
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: '记录 ID 无效' });
    }
  }

  const removed = giftService.removeBatch(eventId, req.user.id, ids);
  if (removed === null) return res.status(404).json({ error: '事项不存在' });
  res.json({ removed });
});

/** PUT /api/events/:eventId/gifts/:giftId — 更新礼金 */
router.put('/events/:eventId/gifts/:giftId', jwtAuth, ensureEventOwnership, (req, res) => {
  const eventId = req.event.id;
  const giftId = parseId(req.params.giftId);
  if (giftId === null) return res.status(404).json({ error: '礼金记录不存在' });

  const gift = giftService.update(giftId, eventId, req.user.id, req.body || {});
  if (!gift) return res.status(404).json({ error: '礼金记录不存在' });
  res.json(gift);
});

/** DELETE /api/events/:eventId/gifts/:giftId — 删除礼金 */
router.delete('/events/:eventId/gifts/:giftId', jwtAuth, ensureEventOwnership, (req, res) => {
  const eventId = req.event.id;
  const giftId = parseId(req.params.giftId);
  if (giftId === null) return res.status(404).json({ error: '礼金记录不存在' });

  const deleted = giftService.remove(giftId, eventId, req.user.id);
  if (!deleted) return res.status(404).json({ error: '礼金记录不存在' });
  res.json({ message: '礼金记录已删除' });
});

module.exports = router;
