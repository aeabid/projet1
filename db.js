const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// المستويات الدراسية في البرنامج
const LEVELS = [
  { code: '5', label: 'السنة الخامسة' },
  { code: '6', label: 'السنة السادسة' },
  { code: '6-distance', label: 'السنة السادسة (عن بعد)' },
  { code: '7', label: 'السنة السابعة' },
  { code: '8', label: 'السنة الثامنة' },
  { code: '9', label: 'السنة التاسعة' },
];
const LEVEL_CODES = LEVELS.map((l) => l.code);

const ROLES = ['admin', 'teacher', 'parent'];
const NOTE_CATEGORIES = ['behavior', 'level', 'general'];
const NOTE_RATINGS = ['excellent', 'good', 'average', 'weak'];

const DEFAULT_SUBJECTS = [
  'العربية',
  'الفرنسية',
  'الإنجليزية',
  'الرياضيات',
  'الإيقاظ العلمي',
  'علوم الحياة والأرض',
  'العلوم الفيزيائية',
  'التربية التكنولوجية',
  'التاريخ والجغرافيا',
  'التربية الإسلامية',
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function openDb(file = process.env.DB_FILE || path.join(__dirname, 'data', 'app.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'parent')),
      phone TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS teacher_subjects (
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      PRIMARY KEY (teacher_id, subject_id)
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      level TEXT NOT NULL,
      group_name TEXT,
      birth_date TEXT,
      parent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS absences (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      justified INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- subject_id NULL = ملاحظة من الإدارة
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      category TEXT NOT NULL CHECK (category IN ('behavior', 'level', 'general')),
      rating TEXT CHECK (rating IS NULL OR rating IN ('excellent', 'good', 'average', 'weak')),
      content TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
    CREATE INDEX IF NOT EXISTS idx_absences_student ON absences(student_id);
    CREATE INDEX IF NOT EXISTS idx_notes_student ON notes(student_id);
  `);

  const subjectCount = db.prepare('SELECT COUNT(*) AS n FROM subjects').get().n;
  if (subjectCount === 0) {
    const insert = db.prepare('INSERT INTO subjects (name) VALUES (?)');
    for (const name of DEFAULT_SUBJECTS) insert.run(name);
  }

  const adminCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  if (adminCount === 0) {
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare(
      "INSERT INTO users (username, password_hash, full_name, role) VALUES ('admin', ?, 'الإدارة', 'admin')"
    ).run(hashPassword(password));
    if (!process.env.ADMIN_PASSWORD && file !== ':memory:') {
      console.log('تم إنشاء حساب الإدارة: admin / admin123 — غيّر كلمة السر بعد أول دخول.');
    }
  }

  return db;
}

module.exports = {
  openDb,
  hashPassword,
  verifyPassword,
  LEVELS,
  LEVEL_CODES,
  ROLES,
  NOTE_CATEGORIES,
  NOTE_RATINGS,
};
