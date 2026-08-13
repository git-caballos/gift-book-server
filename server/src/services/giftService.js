const { getDb } = require('../db');

/** 校验事件归属（存在且属于指定用户） */
function belongsToUser(eventId, userId) {
  const db = getDb();
  return !!db.prepare('SELECT 1 FROM events WHERE id = ? AND user_id = ?').get(eventId, userId);
}

/** 加密在客户端完成（账号密码为密钥），服务端仅存密文与索引字段，无法读取明文 */
const giftService = {
  /** 获取事项下所有礼金（按等级排序，返回 DTO 数组）
   * 归属校验：事件不属于该用户时返回 null（纵深防御，路由层已做同样校验） */
  listEncrypted(eventId, userId) {
    const db = getDb();
    if (!belongsToUser(eventId, userId)) return null;
    return db.prepare(`
      SELECT id, event_id AS eventId,
             guest_level_weight AS guestLevelWeight,
             level_update_time AS levelUpdateTime,
             encrypted_data AS encryptedData,
             created_at AS createdAt, updated_at AS updatedAt
      FROM gifts
      WHERE event_id = ?
      ORDER BY guest_level_weight DESC, level_update_time DESC, id ASC
    `).all(eventId);
  },

  /** 新增礼金记录（存储客户端密文） */
  create(eventId, userId, giftData) {
    const db = getDb();
    if (!belongsToUser(eventId, userId)) return null;
    const result = db.prepare(`
      INSERT INTO gifts (event_id, guest_level_weight, level_update_time, encrypted_data)
      VALUES (?, ?, ?, ?)
    `).run(
      eventId,
      giftData.guestLevelWeight ?? 0,
      giftData.levelUpdateTime ?? 0,
      giftData.encryptedData,
    );
    return toDTO(db.prepare('SELECT * FROM gifts WHERE id = ?').get(result.lastInsertRowid));
  },

  /** 更新礼金记录（encryptedData 提供时更新密文） */
  update(giftId, eventId, userId, updates) {
    const db = getDb();
    if (!belongsToUser(eventId, userId)) return null;
    const existing = db.prepare(
      'SELECT * FROM gifts WHERE id = ? AND event_id = ?'
    ).get(giftId, eventId);
    if (!existing) return null;

    db.prepare(`
      UPDATE gifts SET
        guest_level_weight = ?,
        level_update_time = ?,
        encrypted_data = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ? AND event_id = ?
    `).run(
      updates.guestLevelWeight ?? existing.guest_level_weight,
      updates.levelUpdateTime ?? existing.level_update_time,
      updates.encryptedData !== undefined ? updates.encryptedData : existing.encrypted_data,
      giftId,
      eventId,
    );
    return toDTO(db.prepare('SELECT * FROM gifts WHERE id = ?').get(giftId));
  },

  remove(giftId, eventId, userId) {
    const db = getDb();
    if (!belongsToUser(eventId, userId)) return null;
    const result = db.prepare(
      'DELETE FROM gifts WHERE id = ? AND event_id = ?'
    ).run(giftId, eventId);
    return result.changes > 0;
  },
};

/** 数据库行 → 前端 DTO（与 listEncrypted 返回结构保持一致，驼峰字段名） */
function toDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    guestLevelWeight: row.guest_level_weight,
    levelUpdateTime: row.level_update_time,
    encryptedData: row.encrypted_data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = giftService;
