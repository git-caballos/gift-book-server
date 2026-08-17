const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'gift.db');

// 确保数据库目录存在，否则 better-sqlite3 无法创建数据库文件
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

/** 关闭连接（退出时调用，避免 WAL 文件在重启瞬间被锁定） */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    NOT NULL,
      account     TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      token_version INTEGER NOT NULL DEFAULT 0,
      kdf_salt       TEXT, -- PBKDF2 盐值（信封加密：密码→KEK 派生用）
      kdf_iterations INTEGER, -- PBKDF2 迭代次数
      dek_encrypted  TEXT, -- DEK 的密文（Encrypt(DEK, KEK)），礼金数据仅用 DEK 加解密
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL,
      name             TEXT    NOT NULL,
      start_date_time  TEXT    NOT NULL,
      end_date_time    TEXT    NOT NULL,
      theme            TEXT    NOT NULL DEFAULT 'theme-festive',
      voice_name       TEXT    DEFAULT '',
      cover_type       TEXT    DEFAULT 'default',
      recorder         TEXT    DEFAULT '',
      min_speech_amount INTEGER DEFAULT 0,
      print_options    TEXT    DEFAULT '{}',
      custom_style     TEXT    DEFAULT '{}',
      hide_privacy     INTEGER NOT NULL DEFAULT 0,
      items_per_page   INTEGER,
      export_reminded  INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gifts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id           INTEGER NOT NULL,
      guest_level_weight INTEGER NOT NULL DEFAULT 0,
      level_update_time  INTEGER NOT NULL DEFAULT 0,
      encrypted_data     TEXT    NOT NULL,
      created_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);
    CREATE INDEX IF NOT EXISTS idx_gifts_event_id  ON gifts(event_id);
    CREATE INDEX IF NOT EXISTS idx_gifts_sort
      ON gifts(event_id, guest_level_weight DESC, level_update_time DESC, id ASC);
  `);
}

module.exports = { getDb, closeDb };
