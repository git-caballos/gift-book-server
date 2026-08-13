const { Router } = require('express');
const { jwtAuth } = require('../auth');
const eventService = require('../services/eventService');

const router = Router();

/** 严格解析正整数 ID：拒绝 0x10/1e2/负数/小数/超长等非常规写法 */
function parseId(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

/** GET /api/events — 获取当前用户的所有事项 */
router.get('/', jwtAuth, (req, res) => {
  res.json(eventService.list(req.user.id));
});

/** GET /api/events/:id — 获取单个事项 */
router.get('/:id', jwtAuth, (req, res) => {
  const eventId = parseId(req.params.id);
  if (eventId === null) return res.status(404).json({ error: '事项不存在' });
  const event = eventService.getById(eventId, req.user.id);
  if (!event) return res.status(404).json({ error: '事项不存在' });
  res.json(event);
});

/** POST /api/events — 创建事项 */
router.post('/', jwtAuth, (req, res) => {
  const { name, startDateTime, endDateTime, theme, voiceName, coverType,
    recorder, minSpeechAmount, printOptions, customStyle, hidePrivacy, itemsPerPage } = req.body || {};

  if (!name || !startDateTime || !endDateTime) {
    return res.status(400).json({ error: '事项名称、开始时间和结束时间为必填项' });
  }

  const event = eventService.create(req.user.id, {
    name, startDateTime, endDateTime, theme, voiceName,
    coverType, recorder, minSpeechAmount, printOptions, customStyle, hidePrivacy, itemsPerPage,
  });
  res.status(201).json(event);
});

/** PUT /api/events/:id — 更新事项 */
router.put('/:id', jwtAuth, (req, res) => {
  const eventId = parseId(req.params.id);
  if (eventId === null) return res.status(404).json({ error: '事项不存在' });
  const event = eventService.update(eventId, req.user.id, req.body || {});
  if (!event) return res.status(404).json({ error: '事项不存在' });
  res.json(event);
});

/** PUT /api/events/:id/export-reminded — 标记"已提醒导出数据" */
router.put('/:id/export-reminded', jwtAuth, (req, res) => {
  const eventId = parseId(req.params.id);
  if (eventId === null) return res.status(404).json({ error: '事项不存在' });
  const event = eventService.markExportReminded(eventId, req.user.id);
  if (!event) return res.status(404).json({ error: '事项不存在' });
  res.json(event);
});

/** DELETE /api/events/:id — 删除事项 */
router.delete('/:id', jwtAuth, (req, res) => {
  const eventId = parseId(req.params.id);
  if (eventId === null) return res.status(404).json({ error: '事项不存在' });
  const deleted = eventService.remove(eventId, req.user.id);
  if (!deleted) return res.status(404).json({ error: '事项不存在' });
  res.json({ message: '事项已删除' });
});

module.exports = router;
