import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getJstDateStr, getJstDateStrWithDayOffset, getJstDateTimeStr, getJstTimeStr } from '../utils/jstTime.js';

const dbPathEnv = path.resolve(process.env.DB_PATH || path.join(process.cwd(), 'data', 'journal.db'));
const dbDir = path.dirname(dbPathEnv);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export function getDbPath(): string {
  return dbPathEnv;
}

let currentDb: Database.Database = new Database(dbPathEnv);
currentDb.pragma('journal_mode = WAL');
currentDb.pragma('foreign_keys = ON');

export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const val = (currentDb as any)[prop];
    if (typeof val === 'function') {
      return val.bind(currentDb);
    }
    return val;
  },
});

export function reloadDatabase(newDbPath?: string) {
  try {
    currentDb.close();
  } catch (err) {
    console.error('Error closing current db:', err);
  }

  try {
    if (fs.existsSync(`${dbPathEnv}-wal`)) fs.unlinkSync(`${dbPathEnv}-wal`);
  } catch {}
  try {
    if (fs.existsSync(`${dbPathEnv}-shm`)) fs.unlinkSync(`${dbPathEnv}-shm`);
  } catch {}

  if (newDbPath && newDbPath !== dbPathEnv) {
    fs.copyFileSync(newDbPath, dbPathEnv);
  }

  currentDb = new Database(dbPathEnv);
  currentDb.pragma('journal_mode = WAL');
  currentDb.pragma('foreign_keys = ON');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(12).toString('hex');
}

export interface SpaceLabelPreset {
  key: string;
  color: string;
  name: string;
}

export const DEFAULT_SPACE_LABELS: SpaceLabelPreset[] = [
  { key: 'emerald', color: '#1B4D3E', name: '기본 일정' },
  { key: 'sky', color: '#0369A1', name: '업무 · 미팅' },
  { key: 'rose', color: '#BE123C', name: '중요 · 약속' },
  { key: 'amber', color: '#B45309', name: '아이디어 · 제안' },
  { key: 'violet', color: '#6D28D9', name: '개인 · 취미' },
  { key: 'slate', color: '#475569', name: '기타 메모' },
];

export function ensureDefaultSpaceForUser(userId: number): number {
  const existing = db
    .prepare(`
      SELECT s.id
      FROM collab_spaces s
      INNER JOIN collab_space_members m ON m.space_id = s.id
      WHERE m.user_id = ?
      ORDER BY s.is_personal DESC, s.id ASC
      LIMIT 1
    `)
    .get(userId) as { id: number } | undefined;

  if (existing?.id) return Number(existing.id);

  const tx = db.transaction(() => {
    const res = db
      .prepare(`
        INSERT INTO collab_spaces (name, description, color, is_personal, invite_token, member_invite_token, labels_json, created_by)
        VALUES (?, ?, '#1B4D3E', 1, ?, ?, ?, ?)
      `)
      .run(
        '내 공유 캘린더',
        '개인 일정과 생각을 정리하고, 원할 때 멤버를 초대해 함께 공유할 수 있습니다.',
        generateInviteToken(),
        generateInviteToken(),
        JSON.stringify(DEFAULT_SPACE_LABELS),
        userId
      );
    const spaceId = Number(res.lastInsertRowid);
    db.prepare(`
      INSERT INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
      VALUES (?, ?, 'OWNER', 0)
    `).run(spaceId, userId);
    return spaceId;
  });

  return tx();
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      font_size TEXT NOT NULL DEFAULT '100',
      mobile_font_size TEXT NOT NULL DEFAULT '100',
      push_enabled INTEGER NOT NULL DEFAULT 1,
      language TEXT NOT NULL DEFAULT 'ko',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'SOLO', -- 'SOLO' | 'COLLAB'
      is_private INTEGER NOT NULL DEFAULT 1,
      partner_type TEXT NOT NULL DEFAULT 'NONE', -- 'NONE' | 'SHARED' | 'EXTERNAL'
      partner_name TEXT,
      invite_token TEXT UNIQUE,
      member_invite_token TEXT UNIQUE,
      active_turn_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      participants_json TEXT DEFAULT '[]',
      intent_summary TEXT,
      initial_intent_summary TEXT,
      intent_modified INTEGER NOT NULL DEFAULT 0,
      turn_state TEXT NOT NULL DEFAULT 'MY_TURN', -- 'MY_TURN' | 'THEIR_TURN' | 'HOLD' | 'DONE'
      next_action TEXT,
      next_action_date TEXT,
      stale_threshold_days INTEGER NOT NULL DEFAULT 7,
      last_activity_at TEXT NOT NULL,
      stale_push_last_sent_at TEXT,
      color TEXT NOT NULL DEFAULT '#1B4D3E',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER', -- 'MEMBER'
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      entry_type TEXT NOT NULL DEFAULT 'INTENT', -- 'DIALOGUE_ME' | 'DIALOGUE_THEM' | 'INTENT' | 'PROGRESS'
      speaker_name TEXT,
      content TEXT NOT NULL,
      entry_date TEXT NOT NULL DEFAULT '',
      entry_time TEXT,
      due_date TEXT,
      due_time TEXT,
      completed_target_type TEXT, -- 'ENTRY' | 'IDEA' | NULL
      completed_target_id INTEGER,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      parent_idea_id INTEGER REFERENCES journal_ideas(id) ON DELETE CASCADE,
      related_idea_ids TEXT DEFAULT '[]',
      title TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN' | 'PROMOTED' | 'ARCHIVED'
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      linked_project_id INTEGER REFERENCES journal_projects(id) ON DELETE SET NULL,
      is_processed INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS journal_mindmap_layouts (
      project_id INTEGER PRIMARY KEY REFERENCES journal_projects(id) ON DELETE CASCADE,
      positions_json TEXT DEFAULT '{}',
      edges_json TEXT DEFAULT '[]',
      parent_overrides_json TEXT DEFAULT '{}',
      updated_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_info TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_push_sent_log (
      dedup_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_entry_revision_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS journal_turn_waits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      watcher_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      wait_days INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      target_date TEXT NOT NULL,
      target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      target_name TEXT,
      notified_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, watcher_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_journal_turn_waits_due
      ON journal_turn_waits(notified_at, target_date);

    -- Shared Spaces (TimeTree-style groups pairing Calendar + Shared Thought Pad)
    CREATE TABLE IF NOT EXISTS collab_spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT NOT NULL DEFAULT '#1B4D3E',
      is_personal INTEGER NOT NULL DEFAULT 0,
      linked_project_id INTEGER REFERENCES journal_projects(id) ON DELETE SET NULL,
      invite_token TEXT UNIQUE,
      member_invite_token TEXT UNIQUE,
      labels_json TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collab_space_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES collab_spaces(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER', -- 'OWNER' | 'MEMBER'
      last_read_activity_id INTEGER NOT NULL DEFAULT 0,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(space_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shared_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES collab_spaces(id) ON DELETE CASCADE,
      title TEXT DEFAULT '',
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'NEW', -- 'NEW' | 'DISCUSSING' | 'PROPOSED' | 'SCHEDULED' | 'ARCHIVED'
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_important INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_shared_thoughts_space
      ON shared_thoughts(space_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS thought_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thought_id INTEGER NOT NULL REFERENCES shared_thoughts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      stance TEXT NOT NULL, -- 'GOOD' | 'THINK' | 'BAD'
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(thought_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS thought_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thought_id INTEGER NOT NULL REFERENCES shared_thoughts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment_type TEXT NOT NULL DEFAULT 'COMMENT', -- 'COMMENT' | 'EDIT_PROPOSAL' | 'ADD_PROPOSAL'
      content TEXT NOT NULL,
      applied_at TEXT,
      applied_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_thought_comments_thought
      ON thought_comments(thought_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS thought_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thought_id INTEGER NOT NULL REFERENCES shared_thoughts(id) ON DELETE CASCADE,
      editor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_comment_id INTEGER REFERENCES thought_comments(id) ON DELETE SET NULL,
      change_type TEXT NOT NULL, -- 'EDIT_MERGE' | 'ADD_MERGE' | 'MANUAL_EDIT'
      previous_content TEXT NOT NULL,
      new_content TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES collab_spaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 1,
      label_key TEXT NOT NULL DEFAULT 'emerald',
      color TEXT NOT NULL DEFAULT '#1B4D3E',
      text_color TEXT NOT NULL DEFAULT '#FFFFFF',
      location TEXT DEFAULT '',
      url TEXT DEFAULT '',
      attendee_ids_json TEXT NOT NULL DEFAULT '[]',
      recurrence_type TEXT NOT NULL DEFAULT 'NONE', -- 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
      recurrence_until TEXT,
      reminder_minutes INTEGER,
      event_status TEXT NOT NULL DEFAULT 'CONFIRMED', -- 'PROPOSED' | 'CONFIRMED' | 'CANCELLED'
      linked_thought_id INTEGER REFERENCES shared_thoughts(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_space_dates
      ON calendar_events(space_id, start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_thought
      ON calendar_events(linked_thought_id);

    CREATE TABLE IF NOT EXISTS calendar_event_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote TEXT NOT NULL, -- 'AVAILABLE' | 'UNAVAILABLE'
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(event_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS calendar_event_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_event_comments_event
      ON calendar_event_comments(event_id, created_at ASC);

    CREATE TABLE IF NOT EXISTS space_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id INTEGER NOT NULL REFERENCES collab_spaces(id) ON DELETE CASCADE,
      actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      target_type TEXT NOT NULL, -- 'EVENT' | 'THOUGHT' | 'SPACE'
      target_id INTEGER,
      summary TEXT NOT NULL,
      meta_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_space_activities_space
      ON space_activities(space_id, id DESC);

    -- 3-way cross-entity links (Mindmap Project/Idea/Entry <-> Shared Thought <-> Calendar Event)
    CREATE TABLE IF NOT EXISTS cross_entity_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL, -- 'THOUGHT' | 'EVENT' | 'PROJECT' | 'IDEA' | 'ENTRY'
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL, -- 'THOUGHT' | 'EVENT' | 'PROJECT' | 'IDEA' | 'ENTRY'
      target_id INTEGER NOT NULL,
      space_id INTEGER REFERENCES collab_spaces(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES journal_projects(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_type, source_id, target_type, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_cross_links_source ON cross_entity_links(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_cross_links_target ON cross_entity_links(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_cross_links_project ON cross_entity_links(project_id);

    -- Owner-approval join requests for linked Collaboration Projects <-> Shared Spaces
    CREATE TABLE IF NOT EXISTS collab_join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES journal_projects(id) ON DELETE CASCADE,
      space_id INTEGER REFERENCES collab_spaces(id) ON DELETE SET NULL,
      target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      source TEXT NOT NULL DEFAULT 'PROJECT', -- 'PROJECT' | 'SPACE'
      status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'REJECTED'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collab_join_requests_project
      ON collab_join_requests(project_id, status, id DESC);
    CREATE INDEX IF NOT EXISTS idx_collab_join_requests_space
      ON collab_join_requests(space_id, status, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_join_requests_pending_uniq
      ON collab_join_requests(project_id, target_user_id)
      WHERE status = 'PENDING';
  `);

  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has('role')) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'USER';");
  }
  if (!userColNames.has('font_size')) {
    db.exec("ALTER TABLE users ADD COLUMN font_size TEXT NOT NULL DEFAULT '100';");
  }
  if (!userColNames.has('mobile_font_size')) {
    db.exec("ALTER TABLE users ADD COLUMN mobile_font_size TEXT NOT NULL DEFAULT '100';");
  }
  if (!userColNames.has('push_enabled')) {
    db.exec("ALTER TABLE users ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 1;");
  }
  if (!userColNames.has('calendar_palette_json')) {
    db.exec('ALTER TABLE users ADD COLUMN calendar_palette_json TEXT;');
  }
  if (!userColNames.has('language')) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'ko';");
  }

  const projCols = db.prepare("PRAGMA table_info(journal_projects)").all() as { name: string }[];
  const projColNames = new Set(projCols.map((c) => c.name));
  if (!projColNames.has('stale_push_last_sent_at')) {
    db.exec("ALTER TABLE journal_projects ADD COLUMN stale_push_last_sent_at TEXT;");
  }
  if (!projColNames.has('initial_intent_summary')) {
    db.exec('ALTER TABLE journal_projects ADD COLUMN initial_intent_summary TEXT;');
    db.exec('UPDATE journal_projects SET initial_intent_summary = intent_summary WHERE initial_intent_summary IS NULL AND intent_summary IS NOT NULL;');
  }
  if (!projColNames.has('intent_modified')) {
    db.exec('ALTER TABLE journal_projects ADD COLUMN intent_modified INTEGER NOT NULL DEFAULT 0;');
  }
  if (!projColNames.has('member_invite_token')) {
    db.exec('ALTER TABLE journal_projects ADD COLUMN member_invite_token TEXT;');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_projects_member_invite_token
      ON journal_projects(member_invite_token)
      WHERE member_invite_token IS NOT NULL;
  `);

  const collabSpacesCols = db.prepare("PRAGMA table_info(collab_spaces)").all() as { name: string }[];
  const collabSpacesColNames = new Set(collabSpacesCols.map((c) => c.name));
  if (!collabSpacesColNames.has('linked_project_id')) {
    db.exec('ALTER TABLE collab_spaces ADD COLUMN linked_project_id INTEGER REFERENCES journal_projects(id) ON DELETE SET NULL;');
  }
  if (!collabSpacesColNames.has('member_invite_token')) {
    db.exec('ALTER TABLE collab_spaces ADD COLUMN member_invite_token TEXT;');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_spaces_linked_project
      ON collab_spaces(linked_project_id)
      WHERE linked_project_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collab_spaces_member_invite_token
      ON collab_spaces(member_invite_token)
      WHERE member_invite_token IS NOT NULL;
  `);

  // Safe backfill of member_invite_token for existing COLLAB projects and spaces
  const collabProjectsMissingMemberToken = db
    .prepare("SELECT id FROM journal_projects WHERE mode = 'COLLAB' AND member_invite_token IS NULL")
    .all() as Array<{ id: number }>;
  for (const row of collabProjectsMissingMemberToken) {
    db.prepare('UPDATE journal_projects SET member_invite_token = ? WHERE id = ?').run(
      generateInviteToken(),
      Number(row.id)
    );
  }
  const spacesMissingMemberToken = db
    .prepare('SELECT id FROM collab_spaces WHERE member_invite_token IS NULL')
    .all() as Array<{ id: number }>;
  for (const row of spacesMissingMemberToken) {
    db.prepare('UPDATE collab_spaces SET member_invite_token = ? WHERE id = ?').run(
      generateInviteToken(),
      Number(row.id)
    );
  }

  const entryCols = db.prepare("PRAGMA table_info(journal_entries)").all() as { name: string }[];
  const entryColNames = new Set(entryCols.map((c) => c.name));
  if (!entryColNames.has('due_date')) {
    db.exec('ALTER TABLE journal_entries ADD COLUMN due_date TEXT;');
  }
  if (!entryColNames.has('due_time')) {
    db.exec('ALTER TABLE journal_entries ADD COLUMN due_time TEXT;');
  }

  const calCols = db.prepare("PRAGMA table_info(calendar_events)").all() as { name: string }[];
  const calColNames = new Set(calCols.map((c) => c.name));
  if (!calColNames.has('text_color')) {
    db.exec("ALTER TABLE calendar_events ADD COLUMN text_color TEXT NOT NULL DEFAULT '#FFFFFF';");
  }

  const thoughtCols = db.prepare("PRAGMA table_info(shared_thoughts)").all() as { name: string }[];
  const thoughtColNames = new Set(thoughtCols.map((c) => c.name));
  if (!thoughtColNames.has('is_important')) {
    db.exec('ALTER TABLE shared_thoughts ADD COLUMN is_important INTEGER NOT NULL DEFAULT 0;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_hash TEXT NOT NULL,
      target_lang TEXT NOT NULL CHECK(target_lang IN ('ko', 'ja', 'en')),
      provider TEXT NOT NULL DEFAULT 'google-unofficial',
      content_format TEXT NOT NULL DEFAULT 'text' CHECK(content_format IN ('text', 'html')),
      detected_source_lang TEXT,
      translated_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE(source_hash, target_lang, provider, content_format)
    );
    CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup
      ON translation_cache(source_hash, target_lang, provider, content_format);
    CREATE INDEX IF NOT EXISTS idx_translation_cache_last_used
      ON translation_cache(last_used_at);

    CREATE TABLE IF NOT EXISTS translation_usage_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_call_count INTEGER NOT NULL DEFAULT 0,
      cache_hit_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      last_model TEXT,
      last_used_at TEXT,
      reset_at TEXT
    );
    INSERT OR IGNORE INTO translation_usage_stats (id) VALUES (1);
  `);
}

export function seedDemoDataForUser(userId: number) {
  const today = getJstDateStr();
  const dMinus3 = getJstDateStrWithDayOffset(-3);
  const dMinus2 = getJstDateStrWithDayOffset(-2);
  const dMinus1 = getJstDateStrWithDayOffset(-1);
  const dPlus4 = getJstDateStrWithDayOffset(4);
  const dPlus7 = getJstDateStrWithDayOffset(7);
  const nowStr = getJstDateTimeStr();
  const timeNow = getJstTimeStr();

  const tx = db.transaction(() => {
    // 1. Personal Solo Long-term Project
    const p1 = db.prepare(`
      INSERT INTO journal_projects (
        title, mode, is_private, partner_type, participants_json,
        intent_summary, turn_state, active_turn_user_id, next_action, next_action_date,
        stale_threshold_days, last_activity_at, color, created_by
      )
      VALUES (?, 'SOLO', 1, 'NONE', ?, ?, 'MY_TURN', ?, ?, ?, 7, ?, '#1B4D3E', ?)
    `).run(
      '개인 사이드 프로젝트 — 맥락 기록 앱 출시',
      JSON.stringify([
        { name: '김디자이너', role: 'UI 피드백' },
        { name: '법무사', role: '약관 자문' },
      ]),
      '내가 왜 이 기능을 만들려고 했는지, 중간에 어떤 가설을 세웠는지 잊지 않기 위해 모든 의도와 아이디어를 한곳에 남긴다.',
      userId,
      '랜딩 페이지 시안 검토 후 베타 테스터 5명 모집',
      dPlus4,
      nowStr,
      userId
    );
    const p1Id = Number(p1.lastInsertRowid);

    const e1 = db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'INTENT', ?, ?, '09:30', ?)
    `).run(p1Id, '기능을 복잡하게 늘리기보다, "지금 누구 턴인가"와 "마인드맵 가지치기" 두 가지 경험에 집중하기로 결정.', dMinus3, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, speaker_name, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_THEM', '김디자이너', ?, ?, '15:20', ?)
    `).run(p1Id, '첫 화면에서 너무 많은 버튼이 보이면 압도될 수 있으니 자유 마인드맵의 연결점은 모드 활성화 시에만 띄우는 게 좋겠다고 피드백함.', dMinus2, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_ME', ?, ?, '16:05', ?)
    `).run(p1Id, '동의함. [노드 연결] / [노드 종속] 토글 버튼으로 분리해서 평소에는 깔끔하게 유지하고 반영하겠다고 회신.', dMinus2, userId);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, completed_target_type, completed_target_id, author_id)
      VALUES (?, 'PROGRESS', ?, ?, ?, 'ENTRY', ?, ?)
    `).run(p1Id, '핵심 턴 트래커 + 자유 마인드맵 프로토타입 구현 완료.', dMinus1, timeNow, Number(e1.lastInsertRowid), userId);

    const i1 = db.prepare(`
      INSERT INTO journal_ideas (project_id, title, note, status, author_id)
      VALUES (?, ?, ?, 'OPEN', ?)
    `).run(p1Id, '초대 링크 기반 협업 모드', '사내 계정이 없어도 링크 하나로 프로젝트에 참여해 턴을 주고받기', userId);
    const i1Id = Number(i1.lastInsertRowid);

    const i2 = db.prepare(`
      INSERT INTO journal_ideas (project_id, parent_idea_id, related_idea_ids, title, note, status, author_id)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
    `).run(p1Id, i1Id, JSON.stringify([]), '외부인용 관계자 프리셋', '가입하지 않는 거래처/가족도 원클릭으로 발언자 기록', userId);
    const i2Id = Number(i2.lastInsertRowid);

    const i3 = db.prepare(`
      INSERT INTO journal_ideas (project_id, title, note, status, author_id)
      VALUES (?, ?, ?, 'PROMOTED', ?)
    `).run(p1Id, '베타 테스터 피드백 설문 정리', '온보딩 흐름이 직관적인지 확인', userId);
    const i3Id = Number(i3.lastInsertRowid);

    // Cross-link i2 <-> i3
    db.prepare('UPDATE journal_ideas SET related_idea_ids = ? WHERE id = ?').run(JSON.stringify([i3Id]), i2Id);
    db.prepare('UPDATE journal_ideas SET related_idea_ids = ? WHERE id = ?').run(JSON.stringify([i2Id]), i3Id);

    // 2. External Collaboration Project
    const p2 = db.prepare(`
      INSERT INTO journal_projects (
        title, mode, is_private, partner_type, partner_name, invite_token,
        participants_json, intent_summary, turn_state, active_turn_user_id,
        next_action, next_action_date, stale_threshold_days, last_activity_at, color, created_by
      )
      VALUES (?, 'COLLAB', 1, 'EXTERNAL', '박대표 (거래처)', ?, ?, ?, 'THEIR_TURN', NULL, ?, ?, 5, ?, '#0369A1', ?)
    `).run(
      '외부 파트너 공동 계약 협의',
      generateInviteToken(),
      JSON.stringify([
        { name: '박대표 (거래처)', role: '의사결정권자' },
        { name: '이팀장', role: '실무 담당' },
      ]),
      '유지보수 범위와 분기별 정산 조건을 명확히 합의해 추후 분쟁 여지를 없앤다.',
      '수정 계약서 초안 회신 확인 (금요일까지 미회신 시 리마인드)',
      dPlus7,
      nowStr,
      userId
    );
    const p2Id = Number(p2.lastInsertRowid);

    db.prepare(`
      INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
      VALUES (?, 'DIALOGUE_ME', ?, ?, '11:10', ?)
    `).run(p2Id, '1차 견적 및 SLA 기준안을 메일로 송부하고 검토 요청드림.', dMinus1, userId);

    // 3. Quick Inbox Note
    db.prepare(`
      INSERT INTO journal_inbox (content, author_id)
      VALUES (?, ?)
    `).run('다음 미팅 전에 마인드맵에 비용 항목 가지 하나 더 뻗어서 시뮬레이션해보기', userId);

    // 4. Demo Shared Space (Calendar + Shared Thought Pad)
    const dPlus1 = getJstDateStrWithDayOffset(1);
    const dPlus2 = getJstDateStrWithDayOffset(2);
    const dPlus3 = getJstDateStrWithDayOffset(3);
    const dPlus5 = getJstDateStrWithDayOffset(5);

    const spaceRes = db.prepare(`
      INSERT INTO collab_spaces (name, description, color, is_personal, invite_token, member_invite_token, labels_json, created_by)
      VALUES (?, ?, '#1B4D3E', 0, ?, ?, ?, ?)
    `).run(
      '우리 팀 공유 스페이스',
      '서로의 생각을 자유롭게 던지고, 날짜를 제안해 함께 실행하는 공유 캘린더 & 의식체 메모장',
      generateInviteToken(),
      generateInviteToken(),
      JSON.stringify(DEFAULT_SPACE_LABELS),
      userId
    );
    const spaceId = Number(spaceRes.lastInsertRowid);

    db.prepare(`
      INSERT INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
      VALUES (?, ?, 'OWNER', 0)
    `).run(spaceId, userId);

    // Demo Thoughts
    const t1 = db.prepare(`
      INSERT INTO shared_thoughts (space_id, title, content, tags_json, status, is_pinned, author_id, updated_by)
      VALUES (?, ?, ?, ?, 'PROPOSED', 1, ?, ?)
    `).run(
      spaceId,
      '이번 달 팀 워크숍 겸 브레인스토밍 데이',
      '하루 정도 사무실 벗어나서 조용한 카페나 공유오피스 빌려서 다음 분기 방향을 편하게 이야기하면 어떨까? 노트북 없이 아이디어만 쏟아내는 시간으로!',
      JSON.stringify(['워크숍', '아이디어']),
      userId,
      userId
    );
    const t1Id = Number(t1.lastInsertRowid);

    db.prepare(`
      INSERT INTO thought_reactions (thought_id, user_id, stance)
      VALUES (?, ?, 'GOOD')
    `).run(t1Id, userId);

    db.prepare(`
      INSERT INTO thought_comments (thought_id, author_id, comment_type, content)
      VALUES (?, ?, 'ADD_PROPOSAL', ?)
    `).run(t1Id, userId, '오후에는 다 같이 맛있는 저녁 먹으면서 회고까지 묶으면 더 좋을 것 같아요!');

    const t2 = db.prepare(`
      INSERT INTO shared_thoughts (space_id, title, content, tags_json, status, is_pinned, author_id, updated_by)
      VALUES (?, ?, ?, ?, 'NEW', 0, ?, ?)
    `).run(
      spaceId,
      '매주 금요일 15분 퀵 싱크 제안',
      '긴 회의 대신 매주 금요일 오후에 15분만 각자 머릿속 고민 하나씩 꺼내놓는 루틴을 만들어보면 어떨까요?',
      JSON.stringify(['루틴', '소통']),
      userId,
      userId
    );
    void t2;

    // Demo Calendar Events (Confirmed + Proposed linked to t1)
    const ev1 = db.prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, location, attendee_ids_json, recurrence_type,
        reminder_minutes, event_status, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, '10:00', '11:30', 0, 'sky', '#0369A1', '온라인 줌', ?, 'WEEKLY', 30, 'CONFIRMED', ?, ?)
    `).run(
      spaceId,
      '주간 정기 싱크 미팅',
      '이번 주 핵심 이슈와 각자 공유 메모장에 올려둔 생각을 10분간 같이 훑어봅니다.',
      today,
      today,
      JSON.stringify([userId]),
      userId,
      userId
    );
    const ev1Id = Number(ev1.lastInsertRowid);

    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, '일정을 생성했습니다.')
    `).run(ev1Id, userId);

    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 0, '회의 시작 전에 공유 메모장에 올라온 워크숍 날짜도 같이 확정해요!')
    `).run(ev1Id, userId);

    // Multi-day event
    const ev2 = db.prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, is_all_day,
        label_key, color, location, attendee_ids_json, recurrence_type,
        event_status, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, 1, 'emerald', '#1B4D3E', '서울 성수동', ?, 'NONE', 'CONFIRMED', ?, ?)
    `).run(
      spaceId,
      '디자인 스프린트 집중 기간',
      'UI 시안 확정 및 프로토타입 테스트 2일간 집중 진행',
      dPlus1,
      dPlus2,
      JSON.stringify([userId]),
      userId,
      userId
    );
    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, '일정을 생성했습니다.')
    `).run(Number(ev2.lastInsertRowid), userId);

    // Proposed Calendar Event linked to thought t1
    const evProp = db.prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, location, attendee_ids_json, recurrence_type,
        reminder_minutes, event_status, linked_thought_id, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, '13:00', '18:00', 0, 'amber', '#B45309', '조용한 공유오피스 (미정)', ?, 'NONE', 60, 'PROPOSED', ?, ?, ?)
    `).run(
      spaceId,
      '팀 워크숍 & 브레인스토밍 데이',
      '공유 메모장의 생각에서 제안된 날짜 후보입니다. 가능 여부를 눌러주세요!',
      dPlus3,
      dPlus3,
      JSON.stringify([userId]),
      t1Id,
      userId,
      userId
    );
    const evPropId = Number(evProp.lastInsertRowid);
    db.prepare(`
      INSERT INTO calendar_event_votes (event_id, user_id, vote)
      VALUES (?, ?, 'AVAILABLE')
    `).run(evPropId, userId);
    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, '공유 메모장의 생각에서 이 날짜를 제안했습니다.')
    `).run(evPropId, userId);

    // Second date proposal for t1 to demonstrate multi-proposal flow
    const evProp2 = db.prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, attendee_ids_json, recurrence_type,
        event_status, linked_thought_id, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, '14:00', '18:00', 0, 'amber', '#B45309', ?, 'NONE', 'PROPOSED', ?, ?, ?)
    `).run(
      spaceId,
      '팀 워크숍 & 브레인스토밍 데이 (후보 2)',
      '이 날짜가 더 편하시면 여기서 확정할 수 있습니다.',
      dPlus5,
      dPlus5,
      JSON.stringify([userId]),
      t1Id,
      userId,
      userId
    );
    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, '공유 메모장의 생각에서 이 날짜를 제안했습니다.')
    `).run(Number(evProp2.lastInsertRowid), userId);

    db.prepare(`
      INSERT INTO space_activities (space_id, actor_id, activity_type, target_type, target_id, summary)
      VALUES (?, ?, 'EVENT_PROPOSED', 'EVENT', ?, ?)
    `).run(spaceId, userId, evPropId, `팀 워크숍 & 브레인스토밍 데이 (${dPlus3}) 날짜를 제안했습니다.`);

    void today;
  });

  tx();
}
