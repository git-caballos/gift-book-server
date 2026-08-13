const { getDb } = require('../db');

/** 归一化为非负整数；非法值（NaN/负数/非数字）回退 fallback */
function toNonNegInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** 归一化为 0/1：接受布尔、0/1 数字及 'true'/'1'/'yes'/'on' 等字符串 */
function toBool(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()) ? 1 : 0;
  return 0;
}

/** 将数据库行转换为前端使用的 camelCase DTO */
function toEventDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    startDateTime: row.start_date_time,
    endDateTime: row.end_date_time,
    theme: row.theme,
    voiceName: row.voice_name,
    coverType: row.cover_type,
    recorder: row.recorder,
    minSpeechAmount: row.min_speech_amount,
    printOptions: JSON.parse(row.print_options || '{}'),
    customStyle: JSON.parse(row.custom_style || '{}'),
    hidePrivacy: !!row.hide_privacy,
    itemsPerPage: row.items_per_page,
    exportReminded: !!row.export_reminded,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const eventService = {
  /** 获取用户的所有事项 */
  list(userId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId).map(toEventDTO);
  },

  /** 获取单个事项（校验归属） */
  getById(eventId, userId) {
    const db = getDb();
    return toEventDTO(db.prepare(
      'SELECT * FROM events WHERE id = ? AND user_id = ?'
    ).get(eventId, userId));
  },

  create(userId, data) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO events (user_id, name, start_date_time, end_date_time, theme,
        voice_name, cover_type, recorder, min_speech_amount, print_options,
        custom_style, hide_privacy, items_per_page)
      VALUES (@userId, @name, @startDateTime, @endDateTime, @theme,
        @voiceName, @coverType, @recorder, @minSpeechAmount, @printOptions,
        @customStyle, @hidePrivacy, @itemsPerPage)
    `).run({
      userId,
      name: data.name,
      startDateTime: data.startDateTime,
      endDateTime: data.endDateTime,
      theme: data.theme || 'theme-festive',
      voiceName: data.voiceName || '',
      coverType: data.coverType || 'default',
      recorder: data.recorder || '',
      minSpeechAmount: toNonNegInt(data.minSpeechAmount, 0),
      printOptions: JSON.stringify(data.printOptions && typeof data.printOptions === 'object' ? data.printOptions : {}),
      customStyle: JSON.stringify(data.customStyle && typeof data.customStyle === 'object' ? data.customStyle : {}),
      hidePrivacy: toBool(data.hidePrivacy),
      itemsPerPage: data.itemsPerPage === undefined || data.itemsPerPage === null ? null : toNonNegInt(data.itemsPerPage, null),
    });
    return this.getById(result.lastInsertRowid, userId);
  },

  update(eventId, userId, data) {
    const db = getDb();
    const existing = this.getById(eventId, userId);
    if (!existing) return null;

    db.prepare(`
      UPDATE events SET
        name = @name, start_date_time = @startDateTime,
        end_date_time = @endDateTime, theme = @theme,
        voice_name = @voiceName, cover_type = @coverType,
        recorder = @recorder, min_speech_amount = @minSpeechAmount,
        print_options = @printOptions, custom_style = @customStyle,
        hide_privacy = @hidePrivacy, items_per_page = @itemsPerPage,
        updated_at = datetime('now','localtime')
      WHERE id = @id AND user_id = @userId
    `).run({
      id: eventId,
      userId,
      name: data.name ?? existing.name,
      startDateTime: data.startDateTime ?? existing.startDateTime,
      endDateTime: data.endDateTime ?? existing.endDateTime,
      theme: data.theme ?? existing.theme,
      voiceName: data.voiceName ?? existing.voiceName,
      coverType: data.coverType ?? existing.coverType,
      recorder: data.recorder ?? existing.recorder,
      minSpeechAmount: data.minSpeechAmount !== undefined
        ? toNonNegInt(data.minSpeechAmount, existing.minSpeechAmount)
        : existing.minSpeechAmount,
      printOptions: data.printOptions !== undefined
        ? JSON.stringify(data.printOptions && typeof data.printOptions === 'object' ? data.printOptions : {})
        : JSON.stringify(existing.printOptions),
      customStyle: data.customStyle !== undefined
        ? JSON.stringify(data.customStyle && typeof data.customStyle === 'object' ? data.customStyle : {})
        : JSON.stringify(existing.customStyle),
      hidePrivacy: data.hidePrivacy !== undefined ? toBool(data.hidePrivacy) : (existing.hidePrivacy ? 1 : 0),
      itemsPerPage: data.itemsPerPage !== undefined
        ? (data.itemsPerPage === null ? null : toNonNegInt(data.itemsPerPage, existing.itemsPerPage ?? null))
        : (existing.itemsPerPage ?? null),
    });
    return this.getById(eventId, userId);
  },

  /** 标记"已提醒导出数据" */
  markExportReminded(eventId, userId) {
    const db = getDb();
    const result = db.prepare(
      `UPDATE events SET export_reminded = 1, updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`
    ).run(eventId, userId);
    if (result.changes === 0) return null;
    return this.getById(eventId, userId);
  },

  remove(eventId, userId) {
    const db = getDb();
    const result = db.prepare(
      'DELETE FROM events WHERE id = ? AND user_id = ?'
    ).run(eventId, userId);
    return result.changes > 0;
  },
};

module.exports = eventService;
