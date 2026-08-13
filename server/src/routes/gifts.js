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
