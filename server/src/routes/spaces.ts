import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import {
  db,
  DEFAULT_SPACE_LABELS,
  ensureDefaultSpaceForUser,
  generateInviteToken,
  SpaceLabelPreset,
} from '../db/database.js';
import { authenticateToken, JWT_SECRET } from '../middleware/auth.js';
import { getJstDateStr, getJstDateTimeStr, getJstTimeStr } from '../utils/jstTime.js';
import { PushNotificationPayload, sendPushToUsers } from '../utils/webPush.js';
import { broadcastSpaceUpdate, subscribeSpaceStream } from '../utils/spaceRealtime.js';
import {
  addUserToSpaceOnly,
  createJoinRequest,
  getLinkedProjectCountForSpace,
  getLinkedProjectsForSpace,
  getMyPendingJoinRequests,
  getPendingJoinRequestsForSpace,
  removeUserFromSpaceCascade,
  resolveJoinRequest,
  unlinkSpaceFromProject,
} from '../utils/linkedSpaceSync.js';
import {
  createCrossLink,
  CrossEntityType,
  getHydratedCrossLinks,
  removeLinksForEntity,
  syncContentAcrossLinkedEntities,
} from '../utils/crossLinkSync.js';

const router = Router();

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = String(fromYmd || '').slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(toYmd || '').slice(0, 10).split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

function isValidYmd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function normalizeTime(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return null;
}

function getMembership(spaceId: number, userId: number): { role: string; last_read_activity_id: number } | null {
  const row = db
    .prepare('SELECT role, last_read_activity_id FROM collab_space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId) as { role: string; last_read_activity_id: number } | undefined;
  return row || null;
}

function getSpaceMembers(spaceId: number) {
  return db
    .prepare(`
      SELECT m.user_id, u.name, u.email, m.role, m.joined_at
      FROM collab_space_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ?
      ORDER BY CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END, m.id ASC
    `)
    .all(spaceId) as Array<{
    user_id: number;
    name: string;
    email: string;
    role: 'OWNER' | 'MEMBER';
    joined_at: string;
  }>;
}

function getSpaceById(spaceId: number) {
  return db.prepare('SELECT * FROM collab_spaces WHERE id = ?').get(spaceId) as any | undefined;
}

function notifySpacePeers(
  spaceId: number,
  actorId: number,
  payload: PushNotificationPayload
) {
  const members = db
    .prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?')
    .all(spaceId) as Array<{ user_id: number }>;
  const peerIds = members.map((m) => Number(m.user_id)).filter((id) => id > 0 && id !== actorId);
  if (peerIds.length === 0) return;
  void sendPushToUsers(peerIds, payload);
}

function parseAttendeeIds(raw: unknown): number[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {}
  }
  return Array.from(new Set(list.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
}

function filterValidSpaceAttendees(spaceId: number, candidateIds: number[]): number[] {
  if (candidateIds.length === 0) return [];
  const members = db
    .prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?')
    .all(spaceId) as Array<{ user_id: number }>;
  const memberSet = new Set(members.map((m) => Number(m.user_id)));
  return Array.from(new Set(candidateIds.filter((id) => memberSet.has(id))));
}

function notifyEventAttendees(
  spaceId: number,
  attendeeIds: number[],
  actorId: number,
  payload: PushNotificationPayload
) {
  const valid = filterValidSpaceAttendees(spaceId, attendeeIds).filter((id) => id !== actorId);
  if (valid.length === 0) return;
  void sendPushToUsers(valid, payload);
}

function notifyThoughtParticipants(
  spaceId: number,
  thoughtId: number,
  thoughtAuthorId: number | null | undefined,
  actorId: number,
  payload: PushNotificationPayload
) {
  const commentAuthors = db
    .prepare('SELECT DISTINCT author_id FROM thought_comments WHERE thought_id = ?')
    .all(thoughtId) as Array<{ author_id: number | null }>;
  const candidates: number[] = [];
  if (thoughtAuthorId && Number(thoughtAuthorId) > 0) candidates.push(Number(thoughtAuthorId));
  for (const row of commentAuthors) {
    if (row.author_id && Number(row.author_id) > 0) candidates.push(Number(row.author_id));
  }
  const valid = filterValidSpaceAttendees(spaceId, candidates).filter((id) => id !== actorId);
  if (valid.length === 0) return;
  void sendPushToUsers(valid, payload);
}

function getMindmapProjectMemberIds(projectId: number): number[] {
  const p = db
    .prepare('SELECT id, mode, created_by FROM journal_projects WHERE id = ?')
    .get(projectId) as { id: number; mode: string; created_by: number } | undefined;
  if (!p) return [];
  const ids = new Set<number>();
  if (Number(p.created_by) > 0) ids.add(Number(p.created_by));
  if (p.mode === 'COLLAB') {
    const members = db
      .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
      .all(projectId) as Array<{ user_id: number }>;
    for (const m of members) {
      if (Number(m.user_id) > 0) ids.add(Number(m.user_id));
    }
  }
  return Array.from(ids);
}

function notifyMindmapProjectPeers(
  projectId: number,
  actorId: number,
  payload: PushNotificationPayload
) {
  const recipients = getMindmapProjectMemberIds(projectId).filter((id) => id > 0 && id !== actorId);
  if (recipients.length === 0) return;
  void sendPushToUsers(recipients, payload);
}

function recordActivity(
  spaceId: number,
  actorId: number,
  activityType: string,
  targetType: 'EVENT' | 'THOUGHT' | 'SPACE',
  targetId: number | null,
  summary: string,
  meta: Record<string, unknown> = {}
): number {
  const res = db
    .prepare(`
      INSERT INTO space_activities (space_id, actor_id, activity_type, target_type, target_id, summary, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(spaceId, actorId, activityType, targetType, targetId, summary, JSON.stringify(meta));
  const actId = Number(res.lastInsertRowid);

  // Mark actor as having read up to their own action
  db.prepare(`
    UPDATE collab_space_members
    SET last_read_activity_id = MAX(COALESCE(last_read_activity_id, 0), ?)
    WHERE space_id = ? AND user_id = ?
  `).run(actId, spaceId, actorId);

  db.prepare('UPDATE collab_spaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceId);
  broadcastSpaceUpdate(spaceId, activityType, { targetType, targetId, actorId });
  return actId;
}

function syncLinkedThoughtStatus(thoughtId: number) {
  const thought = db.prepare('SELECT id, status FROM shared_thoughts WHERE id = ?').get(thoughtId) as any;
  if (!thought || thought.status === 'ARCHIVED') return;

  const counts = db
    .prepare(`
      SELECT
        SUM(CASE WHEN event_status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed_cnt,
        SUM(CASE WHEN event_status = 'PROPOSED' THEN 1 ELSE 0 END) as proposed_cnt
      FROM calendar_events
      WHERE linked_thought_id = ?
    `)
    .get(thoughtId) as { confirmed_cnt: number | null; proposed_cnt: number | null };

  const confirmed = Number(counts?.confirmed_cnt || 0);
  const proposed = Number(counts?.proposed_cnt || 0);

  let nextStatus = thought.status;
  if (confirmed > 0) {
    nextStatus = 'SCHEDULED';
  } else if (proposed > 0) {
    nextStatus = 'PROPOSED';
  } else if (thought.status === 'PROPOSED' || thought.status === 'SCHEDULED') {
    nextStatus = 'DISCUSSING';
  }

  if (nextStatus !== thought.status) {
    db.prepare('UPDATE shared_thoughts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      nextStatus,
      thoughtId
    );
  }
}

function hydrateEventRows(rows: any[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');

  const voteRows = db
    .prepare(`
      SELECT v.event_id, v.user_id, v.vote, u.name as user_name
      FROM calendar_event_votes v
      INNER JOIN users u ON u.id = v.user_id
      WHERE v.event_id IN (${placeholders})
      ORDER BY v.id ASC
    `)
    .all(...ids) as Array<{ event_id: number; user_id: number; vote: 'AVAILABLE' | 'UNAVAILABLE'; user_name: string }>;

  const votesByEvent = new Map<number, typeof voteRows>();
  for (const v of voteRows) {
    const arr = votesByEvent.get(Number(v.event_id)) || [];
    arr.push(v);
    votesByEvent.set(Number(v.event_id), arr);
  }

  const commentCounts = db
    .prepare(`
      SELECT event_id, COUNT(*) as total_cnt, SUM(CASE WHEN is_system = 0 THEN 1 ELSE 0 END) as chat_cnt
      FROM calendar_event_comments
      WHERE event_id IN (${placeholders})
      GROUP BY event_id
    `)
    .all(...ids) as Array<{ event_id: number; total_cnt: number; chat_cnt: number }>;

  const commentCountMap = new Map<number, { total: number; chat: number }>();
  for (const c of commentCounts) {
    commentCountMap.set(Number(c.event_id), { total: Number(c.total_cnt || 0), chat: Number(c.chat_cnt || 0) });
  }

  const thoughtIds = Array.from(
    new Set(rows.map((r) => (r.linked_thought_id ? Number(r.linked_thought_id) : 0)).filter((id) => id > 0))
  );
  const thoughtMap = new Map<number, { id: number; title: string; content: string; status: string }>();
  if (thoughtIds.length > 0) {
    const tPh = thoughtIds.map(() => '?').join(',');
    const tRows = db
      .prepare(`SELECT id, title, content, status FROM shared_thoughts WHERE id IN (${tPh})`)
      .all(...thoughtIds) as Array<{ id: number; title: string; content: string; status: string }>;
    for (const t of tRows) {
      thoughtMap.set(Number(t.id), t);
    }
  }

  return rows.map((r) => {
    const eid = Number(r.id);
    const counts = commentCountMap.get(eid) || { total: 0, chat: 0 };
    const linkedThought = r.linked_thought_id ? thoughtMap.get(Number(r.linked_thought_id)) || null : null;
    return {
      id: eid,
      space_id: Number(r.space_id),
      title: r.title,
      description: r.description || '',
      start_date: r.start_date,
      end_date: r.end_date,
      start_time: r.start_time || null,
      end_time: r.end_time || null,
      is_all_day: Boolean(r.is_all_day),
      label_key: r.label_key || 'emerald',
      color: r.color || '#1B4D3E',
      text_color: r.text_color || '#FFFFFF',
      location: r.location || '',
      url: r.url || '',
      attendee_ids: safeJsonParse<number[]>(r.attendee_ids_json, []),
      recurrence_type: r.recurrence_type || 'NONE',
      recurrence_until: r.recurrence_until || null,
      reminder_minutes: r.reminder_minutes !== null && r.reminder_minutes !== undefined ? Number(r.reminder_minutes) : null,
      event_status: r.event_status || 'CONFIRMED',
      linked_thought_id: r.linked_thought_id ? Number(r.linked_thought_id) : null,
      linked_thought: linkedThought,
      created_by: Number(r.created_by),
      creator_name: r.creator_name || '',
      updated_by: r.updated_by ? Number(r.updated_by) : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
      votes: votesByEvent.get(eid) || [],
      comment_count: counts.chat,
      total_log_count: counts.total,
      mindmap_links: getHydratedCrossLinks('EVENT', eid, ['PROJECT', 'IDEA', 'ENTRY']),
    };
  });
}

function hydrateThoughtRows(rows: any[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const placeholders = ids.map(() => '?').join(',');

  const reactionRows = db
    .prepare(`
      SELECT r.thought_id, r.user_id, r.stance, u.name as user_name
      FROM thought_reactions r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.thought_id IN (${placeholders})
      ORDER BY r.id ASC
    `)
    .all(...ids) as Array<{ thought_id: number; user_id: number; stance: 'GOOD' | 'THINK' | 'BAD'; user_name: string }>;

  const reactionsByThought = new Map<number, typeof reactionRows>();
  for (const r of reactionRows) {
    const arr = reactionsByThought.get(Number(r.thought_id)) || [];
    arr.push(r);
    reactionsByThought.set(Number(r.thought_id), arr);
  }

  const commentStats = db
    .prepare(`
      SELECT
        thought_id,
        COUNT(*) as comment_count,
        SUM(CASE WHEN comment_type IN ('EDIT_PROPOSAL', 'ADD_PROPOSAL') AND applied_at IS NULL THEN 1 ELSE 0 END) as open_proposal_count
      FROM thought_comments
      WHERE thought_id IN (${placeholders})
      GROUP BY thought_id
    `)
    .all(...ids) as Array<{ thought_id: number; comment_count: number; open_proposal_count: number }>;

  const commentStatMap = new Map<number, { comment_count: number; open_proposal_count: number }>();
  for (const c of commentStats) {
    commentStatMap.set(Number(c.thought_id), {
      comment_count: Number(c.comment_count || 0),
      open_proposal_count: Number(c.open_proposal_count || 0),
    });
  }

  const revCounts = db
    .prepare(`
      SELECT thought_id, COUNT(*) as rev_count
      FROM thought_revisions
      WHERE thought_id IN (${placeholders})
      GROUP BY thought_id
    `)
    .all(...ids) as Array<{ thought_id: number; rev_count: number }>;
  const revCountMap = new Map<number, number>();
  for (const rc of revCounts) {
    revCountMap.set(Number(rc.thought_id), Number(rc.rev_count || 0));
  }

  const linkedEventRows = db
    .prepare(`
      SELECT e.*, u.name as creator_name
      FROM calendar_events e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.linked_thought_id IN (${placeholders})
        AND e.event_status != 'CANCELLED'
      ORDER BY e.start_date ASC, e.id ASC
    `)
    .all(...ids) as any[];

  const hydratedEvents = hydrateEventRows(linkedEventRows);
  const eventsByThought = new Map<number, any[]>();
  for (const ev of hydratedEvents) {
    if (!ev.linked_thought_id) continue;
    const arr = eventsByThought.get(ev.linked_thought_id) || [];
    arr.push(ev);
    eventsByThought.set(ev.linked_thought_id, arr);
  }

  return rows.map((r) => {
    const tid = Number(r.id);
    const stats = commentStatMap.get(tid) || { comment_count: 0, open_proposal_count: 0 };
    return {
      id: tid,
      space_id: Number(r.space_id),
      title: r.title || '',
      content: r.content,
      tags: safeJsonParse<string[]>(r.tags_json, []),
      status: r.status || 'NEW',
      is_pinned: Boolean(r.is_pinned),
      is_important: Boolean(r.is_important),
      author_id: Number(r.author_id),
      author_name: r.author_name || '',
      updated_by: r.updated_by ? Number(r.updated_by) : null,
      updated_by_name: r.updated_by_name || '',
      created_at: r.created_at,
      updated_at: r.updated_at,
      reactions: reactionsByThought.get(tid) || [],
      comment_count: stats.comment_count,
      open_proposal_count: stats.open_proposal_count,
      revision_count: revCountMap.get(tid) || 0,
      linked_events: eventsByThought.get(tid) || [],
      mindmap_links: getHydratedCrossLinks('THOUGHT', tid, ['PROJECT', 'IDEA', 'ENTRY']),
    };
  });
}

// ==========================================
// 1. REALTIME SSE STREAM (query token auth)
// ==========================================
router.get('/:spaceId/stream', (req: Request, res: Response) => {
  const spaceId = Number(req.params.spaceId);
  const rawToken =
    (typeof req.query.token === 'string' ? req.query.token : '') ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');

  if (!rawToken || !Number.isInteger(spaceId) || spaceId <= 0) {
    res.status(401).end();
    return;
  }

  let userId = 0;
  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET) as any;
    userId = Number(decoded.id);
  } catch {
    res.status(401).end();
    return;
  }

  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ spaceId, ok: true })}\n\n`);
  const cleanup = subscribeSpaceStream(spaceId, userId, res);

  req.on('close', () => {
    cleanup();
    res.end();
  });
});

// Protect all other routes with standard JWT middleware
router.use(authenticateToken);

const DEFAULT_LABEL_PALETTE = [
  '#1B4D3E',
  '#0369A1',
  '#BE123C',
  '#B45309',
  '#6D28D9',
  '#0F766E',
  '#334155',
  '#EC4899',
  '#FACC15',
  '#BAE6FD',
];
const DEFAULT_TEXT_PALETTE = ['#FFFFFF', '#111827', '#FEF08A', '#1E3A8A', '#7F1D1D'];

function normalizeHexPalette(raw: unknown, defaults: string[]): string[] {
  if (!Array.isArray(raw) || raw.length !== defaults.length) return [...defaults];
  return raw.map((item, idx) => {
    const s = String(item || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : defaults[idx];
  });
}

router.get('/palette', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const row = db.prepare('SELECT calendar_palette_json FROM users WHERE id = ?').get(userId) as
    | { calendar_palette_json?: string | null }
    | undefined;
  const parsed = safeJsonParse<{ labelColors?: unknown; textColors?: unknown }>(row?.calendar_palette_json, {});
  res.json({
    labelColors: normalizeHexPalette(parsed.labelColors, DEFAULT_LABEL_PALETTE),
    textColors: normalizeHexPalette(parsed.textColors, DEFAULT_TEXT_PALETTE),
  });
});

router.put('/palette', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const labelColors = normalizeHexPalette(req.body?.labelColors, DEFAULT_LABEL_PALETTE);
  const textColors = normalizeHexPalette(req.body?.textColors, DEFAULT_TEXT_PALETTE);
  db.prepare('UPDATE users SET calendar_palette_json = ? WHERE id = ?').run(
    JSON.stringify({ labelColors, textColors }),
    userId
  );
  res.json({ labelColors, textColors });
});

// ==========================================
// 2. SPACES CRUD & INVITATIONS
// ==========================================
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.id;
  ensureDefaultSpaceForUser(userId);

  const rows = db
    .prepare(`
      SELECT s.*, m.role as my_role, m.last_read_activity_id,
        (SELECT COUNT(*) FROM space_activities a WHERE a.space_id = s.id AND a.id > COALESCE(m.last_read_activity_id, 0) AND a.actor_id != ?) as unread_count,
        (SELECT COUNT(*) FROM shared_thoughts t WHERE t.space_id = s.id AND t.status != 'ARCHIVED') as thought_count,
        (SELECT COUNT(*) FROM calendar_events e WHERE e.space_id = s.id AND e.event_status = 'PROPOSED') as proposed_event_count
      FROM collab_spaces s
      INNER JOIN collab_space_members m ON m.space_id = s.id
      WHERE m.user_id = ?
      ORDER BY s.is_personal DESC, s.id ASC
    `)
    .all(userId, userId) as any[];

  const spaces = rows.map((s) => {
    const sid = Number(s.id);
    const parsedLabels = safeJsonParse<SpaceLabelPreset[]>(s.labels_json, DEFAULT_SPACE_LABELS);
    const isOwner = s.my_role === 'OWNER';
    const linkedInfo = getLinkedProjectsForSpace(sid, userId, isOwner);
    const pendingJoinRequests = getPendingJoinRequestsForSpace(sid, userId, isOwner);
    const firstLinked = linkedInfo.linked_projects[0] || null;
    const hasAnyLinkedProject = linkedInfo.total_count > 0;
    return {
      id: sid,
      name: s.name,
      description: s.description || '',
      color: s.color || '#1B4D3E',
      is_personal: Boolean(s.is_personal),
      linked_project_id: firstLinked ? firstLinked.id : null,
      linked_project: firstLinked,
      linked_projects: linkedInfo.linked_projects,
      managed_linked_projects: linkedInfo.managed_linked_projects,
      linked_project_count: linkedInfo.total_count,
      pending_join_requests: pendingJoinRequests,
      pending_join_request_count: pendingJoinRequests.length,
      invite_token: hasAnyLinkedProject && !isOwner ? null : s.invite_token,
      member_invite_token: s.member_invite_token || null,
      labels: parsedLabels.length > 0 ? parsedLabels : DEFAULT_SPACE_LABELS,
      created_by: Number(s.created_by),
      my_role: s.my_role as 'OWNER' | 'MEMBER',
      unread_count: Number(s.unread_count || 0),
      thought_count: Number(s.thought_count || 0),
      proposed_event_count: Number(s.proposed_event_count || 0),
      members: getSpaceMembers(sid),
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  });

  const my_pending_join_requests = getMyPendingJoinRequests(userId);
  res.json({ spaces, my_pending_join_requests });
});

router.post('/', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const color = String(req.body?.color || '#1B4D3E').trim() || '#1B4D3E';
  const isPersonal = req.body?.is_personal ? 1 : 0;

  if (!name) {
    res.status(400).json({ error: '스페이스 이름을 입력해 주세요.' });
    return;
  }

  const inviteToken = generateInviteToken();
  const memberInviteToken = generateInviteToken();
  const labels =
    Array.isArray(req.body?.labels) && req.body.labels.length > 0 ? req.body.labels : DEFAULT_SPACE_LABELS;

  const tx = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO collab_spaces (name, description, color, is_personal, invite_token, member_invite_token, labels_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(name, description, color, isPersonal, inviteToken, memberInviteToken, JSON.stringify(labels), userId);
    const spaceId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
      VALUES (?, ?, 'OWNER', 0)
    `).run(spaceId, userId);
    return spaceId;
  });

  const spaceId = tx();
  res.status(201).json({ id: spaceId });
});

router.patch('/:spaceId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '이 스페이스에 접근 권한이 없습니다.' });
    return;
  }

  const existing = getSpaceById(spaceId);
  if (!existing) {
    res.status(404).json({ error: '스페이스를 찾을 수 없습니다.' });
    return;
  }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
  const color = req.body?.color !== undefined ? String(req.body.color).trim() || '#1B4D3E' : existing.color;
  const labelsJson =
    Array.isArray(req.body?.labels) && req.body.labels.length > 0
      ? JSON.stringify(req.body.labels)
      : existing.labels_json;

  if (!name) {
    res.status(400).json({ error: '스페이스 이름은 비워둘 수 없습니다.' });
    return;
  }

  db.prepare(`
    UPDATE collab_spaces
    SET name = ?, description = ?, color = ?, labels_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, description, color, labelsJson, spaceId);

  broadcastSpaceUpdate(spaceId, 'SPACE_UPDATED', { actorId: userId });
  res.json({ ok: true });
});

router.delete('/:spaceId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership || membership.role !== 'OWNER') {
    res.status(403).json({ error: '스페이스 삭제는 방장만 가능합니다.' });
    return;
  }

  db.transaction(() => {
    db.prepare("DELETE FROM collab_join_requests WHERE space_id = ? AND status = 'PENDING' AND approver_type = 'SPACE_OWNER'").run(spaceId);
    db.prepare("UPDATE collab_join_requests SET space_id = NULL, scope = 'PROJECT_ONLY', approver_type = 'PROJECT_OWNER' WHERE space_id = ? AND status = 'PENDING'").run(spaceId);
    db.prepare('DELETE FROM collab_spaces WHERE id = ?').run(spaceId);
  })();
  broadcastSpaceUpdate(spaceId, 'SPACE_DELETED', { actorId: userId });
  res.json({ ok: true });
});

router.delete('/:spaceId/linked-projects/:projectId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const projectId = Number(req.params.projectId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }

  const proj = db
    .prepare('SELECT id, linked_space_id FROM journal_projects WHERE id = ?')
    .get(projectId) as { id: number; linked_space_id: number | null } | undefined;
  if (!proj || Number(proj.linked_space_id || 0) !== spaceId) {
    res.status(404).json({ error: '해당 스페이스에 연동된 프로젝트를 찾을 수 없습니다.' });
    return;
  }

  try {
    unlinkSpaceFromProject({
      projectId,
      actorId: userId,
      actorName: req.user!.name,
      reason: 'MANUAL',
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(403).json({ error: err.message || '연동 해제에 실패했습니다.' });
  }
});

router.post('/:spaceId/regenerate-invite', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership || membership.role !== 'OWNER') {
    res.status(403).json({ error: '초대 링크 재발급은 방장만 가능합니다.' });
    return;
  }

  const kind = req.body?.kind === 'member' ? 'member' : 'owner';
  const existing = getSpaceById(spaceId);
  if (!existing) {
    res.status(404).json({ error: '스페이스를 찾을 수 없습니다.' });
    return;
  }

  if (kind === 'member') {
    const nextMemberToken = generateInviteToken();
    db.prepare('UPDATE collab_spaces SET member_invite_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      nextMemberToken,
      spaceId
    );
    res.json({ invite_token: existing.invite_token, member_invite_token: nextMemberToken });
    return;
  }

  const nextToken = generateInviteToken();
  const memberToken = existing.member_invite_token || generateInviteToken();
  db.prepare(
    'UPDATE collab_spaces SET invite_token = ?, member_invite_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(nextToken, memberToken, spaceId);
  res.json({ invite_token: nextToken, member_invite_token: memberToken });
});

router.post('/:spaceId/invite-email', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: '초대할 이메일을 입력해 주세요.' });
    return;
  }

  const targetUser = db
    .prepare('SELECT id, name, email FROM users WHERE LOWER(email) = ?')
    .get(email) as { id: number; name: string; email: string } | undefined;

  if (!targetUser) {
    res.status(404).json({ error: '해당 이메일로 가입된 회원을 찾을 수 없습니다. 초대 링크를 공유해 주세요.' });
    return;
  }

  const already = getMembership(spaceId, Number(targetUser.id));
  if (already) {
    res.status(409).json({ error: '이미 이 스페이스에 참여 중인 멤버입니다.' });
    return;
  }

  const space = getSpaceById(spaceId);
  const linkedProjectCount = getLinkedProjectCountForSpace(spaceId);

  // Linked space (1:N): adding a member joins the SPACE ONLY (never auto-adds to linked projects).
  if (linkedProjectCount > 0) {
    const isOwner = membership.role === 'OWNER';
    if (isOwner) {
      addUserToSpaceOnly({
        spaceId,
        targetUserId: Number(targetUser.id),
        actorId: userId,
        actorName: req.user!.name,
      });
      res.status(201).json({
        member: targetUser,
        pendingApproval: false,
        pending_join_requests: getPendingJoinRequestsForSpace(spaceId, userId, true),
      });
      return;
    }

    const reqRes = createJoinRequest({
      projectId: null,
      spaceId,
      targetUserId: Number(targetUser.id),
      invitedByUserId: userId,
      invitedByName: req.user!.name,
      source: 'SPACE',
      scope: 'SPACE_ONLY',
      approverType: 'SPACE_OWNER',
    });
    res.status(202).json({
      member: targetUser,
      pendingApproval: true,
      alreadyPending: reqRes.alreadyPending,
      request: reqRes.request,
      pending_join_requests: getPendingJoinRequestsForSpace(spaceId, userId, false),
    });
    return;
  }

  db.prepare(`
    INSERT INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
    VALUES (?, ?, 'MEMBER', 0)
  `).run(spaceId, Number(targetUser.id));

  if (space?.is_personal) {
    db.prepare('UPDATE collab_spaces SET is_personal = 0 WHERE id = ?').run(spaceId);
  }

  recordActivity(
    spaceId,
    userId,
    'MEMBER_JOINED',
    'SPACE',
    spaceId,
    `${req.user!.name}님이 ${targetUser.name}님을 스페이스에 초대했습니다.`
  );

  void sendPushToUsers([Number(targetUser.id)], {
    title: `📅 ${space?.name || '공유 스페이스'}`,
    body: `${req.user!.name}님이 공유 캘린더 · 메모장에 초대했습니다.`,
    url: `/?tab=calendar&space=${spaceId}`,
    tag: `space-invite-${spaceId}`,
  });

  res.status(201).json({ member: targetUser });
});

router.post('/join/:inviteToken', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const inviteToken = String(req.params.inviteToken || '').trim();
  if (!inviteToken) {
    res.status(400).json({ error: '유효하지 않은 초대 코드입니다.' });
    return;
  }

  const space = db
    .prepare('SELECT * FROM collab_spaces WHERE invite_token = ? OR member_invite_token = ?')
    .get(inviteToken, inviteToken) as any;
  if (!space) {
    res.status(404).json({ error: '초대 링크가 만료되었거나 스페이스를 찾을 수 없습니다.' });
    return;
  }

  const spaceId = Number(space.id);
  const existing = getMembership(spaceId, userId);
  const linkedProjectCount = getLinkedProjectCountForSpace(spaceId);

  if (linkedProjectCount > 0) {
    if (existing) {
      res.json({
        spaceId,
        name: space.name,
        alreadyMember: true,
      });
      return;
    }

    const isMemberToken = space.member_invite_token === inviteToken;
    if (isMemberToken) {
      const reqRes = createJoinRequest({
        projectId: null,
        spaceId,
        targetUserId: userId,
        invitedByUserId: null,
        invitedByName: '',
        source: 'SPACE',
        scope: 'SPACE_ONLY',
        approverType: 'SPACE_OWNER',
      });
      res.status(202).json({
        spaceId,
        name: space.name,
        pendingApproval: true,
        alreadyPending: reqRes.alreadyPending,
        requestId: reqRes.request.id,
      });
      return;
    }

    addUserToSpaceOnly({
      spaceId,
      targetUserId: userId,
      actorId: userId,
      actorName: req.user!.name,
      viaLink: true,
    });
    res.json({
      spaceId,
      name: space.name,
      alreadyMember: false,
      joined: true,
    });
    return;
  }

  if (!existing) {
    db.prepare(`
      INSERT INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
      VALUES (?, ?, 'MEMBER', 0)
    `).run(spaceId, userId);

    if (space.is_personal) {
      db.prepare('UPDATE collab_spaces SET is_personal = 0 WHERE id = ?').run(spaceId);
    }

    recordActivity(
      spaceId,
      userId,
      'MEMBER_JOINED',
      'SPACE',
      spaceId,
      `${req.user!.name}님이 초대 링크로 스페이스에 참여했습니다.`
    );

    notifySpacePeers(spaceId, userId, {
      title: `📅 ${space.name}`,
      body: `${req.user!.name}님이 공유 스페이스에 참여했습니다.`,
      url: `/?tab=calendar&space=${spaceId}`,
      tag: `space-join-${spaceId}`,
    });
  }

  res.json({ spaceId, name: space.name, alreadyMember: Boolean(existing) });
});

router.delete('/:spaceId/members/:memberUserId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const targetUserId = Number(req.params.memberUserId);
  const membership = getMembership(spaceId, userId);

  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }

  const isSelf = targetUserId === userId;
  if (!isSelf && membership.role !== 'OWNER') {
    res.status(403).json({ error: '다른 멤버 추방은 방장만 가능합니다.' });
    return;
  }

  const targetMembership = getMembership(spaceId, targetUserId);
  if (!targetMembership) {
    res.status(404).json({ error: '해당 멤버를 찾을 수 없습니다.' });
    return;
  }

  if (targetMembership.role === 'OWNER') {
    res.status(400).json({ error: '방장은 나갈 수 없습니다. 스페이스를 삭제해 주세요.' });
    return;
  }

  try {
    const cascadeRes = removeUserFromSpaceCascade({
      spaceId,
      targetUserId,
      actorId: userId,
      actorName: req.user!.name,
    });
    res.json({
      ok: true,
      removed_project_ids: cascadeRes.removedProjectIds,
      unlinked_owned_projects: cascadeRes.unlinkedOwnedProjects,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '처리에 실패했습니다.' });
  }
});

router.get('/:spaceId/join-requests', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }
  res.json({ requests: getPendingJoinRequestsForSpace(spaceId, userId, membership.role === 'OWNER') });
});

router.post('/:spaceId/join-requests/:requestId/approve', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const requestId = Number(req.params.requestId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }
  try {
    const result = resolveJoinRequest({
      requestId,
      actorUserId: userId,
      actorName: req.user!.name,
      decision: 'APPROVED',
    });
    res.json({
      ok: true,
      request: result.request,
      members: getSpaceMembers(spaceId),
      pending_join_requests: getPendingJoinRequestsForSpace(spaceId, userId, membership.role === 'OWNER'),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '승인 처리에 실패했습니다.' });
  }
});

router.post('/:spaceId/join-requests/:requestId/reject', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const requestId = Number(req.params.requestId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '스페이스 접근 권한이 없습니다.' });
    return;
  }
  try {
    const result = resolveJoinRequest({
      requestId,
      actorUserId: userId,
      actorName: req.user!.name,
      decision: 'REJECTED',
    });
    res.json({
      ok: true,
      request: result.request,
      pending_join_requests: getPendingJoinRequestsForSpace(spaceId, userId, membership.role === 'OWNER'),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || '거절 처리에 실패했습니다.' });
  }
});

// ==========================================
// 3. ACTIVITIES (WHAT'S NEW / 새 소식)
// ==========================================
router.get('/:spaceId/activities', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const rows = db
    .prepare(`
      SELECT a.*, u.name as actor_name
      FROM space_activities a
      INNER JOIN users u ON u.id = a.actor_id
      WHERE a.space_id = ?
      ORDER BY a.id DESC
      LIMIT 60
    `)
    .all(spaceId) as any[];

  const lastReadId = Number(membership.last_read_activity_id || 0);
  const activities = rows.map((a) => ({
    id: Number(a.id),
    space_id: Number(a.space_id),
    actor_id: Number(a.actor_id),
    actor_name: a.actor_name,
    activity_type: a.activity_type,
    target_type: a.target_type,
    target_id: a.target_id ? Number(a.target_id) : null,
    summary: a.summary,
    meta: safeJsonParse<Record<string, unknown>>(a.meta_json, {}),
    is_unread: Number(a.id) > lastReadId && Number(a.actor_id) !== userId,
    created_at: a.created_at,
  }));

  res.json({ activities, last_read_activity_id: lastReadId });
});

router.post('/:spaceId/activities/read', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const membership = getMembership(spaceId, userId);
  if (!membership) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const latest = db
    .prepare('SELECT MAX(id) as max_id FROM space_activities WHERE space_id = ?')
    .get(spaceId) as { max_id: number | null };

  const maxId = Number(latest?.max_id || 0);
  db.prepare(`
    UPDATE collab_space_members
    SET last_read_activity_id = MAX(COALESCE(last_read_activity_id, 0), ?)
    WHERE space_id = ? AND user_id = ?
  `).run(maxId, spaceId, userId);

  res.json({ ok: true, last_read_activity_id: maxId });
});

// ==========================================
// 4. CALENDAR EVENTS (TimeTree Core)
// ==========================================
router.get('/:spaceId/events', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const rows = db
    .prepare(`
      SELECT e.*, u.name as creator_name
      FROM calendar_events e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.space_id = ? AND e.event_status != 'CANCELLED'
      ORDER BY e.start_date ASC, e.is_all_day DESC, COALESCE(e.start_time, '00:00') ASC, e.id ASC
    `)
    .all(spaceId) as any[];

  const recentRows = db
    .prepare(`
      SELECT e.*, u.name as creator_name
      FROM calendar_events e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.space_id = ? AND e.event_status != 'CANCELLED'
      ORDER BY e.id DESC
      LIMIT 10
    `)
    .all(spaceId) as any[];

  res.json({
    events: hydrateEventRows(rows),
    recentEvents: hydrateEventRows(recentRows),
  });
});

router.post('/:spaceId/events', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const title = String(req.body?.title || '').trim();
  const startDate = String(req.body?.start_date || '').trim();
  const endDate = isValidYmd(req.body?.end_date) ? String(req.body.end_date).trim() : startDate;

  if (!title) {
    res.status(400).json({ error: '일정 제목을 입력해 주세요.' });
    return;
  }
  if (!isValidYmd(startDate)) {
    res.status(400).json({ error: '유효한 시작 날짜(YYYY-MM-DD)가 필요합니다.' });
    return;
  }

  const finalEndDate = endDate < startDate ? startDate : endDate;
  const isAllDay = req.body?.is_all_day !== false ? 1 : 0;
  const startTime = isAllDay ? null : normalizeTime(req.body?.start_time) || '09:00';
  const endTime = isAllDay ? null : normalizeTime(req.body?.end_time) || startTime;
  const labelKey = String(req.body?.label_key || 'emerald').trim();
  const color = String(req.body?.color || '#1B4D3E').trim();
  const textColor = String(req.body?.text_color || '#FFFFFF').trim() || '#FFFFFF';
  const location = String(req.body?.location || '').trim();
  const url = String(req.body?.url || '').trim();
  const description = String(req.body?.description || '').trim();
  const attendeeIds = filterValidSpaceAttendees(spaceId, parseAttendeeIds(req.body?.attendee_ids));
  const recurrenceType = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(req.body?.recurrence_type)
    ? req.body.recurrence_type
    : 'NONE';
  const recurrenceUntil = isValidYmd(req.body?.recurrence_until) ? req.body.recurrence_until : null;
  const reminderMinutes =
    req.body?.reminder_minutes !== null &&
    req.body?.reminder_minutes !== undefined &&
    req.body?.reminder_minutes !== ''
      ? Number(req.body.reminder_minutes)
      : null;
  const eventStatus = req.body?.event_status === 'PROPOSED' ? 'PROPOSED' : 'CONFIRMED';
  const linkedThoughtId = req.body?.linked_thought_id ? Number(req.body.linked_thought_id) : null;

  const result = db
    .prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, text_color, location, url, attendee_ids_json,
        recurrence_type, recurrence_until, reminder_minutes, event_status,
        linked_thought_id, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      spaceId,
      title,
      description,
      startDate,
      finalEndDate,
      startTime,
      endTime,
      isAllDay,
      labelKey,
      color,
      textColor,
      location,
      url,
      JSON.stringify(attendeeIds),
      recurrenceType,
      recurrenceUntil,
      Number.isFinite(reminderMinutes) ? reminderMinutes : null,
      eventStatus,
      linkedThoughtId,
      userId,
      userId
    );

  const eventId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
    VALUES (?, ?, 1, ?)
  `).run(
    eventId,
    userId,
    eventStatus === 'PROPOSED'
      ? `${req.user!.name}님이 이 날짜로 일정을 제안했습니다.`
      : `${req.user!.name}님이 일정을 생성했습니다.`
  );

  if (eventStatus === 'PROPOSED') {
    db.prepare(`
      INSERT OR REPLACE INTO calendar_event_votes (event_id, user_id, vote)
      VALUES (?, ?, 'AVAILABLE')
    `).run(eventId, userId);
  }

  if (linkedThoughtId) {
    syncLinkedThoughtStatus(linkedThoughtId);
  }

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const summary =
    eventStatus === 'PROPOSED'
      ? `${actorName}님이 '${title}' (${startDate}) 일정을 제안했습니다.`
      : `${actorName}님이 '${title}' (${startDate}) 일정을 추가했습니다.`;
  const summaryJa =
    eventStatus === 'PROPOSED'
      ? `${actorName}さんが「${title}」(${startDate})の日程を提案しました。`
      : `${actorName}さんが「${title}」(${startDate})の予定を追加しました。`;
  const summaryEn =
    eventStatus === 'PROPOSED'
      ? `${actorName} proposed '${title}' (${startDate}).`
      : `${actorName} added event '${title}' (${startDate}).`;

  recordActivity(
    spaceId,
    userId,
    eventStatus === 'PROPOSED' ? 'EVENT_PROPOSED' : 'EVENT_CREATED',
    'EVENT',
    eventId,
    summary,
    { startDate, title }
  );

  notifyEventAttendees(spaceId, attendeeIds, userId, {
    titleKo: `📅 ${spaceName}`,
    bodyKo: summary,
    titleJa: `📅 ${spaceName}`,
    bodyJa: summaryJa,
    titleEn: `📅 ${spaceName}`,
    bodyEn: summaryEn,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `space-ev-${eventId}`,
  });

  const created = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);

  res.status(201).json({ event: hydrateEventRows([created])[0] });
});

router.get('/:spaceId/events/:eventId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const row = db
    .prepare(`
      SELECT e.*, u.name as creator_name
      FROM calendar_events e
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = ? AND e.space_id = ?
    `)
    .get(eventId, spaceId) as any;

  if (!row) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const comments = db
    .prepare(`
      SELECT c.*, u.name as author_name
      FROM calendar_event_comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.event_id = ?
      ORDER BY c.id ASC
    `)
    .all(eventId) as any[];

  const siblingProposals = row.linked_thought_id
    ? (db
        .prepare(`
          SELECT id, title, start_date, end_date, start_time, is_all_day, event_status
          FROM calendar_events
          WHERE linked_thought_id = ? AND id != ? AND event_status = 'PROPOSED'
        `)
        .all(Number(row.linked_thought_id), eventId) as any[])
    : [];

  res.json({
    event: hydrateEventRows([row])[0],
    comments: comments.map((c) => ({
      id: Number(c.id),
      event_id: Number(c.event_id),
      author_id: c.author_id ? Number(c.author_id) : null,
      author_name: c.author_name || '',
      is_system: Boolean(c.is_system),
      content: c.content,
      created_at: c.created_at,
    })),
    sibling_proposals: siblingProposals,
  });
});

router.patch('/:spaceId/events/:eventId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!existing) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
  const startDate = isValidYmd(req.body?.start_date) ? String(req.body.start_date).trim() : existing.start_date;
  const rawEnd = isValidYmd(req.body?.end_date) ? String(req.body.end_date).trim() : existing.end_date;
  const endDate = rawEnd < startDate ? startDate : rawEnd;
  const isAllDay = req.body?.is_all_day !== undefined ? (req.body.is_all_day ? 1 : 0) : existing.is_all_day;
  const startTime = isAllDay
    ? null
    : req.body?.start_time !== undefined
      ? normalizeTime(req.body.start_time) || '09:00'
      : existing.start_time || '09:00';
  const endTime = isAllDay
    ? null
    : req.body?.end_time !== undefined
      ? normalizeTime(req.body.end_time) || startTime
      : existing.end_time || startTime;
  const labelKey = req.body?.label_key !== undefined ? String(req.body.label_key) : existing.label_key;
  const color = req.body?.color !== undefined ? String(req.body.color) : existing.color;
  const textColor =
    req.body?.text_color !== undefined ? String(req.body.text_color).trim() || '#FFFFFF' : existing.text_color || '#FFFFFF';
  const location = req.body?.location !== undefined ? String(req.body.location).trim() : existing.location;
  const url = req.body?.url !== undefined ? String(req.body.url).trim() : existing.url;
  const description = req.body?.description !== undefined ? String(req.body.description).trim() : existing.description;
  const prevAttendeeIds = parseAttendeeIds(existing.attendee_ids_json);
  const nextAttendeeIds = Array.isArray(req.body?.attendee_ids)
    ? filterValidSpaceAttendees(spaceId, parseAttendeeIds(req.body.attendee_ids))
    : prevAttendeeIds;
  const attendeeIdsJson = Array.isArray(req.body?.attendee_ids)
    ? JSON.stringify(nextAttendeeIds)
    : existing.attendee_ids_json;
  const recurrenceType =
    req.body?.recurrence_type !== undefined &&
    ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(req.body.recurrence_type)
      ? req.body.recurrence_type
      : existing.recurrence_type;
  const recurrenceUntil =
    req.body?.recurrence_until !== undefined
      ? isValidYmd(req.body.recurrence_until)
        ? req.body.recurrence_until
        : null
      : existing.recurrence_until;
  const reminderMinutes =
    req.body?.reminder_minutes !== undefined
      ? req.body.reminder_minutes === null || req.body.reminder_minutes === ''
        ? null
        : Number(req.body.reminder_minutes)
      : existing.reminder_minutes;

  if (!title) {
    res.status(400).json({ error: '일정 제목은 비워둘 수 없습니다.' });
    return;
  }

  db.prepare(`
    UPDATE calendar_events
    SET title = ?, description = ?, start_date = ?, end_date = ?, start_time = ?, end_time = ?,
        is_all_day = ?, label_key = ?, color = ?, text_color = ?, location = ?, url = ?, attendee_ids_json = ?,
        recurrence_type = ?, recurrence_until = ?, reminder_minutes = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    title,
    description,
    startDate,
    endDate,
    startTime,
    endTime,
    isAllDay,
    labelKey,
    color,
    textColor,
    location,
    url,
    attendeeIdsJson,
    recurrenceType,
    recurrenceUntil,
    reminderMinutes,
    userId,
    eventId
  );

  const changesKo: string[] = [];
  const changesJa: string[] = [];
  const changesEn: string[] = [];
  if (title !== existing.title) {
    changesKo.push(`제목 '${title}'`);
    changesJa.push(`タイトル「${title}」`);
    changesEn.push(`title '${title}'`);
  }
  if (startDate !== existing.start_date || endDate !== existing.end_date) {
    const rangeStr = `${startDate}${endDate !== startDate ? `~${endDate}` : ''}`;
    changesKo.push(`날짜 ${rangeStr}`);
    changesJa.push(`日付 ${rangeStr}`);
    changesEn.push(`date ${rangeStr}`);
  }
  if (Boolean(isAllDay) !== Boolean(existing.is_all_day) || startTime !== existing.start_time || endTime !== existing.end_time) {
    changesKo.push(isAllDay ? '시간 종일' : `시간 ${startTime}~${endTime}`);
    changesJa.push(isAllDay ? '時間 終日' : `時間 ${startTime}~${endTime}`);
    changesEn.push(isAllDay ? 'All Day' : `time ${startTime}~${endTime}`);
  }
  if (location !== (existing.location || '')) {
    changesKo.push(`장소 '${location || '없음'}'`);
    changesJa.push(`場所「${location || 'なし'}」`);
    changesEn.push(`location '${location || 'none'}'`);
  }

  const actorName = req.user!.name;
  const changeLog =
    changesKo.length > 0
      ? `${actorName}님이 일정을 수정했습니다 (${changesKo.join(', ')}).`
      : `${actorName}님이 일정 정보를 업데이트했습니다.`;
  const changeLogJa =
    changesJa.length > 0
      ? `${actorName}さんが予定を更新しました（${changesJa.join('、')}）。`
      : `${actorName}さんが予定情報を更新しました。`;
  const changeLogEn =
    changesEn.length > 0
      ? `${actorName} updated the event (${changesEn.join(', ')}).`
      : `${actorName} updated the event details.`;

  db.prepare(`
    INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
    VALUES (?, ?, 1, ?)
  `).run(eventId, userId, changeLog);

  if (title !== existing.title || description !== (existing.description || '')) {
    syncContentAcrossLinkedEntities('EVENT', eventId, { title, content: description }, userId);
  }

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  recordActivity(spaceId, userId, 'EVENT_UPDATED', 'EVENT', eventId, `${actorName}님이 '${title}' 일정을 수정했습니다.`, {
    startDate,
  });

  const prevAttendeeSet = new Set(prevAttendeeIds);
  const newlyAddedAttendees = nextAttendeeIds.filter((id) => !prevAttendeeSet.has(id));
  const continuingAttendees = nextAttendeeIds.filter((id) => prevAttendeeSet.has(id));

  if (newlyAddedAttendees.length > 0) {
    notifyEventAttendees(spaceId, newlyAddedAttendees, userId, {
      titleKo: `📅 ${spaceName}`,
      bodyKo: `${actorName}님이 '${title}' (${startDate}) 일정 참여자로 추가했습니다.`,
      titleJa: `📅 ${spaceName}`,
      bodyJa: `${actorName}さんが「${title}」(${startDate})の参加者に追加しました。`,
      titleEn: `📅 ${spaceName}`,
      bodyEn: `${actorName} added you to event '${title}' (${startDate}).`,
      url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
      tag: `space-ev-add-${eventId}`,
    });
  }

  if (continuingAttendees.length > 0) {
    notifyEventAttendees(spaceId, continuingAttendees, userId, {
      titleKo: `📅 ${spaceName}`,
      bodyKo: changeLog,
      titleJa: `📅 ${spaceName}`,
      bodyJa: changeLogJa,
      titleEn: `📅 ${spaceName}`,
      bodyEn: changeLogEn,
      url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
      tag: `space-ev-upd-${eventId}`,
    });
  }

  const updated = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);
  res.json({ event: hydrateEventRows([updated])[0] });
});

router.post('/:spaceId/events/:eventId/move', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const targetDate = String(req.body?.targetDate || '').trim();
  if (!isValidYmd(targetDate)) {
    res.status(400).json({ error: '이동할 날짜(YYYY-MM-DD)가 올바르지 않습니다.' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!existing) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const spanDays = Math.max(0, diffDaysYmd(existing.start_date, existing.end_date));
  const nextEndDate = addDaysYmd(targetDate, spanDays);

  db.prepare(`
    UPDATE calendar_events
    SET start_date = ?, end_date = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(targetDate, nextEndDate, userId, eventId);

  const logMsg = `${req.user!.name}님이 일정을 ${existing.start_date} → ${targetDate}로 이동했습니다.`;
  db.prepare(`
    INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
    VALUES (?, ?, 1, ?)
  `).run(eventId, userId, logMsg);

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  recordActivity(
    spaceId,
    userId,
    'EVENT_MOVED',
    'EVENT',
    eventId,
    `${actorName}님이 '${existing.title}' 일정을 ${targetDate}로 이동했습니다.`,
    { startDate: targetDate }
  );

  notifyEventAttendees(spaceId, parseAttendeeIds(existing.attendee_ids_json), userId, {
    titleKo: `📅 ${spaceName}`,
    bodyKo: `${actorName}님이 '${existing.title}' 일정을 ${targetDate}로 이동했습니다.`,
    titleJa: `📅 ${spaceName}`,
    bodyJa: `${actorName}さんが「${existing.title}」を ${targetDate} に移動しました。`,
    titleEn: `📅 ${spaceName}`,
    bodyEn: `${actorName} moved '${existing.title}' to ${targetDate}.`,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `space-ev-mv-${eventId}`,
  });

  const updated = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);
  res.json({ event: hydrateEventRows([updated])[0] });
});

router.post('/:spaceId/events/:eventId/copy', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const targetDate = String(req.body?.targetDate || '').trim();
  if (!isValidYmd(targetDate)) {
    res.status(400).json({ error: '복사할 날짜(YYYY-MM-DD)가 올바르지 않습니다.' });
    return;
  }

  const source = db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!source) {
    res.status(404).json({ error: '원본 일정을 찾을 수 없습니다.' });
    return;
  }

  const spanDays = Math.max(0, diffDaysYmd(source.start_date, source.end_date));
  const nextEndDate = addDaysYmd(targetDate, spanDays);

  const result = db
    .prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, text_color, location, url, attendee_ids_json,
        recurrence_type, recurrence_until, reminder_minutes, event_status,
        linked_thought_id, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NONE', NULL, ?, 'CONFIRMED', ?, ?, ?)
    `)
    .run(
      spaceId,
      source.title,
      source.description || '',
      targetDate,
      nextEndDate,
      source.start_time,
      source.end_time,
      source.is_all_day,
      source.label_key,
      source.color,
      source.text_color || '#FFFFFF',
      source.location || '',
      source.url || '',
      source.attendee_ids_json || '[]',
      source.reminder_minutes,
      source.linked_thought_id || null,
      userId,
      userId
    );

  const newEventId = Number(result.lastInsertRowid);
  db.prepare(`
    INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
    VALUES (?, ?, 1, ?)
  `).run(newEventId, userId, `${req.user!.name}님이 기존 일정을 복사해 ${targetDate}에 추가했습니다.`);

  if (source.linked_thought_id) {
    syncLinkedThoughtStatus(Number(source.linked_thought_id));
  }

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const summary = `${actorName}님이 '${source.title}' 일정을 ${targetDate}에 복사했습니다.`;
  recordActivity(spaceId, userId, 'EVENT_COPIED', 'EVENT', newEventId, summary, { startDate: targetDate });

  notifyEventAttendees(spaceId, parseAttendeeIds(source.attendee_ids_json), userId, {
    titleKo: `📅 ${spaceName}`,
    bodyKo: summary,
    titleJa: `📅 ${spaceName}`,
    bodyJa: `${actorName}さんが「${source.title}」を ${targetDate} にコピーしました。`,
    titleEn: `📅 ${spaceName}`,
    bodyEn: `${actorName} copied '${source.title}' to ${targetDate}.`,
    url: `/?tab=calendar&space=${spaceId}&event=${newEventId}`,
    tag: `space-ev-cp-${newEventId}`,
  });

  const created = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(newEventId);
  res.status(201).json({ event: hydrateEventRows([created])[0] });
});

router.post('/:spaceId/events/:eventId/vote', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const ev = db
    .prepare('SELECT id, title, linked_thought_id FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!ev) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const vote = req.body?.vote;
  if (vote === null || vote === '') {
    db.prepare('DELETE FROM calendar_event_votes WHERE event_id = ? AND user_id = ?').run(eventId, userId);
  } else if (vote === 'AVAILABLE' || vote === 'UNAVAILABLE') {
    const existing = db
      .prepare('SELECT vote FROM calendar_event_votes WHERE event_id = ? AND user_id = ?')
      .get(eventId, userId) as { vote: string } | undefined;
    if (existing?.vote === vote) {
      db.prepare('DELETE FROM calendar_event_votes WHERE event_id = ? AND user_id = ?').run(eventId, userId);
    } else {
      db.prepare(`
        INSERT INTO calendar_event_votes (event_id, user_id, vote, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(event_id, user_id) DO UPDATE SET vote = excluded.vote, updated_at = CURRENT_TIMESTAMP
      `).run(eventId, userId, vote);
    }
  } else {
    res.status(400).json({ error: '올바른 응답 유형이 아닙니다.' });
    return;
  }

  broadcastSpaceUpdate(spaceId, 'EVENT_VOTED', { eventId, actorId: userId });
  const updated = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);
  res.json({ event: hydrateEventRows([updated])[0] });
});

router.post('/:spaceId/events/:eventId/confirm', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const ev = db
    .prepare('SELECT * FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!ev) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const cancelOtherProposals = Boolean(req.body?.cancelOtherProposals);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE calendar_events
      SET event_status = 'CONFIRMED', updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(userId, eventId);

    if (cancelOtherProposals && ev.linked_thought_id) {
      db.prepare(`
        UPDATE calendar_events
        SET event_status = 'CANCELLED', updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE linked_thought_id = ? AND id != ? AND event_status = 'PROPOSED'
      `).run(userId, Number(ev.linked_thought_id), eventId);
    }

    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, ?)
    `).run(eventId, userId, `${req.user!.name}님이 이 제안 일정을 정식 일정으로 확정했습니다!`);

    if (ev.linked_thought_id) {
      syncLinkedThoughtStatus(Number(ev.linked_thought_id));
    }
  });
  tx();

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const summary = `${actorName}님이 '${ev.title}' (${ev.start_date}) 일정을 확정했습니다!`;
  recordActivity(spaceId, userId, 'EVENT_CONFIRMED', 'EVENT', eventId, summary, { startDate: ev.start_date });

  notifyEventAttendees(spaceId, parseAttendeeIds(ev.attendee_ids_json), userId, {
    titleKo: `✅ ${spaceName}`,
    bodyKo: summary,
    titleJa: `✅ ${spaceName}`,
    bodyJa: `${actorName}さんが「${ev.title}」(${ev.start_date})の予定を確定しました！`,
    titleEn: `✅ ${spaceName}`,
    bodyEn: `${actorName} confirmed '${ev.title}' (${ev.start_date})!`,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `space-ev-confirm-${eventId}`,
  });

  const updated = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);
  res.json({ event: hydrateEventRows([updated])[0] });
});

router.delete('/:spaceId/events/:eventId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const ev = db
    .prepare('SELECT id, title, start_date, linked_thought_id FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!ev) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  removeLinksForEntity('EVENT', eventId);
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(eventId);
  if (ev.linked_thought_id) {
    syncLinkedThoughtStatus(Number(ev.linked_thought_id));
  }

  recordActivity(
    spaceId,
    userId,
    'EVENT_DELETED',
    'SPACE',
    null,
    `${req.user!.name}님이 '${ev.title}' (${ev.start_date}) 일정을 삭제했습니다.`
  );
  res.json({ ok: true });
});

router.post('/:spaceId/events/:eventId/comments', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const ev = db
    .prepare('SELECT id, title, start_date, attendee_ids_json FROM calendar_events WHERE id = ? AND space_id = ?')
    .get(eventId, spaceId) as any;
  if (!ev) {
    res.status(404).json({ error: '일정을 찾을 수 없습니다.' });
    return;
  }

  const content = String(req.body?.content || '').trim();
  if (!content) {
    res.status(400).json({ error: '메시지 내용을 입력해 주세요.' });
    return;
  }

  const result = db
    .prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 0, ?)
    `)
    .run(eventId, userId, content);

  const commentId = Number(result.lastInsertRowid);
  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const snippet = content.length > 42 ? `${content.slice(0, 41)}…` : content;
  const summary = `${actorName}님이 '${ev.title}' 채팅에 남김: "${snippet}"`;

  recordActivity(spaceId, userId, 'EVENT_COMMENT', 'EVENT', eventId, summary, { startDate: ev.start_date });
  notifyEventAttendees(spaceId, parseAttendeeIds(ev.attendee_ids_json), userId, {
    titleKo: `💬 ${ev.title} (${spaceName})`,
    bodyKo: `${actorName}: ${snippet}`,
    titleJa: `💬 ${ev.title} (${spaceName})`,
    bodyJa: `${actorName}: ${snippet}`,
    titleEn: `💬 ${ev.title} (${spaceName})`,
    bodyEn: `${actorName}: ${snippet}`,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `space-ev-chat-${eventId}`,
  });

  const created = db
    .prepare(`
      SELECT c.*, u.name as author_name
      FROM calendar_event_comments c
      LEFT JOIN users u ON u.id = c.author_id
      WHERE c.id = ?
    `)
    .get(commentId) as any;

  res.status(201).json({
    comment: {
      id: Number(created.id),
      event_id: Number(created.event_id),
      author_id: Number(created.author_id),
      author_name: created.author_name || '',
      is_system: false,
      content: created.content,
      created_at: created.created_at,
    },
  });
});

router.delete('/:spaceId/events/:eventId/comments/:commentId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const eventId = Number(req.params.eventId);
  const commentId = Number(req.params.commentId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const comment = db
    .prepare('SELECT id, author_id, is_system FROM calendar_event_comments WHERE id = ? AND event_id = ?')
    .get(commentId, eventId) as any;
  if (!comment || comment.is_system) {
    res.status(404).json({ error: '삭제할 댓글을 찾을 수 없습니다.' });
    return;
  }
  if (Number(comment.author_id) !== userId) {
    res.status(403).json({ error: '본인이 작성한 메시지만 삭제할 수 있습니다.' });
    return;
  }

  db.prepare('DELETE FROM calendar_event_comments WHERE id = ?').run(commentId);
  broadcastSpaceUpdate(spaceId, 'EVENT_COMMENT_DELETED', { eventId, actorId: userId });
  res.json({ ok: true });
});

// ==========================================
// 5. SHARED THOUGHT PAD ("하나의 의식체")
// ==========================================
router.get('/:spaceId/thoughts', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const rows = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.space_id = ?
      ORDER BY t.is_pinned DESC, t.updated_at DESC, t.id DESC
    `)
    .all(spaceId) as any[];

  res.json({ thoughts: hydrateThoughtRows(rows) });
});

router.post('/:spaceId/thoughts', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  const isImportant = Boolean(req.body?.is_important);
  const tags = Array.isArray(req.body?.tags)
    ? Array.from(new Set(req.body.tags.map((t: unknown) => String(t || '').trim().replace(/^#/, '')).filter(Boolean))).slice(0, 8)
    : [];

  if (!content) {
    res.status(400).json({ error: '공유할 생각 내용을 입력해 주세요.' });
    return;
  }

  const result = db
    .prepare(`
      INSERT INTO shared_thoughts (space_id, title, content, tags_json, status, is_important, author_id, updated_by)
      VALUES (?, ?, ?, ?, 'NEW', ?, ?, ?)
    `)
    .run(spaceId, title, content, JSON.stringify(tags), isImportant ? 1 : 0, userId, userId);

  const thoughtId = Number(result.lastInsertRowid);
  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 메모장';
  const actorName = req.user!.name;
  const labelText = title || (content.length > 36 ? `${content.slice(0, 35)}…` : content);
  const summary = isImportant
    ? `${actorName}님이 중요 메모를 등록했습니다: "${labelText}"`
    : `${actorName}님이 새 생각을 던졌습니다: "${labelText}"`;

  recordActivity(spaceId, userId, 'THOUGHT_CREATED', 'THOUGHT', thoughtId, summary, {
    actorName,
    title: labelText,
    isImportant,
  });
  notifySpacePeers(
    spaceId,
    userId,
    isImportant
      ? {
          titleKo: `📌 [중요 메모] ${spaceName}`,
          bodyKo: `${actorName}님이 중요 메모를 등록했습니다: "${labelText}"`,
          titleJa: `📌 [重要メモ] ${spaceName}`,
          bodyJa: `${actorName}さんが重要メモを投稿しました：「${labelText}」`,
          titleEn: `📌 [Important] ${spaceName}`,
          bodyEn: `${actorName} posted an important note: "${labelText}"`,
          url: `/?tab=thoughts&space=${spaceId}&thought=${thoughtId}`,
          tag: `space-thought-${thoughtId}`,
        }
      : {
          titleKo: `💡 ${spaceName}`,
          bodyKo: summary,
          titleJa: `💡 ${spaceName}`,
          bodyJa: `${actorName}さんが新しいメモを投稿しました：「${labelText}」`,
          titleEn: `💡 ${spaceName}`,
          bodyEn: `${actorName} dropped a new thought: "${labelText}"`,
          url: `/?tab=thoughts&space=${spaceId}&thought=${thoughtId}`,
          tag: `space-thought-${thoughtId}`,
        }
  );

  const created = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.id = ?
    `)
    .get(thoughtId);

  res.status(201).json({ thought: hydrateThoughtRows([created])[0] });
});

router.get('/:spaceId/thoughts/:thoughtId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const row = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.id = ? AND t.space_id = ?
    `)
    .get(thoughtId, spaceId) as any;

  if (!row) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const comments = db
    .prepare(`
      SELECT c.*, au.name as author_name, ap.name as applied_by_name
      FROM thought_comments c
      INNER JOIN users au ON au.id = c.author_id
      LEFT JOIN users ap ON ap.id = c.applied_by
      WHERE c.thought_id = ?
      ORDER BY c.id ASC
    `)
    .all(thoughtId) as any[];

  const revisions = db
    .prepare(`
      SELECT r.*, eu.name as editor_name
      FROM thought_revisions r
      INNER JOIN users eu ON eu.id = r.editor_id
      WHERE r.thought_id = ?
      ORDER BY r.id DESC
    `)
    .all(thoughtId) as any[];

  res.json({
    thought: hydrateThoughtRows([row])[0],
    comments: comments.map((c) => ({
      id: Number(c.id),
      thought_id: Number(c.thought_id),
      author_id: Number(c.author_id),
      author_name: c.author_name,
      comment_type: c.comment_type as 'COMMENT' | 'EDIT_PROPOSAL' | 'ADD_PROPOSAL',
      content: c.content,
      applied_at: c.applied_at || null,
      applied_by: c.applied_by ? Number(c.applied_by) : null,
      applied_by_name: c.applied_by_name || null,
      created_at: c.created_at,
    })),
    revisions: revisions.map((r) => ({
      id: Number(r.id),
      thought_id: Number(r.thought_id),
      editor_id: Number(r.editor_id),
      editor_name: r.editor_name,
      source_comment_id: r.source_comment_id ? Number(r.source_comment_id) : null,
      change_type: r.change_type,
      previous_content: r.previous_content,
      new_content: r.new_content,
      note: r.note || '',
      created_at: r.created_at,
    })),
  });
});

router.patch('/:spaceId/thoughts/:thoughtId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const existing = db
    .prepare('SELECT * FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!existing) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const title = req.body?.title !== undefined ? String(req.body.title).trim() : existing.title;
  const content = req.body?.content !== undefined ? String(req.body.content).trim() : existing.content;
  const tagsJson = Array.isArray(req.body?.tags)
    ? JSON.stringify(
        Array.from(new Set(req.body.tags.map((t: unknown) => String(t || '').trim().replace(/^#/, '')).filter(Boolean))).slice(0, 8)
      )
    : existing.tags_json;
  const status =
    req.body?.status !== undefined && ['NEW', 'DISCUSSING', 'PROPOSED', 'SCHEDULED', 'ARCHIVED'].includes(req.body.status)
      ? req.body.status
      : existing.status;
  const isPinned = req.body?.is_pinned !== undefined ? (req.body.is_pinned ? 1 : 0) : existing.is_pinned;
  const isImportant = req.body?.is_important !== undefined ? (req.body.is_important ? 1 : 0) : existing.is_important;

  if (!content) {
    res.status(400).json({ error: '생각 내용은 비워둘 수 없습니다.' });
    return;
  }

  const tx = db.transaction(() => {
    if (content !== existing.content) {
      db.prepare(`
        INSERT INTO thought_revisions (thought_id, editor_id, change_type, previous_content, new_content, note)
        VALUES (?, ?, 'MANUAL_EDIT', ?, ?, ?)
      `).run(thoughtId, userId, existing.content, content, `${req.user!.name}님이 직접 수정함`);
    }

    db.prepare(`
      UPDATE shared_thoughts
      SET title = ?, content = ?, tags_json = ?, status = ?, is_pinned = ?, is_important = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, content, tagsJson, status, isPinned, isImportant, userId, thoughtId);
  });
  tx();

  if (title !== existing.title || content !== existing.content) {
    syncContentAcrossLinkedEntities('THOUGHT', thoughtId, { title, content }, userId);
  }

  broadcastSpaceUpdate(spaceId, 'THOUGHT_UPDATED', { thoughtId, actorId: userId });

  const updated = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.id = ?
    `)
    .get(thoughtId);

  res.json({ thought: hydrateThoughtRows([updated])[0] });
});

router.delete('/:spaceId/thoughts/:thoughtId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const existing = db
    .prepare('SELECT id FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId);
  if (!existing) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  removeLinksForEntity('THOUGHT', thoughtId);
  db.prepare('DELETE FROM shared_thoughts WHERE id = ?').run(thoughtId);
  broadcastSpaceUpdate(spaceId, 'THOUGHT_DELETED', { thoughtId, actorId: userId });
  res.json({ ok: true });
});

router.post('/:spaceId/thoughts/:thoughtId/react', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const thought = db
    .prepare('SELECT id, title, content, status FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!thought) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const stance = req.body?.stance;
  if (!['GOOD', 'THINK', 'BAD', null, ''].includes(stance)) {
    res.status(400).json({ error: '올바른 피드백 유형이 아닙니다.' });
    return;
  }

  let appliedStance: string | null = null;
  if (!stance) {
    db.prepare('DELETE FROM thought_reactions WHERE thought_id = ? AND user_id = ?').run(thoughtId, userId);
  } else {
    const prev = db
      .prepare('SELECT stance FROM thought_reactions WHERE thought_id = ? AND user_id = ?')
      .get(thoughtId, userId) as { stance: string } | undefined;

    if (prev?.stance === stance) {
      db.prepare('DELETE FROM thought_reactions WHERE thought_id = ? AND user_id = ?').run(thoughtId, userId);
    } else {
      db.prepare(`
        INSERT INTO thought_reactions (thought_id, user_id, stance, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(thought_id, user_id) DO UPDATE SET stance = excluded.stance, updated_at = CURRENT_TIMESTAMP
      `).run(thoughtId, userId, stance);
      appliedStance = stance;

      if (thought.status === 'NEW') {
        db.prepare(`UPDATE shared_thoughts SET status = 'DISCUSSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          thoughtId
        );
      }
    }
  }

  if (appliedStance) {
    const stanceLabel = appliedStance === 'GOOD' ? '좋다 👍' : appliedStance === 'THINK' ? '더 생각해본다 🤔' : '별로다 👎';
    const labelText = thought.title || String(thought.content || '').slice(0, 24);
    recordActivity(
      spaceId,
      userId,
      'THOUGHT_REACTION',
      'THOUGHT',
      thoughtId,
      `${req.user!.name}님이 '${labelText}'에 [${stanceLabel}] 피드백을 남겼습니다.`
    );
  } else {
    broadcastSpaceUpdate(spaceId, 'THOUGHT_REACTION', { thoughtId, actorId: userId });
  }

  const updated = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.id = ?
    `)
    .get(thoughtId);

  res.json({ thought: hydrateThoughtRows([updated])[0] });
});

router.post('/:spaceId/thoughts/:thoughtId/comments', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const thought = db
    .prepare('SELECT id, title, content, status, author_id FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!thought) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const commentType = ['COMMENT', 'EDIT_PROPOSAL', 'ADD_PROPOSAL'].includes(req.body?.comment_type)
    ? req.body.comment_type
    : 'COMMENT';
  const content = String(req.body?.content || '').trim();
  if (!content) {
    res.status(400).json({ error: '내용을 입력해 주세요.' });
    return;
  }

  const result = db
    .prepare(`
      INSERT INTO thought_comments (thought_id, author_id, comment_type, content)
      VALUES (?, ?, ?, ?)
    `)
    .run(thoughtId, userId, commentType, content);

  const commentId = Number(result.lastInsertRowid);
  if (thought.status === 'NEW') {
    db.prepare(`UPDATE shared_thoughts SET status = 'DISCUSSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      thoughtId
    );
  } else {
    db.prepare('UPDATE shared_thoughts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(thoughtId);
  }

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 메모장';
  const actorName = req.user!.name;
  const typeLabel =
    commentType === 'EDIT_PROPOSAL' ? '수정 제안' : commentType === 'ADD_PROPOSAL' ? '추가 아이디어' : '의견';
  const typeJa =
    commentType === 'EDIT_PROPOSAL' ? '修正提案' : commentType === 'ADD_PROPOSAL' ? '追加アイデア' : 'コメント';
  const typeEn =
    commentType === 'EDIT_PROPOSAL' ? 'Edit Proposal' : commentType === 'ADD_PROPOSAL' ? 'Add Idea' : 'Comment';
  const snippet = content.length > 36 ? `${content.slice(0, 35)}…` : content;
  const titleHint = thought.title || String(thought.content).slice(0, 20);
  const summary = `${actorName}님이 '${titleHint}'에 [${typeLabel}]을 남겼습니다: "${snippet}"`;

  recordActivity(spaceId, userId, 'THOUGHT_COMMENT', 'THOUGHT', thoughtId, summary);
  notifyThoughtParticipants(spaceId, thoughtId, thought.author_id, userId, {
    titleKo: `💡 ${spaceName}`,
    bodyKo: summary,
    titleJa: `💡 ${spaceName}`,
    bodyJa: `${actorName}さんが「${titleHint}」に[${typeJa}]を投稿しました：「${snippet}」`,
    titleEn: `💡 ${spaceName}`,
    bodyEn: `${actorName} posted [${typeEn}] on '${titleHint}': "${snippet}"`,
    url: `/?tab=thoughts&space=${spaceId}&thought=${thoughtId}`,
    tag: `space-thought-cmt-${thoughtId}`,
  });

  const created = db
    .prepare(`
      SELECT c.*, au.name as author_name
      FROM thought_comments c
      INNER JOIN users au ON au.id = c.author_id
      WHERE c.id = ?
    `)
    .get(commentId) as any;

  res.status(201).json({
    comment: {
      id: Number(created.id),
      thought_id: Number(created.thought_id),
      author_id: Number(created.author_id),
      author_name: created.author_name,
      comment_type: created.comment_type,
      content: created.content,
      applied_at: null,
      applied_by: null,
      applied_by_name: null,
      created_at: created.created_at,
    },
  });
});

router.post('/:spaceId/thoughts/:thoughtId/comments/:commentId/apply', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  const commentId = Number(req.params.commentId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const thought = db
    .prepare('SELECT * FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!thought) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const comment = db
    .prepare(`
      SELECT c.*, u.name as author_name
      FROM thought_comments c
      INNER JOIN users u ON u.id = c.author_id
      WHERE c.id = ? AND c.thought_id = ?
    `)
    .get(commentId, thoughtId) as any;
  if (!comment) {
    res.status(404).json({ error: '제안 항목을 찾을 수 없습니다.' });
    return;
  }

  if (comment.applied_at) {
    res.status(409).json({ error: '이미 본문에 반영된 제안입니다.' });
    return;
  }

  const customMerged = typeof req.body?.mergedContent === 'string' ? req.body.mergedContent.trim() : '';
  let nextContent = customMerged;
  const changeType = comment.comment_type === 'EDIT_PROPOSAL' ? 'EDIT_MERGE' : 'ADD_MERGE';

  if (!nextContent) {
    if (comment.comment_type === 'EDIT_PROPOSAL') {
      nextContent = comment.content;
    } else {
      nextContent = `${thought.content.trim()}\n\n+ [${comment.author_name} 추가 제안] ${comment.content.trim()}`;
    }
  }

  const nowJst = getJstDateTimeStr();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO thought_revisions (thought_id, editor_id, source_comment_id, change_type, previous_content, new_content, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      thoughtId,
      userId,
      commentId,
      changeType,
      thought.content,
      nextContent,
      `${comment.author_name}님의 ${changeType === 'EDIT_MERGE' ? '수정 제안' : '추가 아이디어'}을 ${req.user!.name}님이 반영`
    );

    db.prepare(`
      UPDATE shared_thoughts
      SET content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextContent, userId, thoughtId);

    db.prepare(`
      UPDATE thought_comments
      SET applied_at = ?, applied_by = ?
      WHERE id = ?
    `).run(nowJst, userId, commentId);
  });
  tx();

  syncContentAcrossLinkedEntities('THOUGHT', thoughtId, { content: nextContent }, userId);

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 메모장';
  const actorName = req.user!.name;
  const titleHint = thought.title || String(thought.content).slice(0, 24);
  const summary = `${actorName}님이 '${titleHint}'에 ${comment.author_name}님의 제안을 본문에 반영했습니다.`;
  recordActivity(spaceId, userId, 'THOUGHT_MERGED', 'THOUGHT', thoughtId, summary);

  notifyThoughtParticipants(spaceId, thoughtId, thought.author_id, userId, {
    titleKo: `✨ ${spaceName}`,
    bodyKo: summary,
    titleJa: `✨ ${spaceName}`,
    bodyJa: `${actorName}さんが「${titleHint}」に${comment.author_name}さんの提案を反映しました。`,
    titleEn: `✨ ${spaceName}`,
    bodyEn: `${actorName} merged ${comment.author_name}'s suggestion into '${titleHint}'.`,
    url: `/?tab=thoughts&space=${spaceId}&thought=${thoughtId}`,
    tag: `space-thought-merge-${thoughtId}`,
  });

  res.json({ ok: true, content: nextContent });
});

// Direct bridge: Thought -> Calendar Date Proposal (or immediate confirm)
router.post('/:spaceId/thoughts/:thoughtId/propose-date', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const thought = db
    .prepare('SELECT * FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!thought) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const startDate = String(req.body?.start_date || '').trim();
  if (!isValidYmd(startDate)) {
    res.status(400).json({ error: '제안할 날짜(YYYY-MM-DD)를 선택해 주세요.' });
    return;
  }

  const endDateRaw = isValidYmd(req.body?.end_date) ? String(req.body.end_date).trim() : startDate;
  const endDate = endDateRaw < startDate ? startDate : endDateRaw;
  const title =
    String(req.body?.title || '').trim() ||
    thought.title ||
    String(thought.content).slice(0, 40);
  const description = String(req.body?.description ?? thought.content).trim();
  const isAllDay = req.body?.is_all_day !== false ? 1 : 0;
  const startTime = isAllDay ? null : normalizeTime(req.body?.start_time) || '10:00';
  const endTime = isAllDay ? null : normalizeTime(req.body?.end_time) || startTime;
  const labelKey = String(req.body?.label_key || 'amber').trim();
  const color = String(req.body?.color || '#B45309').trim();
  const textColor = String(req.body?.text_color || '#FFFFFF').trim() || '#FFFFFF';
  const location = String(req.body?.location || '').trim();
  const note = String(req.body?.note || '').trim();
  const confirmImmediately = Boolean(req.body?.confirmImmediately);
  const eventStatus = confirmImmediately ? 'CONFIRMED' : 'PROPOSED';
  const attendeeIds = filterValidSpaceAttendees(spaceId, parseAttendeeIds(req.body?.attendee_ids));

  const result = db
    .prepare(`
      INSERT INTO calendar_events (
        space_id, title, description, start_date, end_date, start_time, end_time,
        is_all_day, label_key, color, text_color, location, attendee_ids_json, recurrence_type,
        reminder_minutes, event_status, linked_thought_id, created_by, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NONE', ?, ?, ?, ?, ?)
    `)
    .run(
      spaceId,
      title,
      description,
      startDate,
      endDate,
      startTime,
      endTime,
      isAllDay,
      labelKey,
      color,
      textColor,
      location,
      JSON.stringify(attendeeIds),
      req.body?.reminder_minutes !== undefined && req.body?.reminder_minutes !== '' && req.body?.reminder_minutes !== null
        ? Number(req.body.reminder_minutes)
        : null,
      eventStatus,
      thoughtId,
      userId,
      userId
    );

  const eventId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
    VALUES (?, ?, 1, ?)
  `).run(
    eventId,
    userId,
    confirmImmediately
      ? `${req.user!.name}님이 공유 메모장의 생각에서 이 날짜로 일정을 확정 등록했습니다.`
      : `${req.user!.name}님이 공유 메모장의 생각에서 이 날짜를 제안했습니다.`
  );

  if (note) {
    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 0, ?)
    `).run(eventId, userId, note);
  }

  if (!confirmImmediately) {
    db.prepare(`
      INSERT OR REPLACE INTO calendar_event_votes (event_id, user_id, vote)
      VALUES (?, ?, 'AVAILABLE')
    `).run(eventId, userId);
  }

  syncLinkedThoughtStatus(thoughtId);

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const summary = confirmImmediately
    ? `${actorName}님이 생각 '${title}'을 ${startDate} 일정으로 바로 등록했습니다.`
    : `${actorName}님이 생각 '${title}'에 ${startDate} 날짜를 제안했습니다!`;
  const summaryJa = confirmImmediately
    ? `${actorName}さんがメモ「${title}」を ${startDate} の予定として登録しました。`
    : `${actorName}さんがメモ「${title}」に ${startDate} の日程を提案しました！`;
  const summaryEn = confirmImmediately
    ? `${actorName} scheduled thought '${title}' on ${startDate}.`
    : `${actorName} proposed ${startDate} for thought '${title}'!`;

  recordActivity(
    spaceId,
    userId,
    confirmImmediately ? 'EVENT_CONFIRMED' : 'EVENT_PROPOSED',
    'EVENT',
    eventId,
    summary,
    { startDate, thoughtId }
  );

  notifyEventAttendees(spaceId, attendeeIds, userId, {
    titleKo: `📅 ${spaceName}`,
    bodyKo: summary,
    titleJa: `📅 ${spaceName}`,
    bodyJa: summaryJa,
    titleEn: `📅 ${spaceName}`,
    bodyEn: summaryEn,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `space-prop-${eventId}`,
  });

  const created = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);

  res.status(201).json({ event: hydrateEventRows([created])[0] });
});

// ==========================================
// 6. 3-WAY BRIDGE (THOUGHTS / CALENDAR <-> MINDMAP)
// ==========================================
function userCanAccessMindmapProject(projectId: number, userId: number): boolean {
  const p = db.prepare('SELECT id, mode, created_by FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!p) return false;
  if (Number(p.created_by) === userId) return true;
  if (p.mode !== 'COLLAB') return false;
  const m = db
    .prepare('SELECT 1 FROM journal_project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);
  return Boolean(m);
}

// 6A. Shared Thought -> Mindmap (New Project OR Existing Project Idea/Entry)
router.post('/:spaceId/thoughts/:thoughtId/send-to-mindmap', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.params.spaceId);
  const thoughtId = Number(req.params.thoughtId);
  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const thought = db
    .prepare('SELECT * FROM shared_thoughts WHERE id = ? AND space_id = ?')
    .get(thoughtId, spaceId) as any;
  if (!thought) {
    res.status(404).json({ error: '생각을 찾을 수 없습니다.' });
    return;
  }

  const mode = String(req.body?.mode || 'NEW_PROJECT');
  const nowJst = getJstDateTimeStr();
  const todayJst = getJstDateStr();
  const timeJst = getJstTimeStr();
  const space = getSpaceById(spaceId);

  if (mode === 'NEW_PROJECT') {
    const title = String(req.body?.title || '').trim() || thought.title || String(thought.content).slice(0, 48);
    const intent = String(req.body?.intent ?? thought.content).trim();
    const color = String(req.body?.color || space?.color || '#1B4D3E').trim();
    const spaceMembers = getSpaceMembers(spaceId);
    const otherMembers = spaceMembers.filter((m) => Number(m.user_id) !== userId);
    const hasExplicitMemberIds = Array.isArray(req.body?.memberIds);
    const requestedMemberIdSet = hasExplicitMemberIds
      ? new Set(parseAttendeeIds(req.body.memberIds))
      : null;
    const selectedOtherMembers = hasExplicitMemberIds
      ? otherMembers.filter((m) => requestedMemberIdSet!.has(Number(m.user_id)))
      : req.body?.includeSpaceMembers === true
        ? otherMembers
        : [];
    const isCollab = selectedOtherMembers.length > 0;

    const projectId = db.transaction(() => {
      const pRes = db
        .prepare(`
          INSERT INTO journal_projects (
            title, mode, is_private, partner_type, invite_token, active_turn_user_id,
            participants_json, intent_summary, initial_intent_summary, intent_modified,
            turn_state, stale_threshold_days, last_activity_at, color, created_by
          )
          VALUES (?, ?, 1, ?, ?, ?, '[]', ?, ?, 0, 'MY_TURN', 7, ?, ?, ?)
        `)
        .run(
          title,
          isCollab ? 'COLLAB' : 'SOLO',
          isCollab ? 'SHARED' : 'NONE',
          generateInviteToken(),
          userId,
          intent,
          intent,
          nowJst,
          color,
          userId
        );
      const pid = Number(pRes.lastInsertRowid);

      if (isCollab) {
        for (const m of selectedOtherMembers) {
          db.prepare(`
            INSERT OR IGNORE INTO journal_project_members (project_id, user_id, role)
            VALUES (?, ?, 'MEMBER')
          `).run(pid, Number(m.user_id));
        }
      }

      createCrossLink('THOUGHT', thoughtId, 'PROJECT', pid, {
        spaceId,
        projectId: pid,
        createdBy: userId,
      });

      if (thought.status === 'NEW') {
        db.prepare(`UPDATE shared_thoughts SET status = 'DISCUSSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          thoughtId
        );
      }
      return pid;
    })();

    const actorName = req.user!.name;
    const spaceName = space?.name || '공유 메모장';
    const summary = `${actorName}님이 생각 '${title}'을(를) 새 마인드맵 프로젝트로 시작했습니다.`;
    recordActivity(spaceId, userId, 'THOUGHT_TO_MINDMAP', 'THOUGHT', thoughtId, summary, { projectId });
    const selectedPeerIds = selectedOtherMembers.map((m) => Number(m.user_id));
    if (selectedPeerIds.length > 0) {
      void sendPushToUsers(selectedPeerIds, {
        titleKo: `🧠 ${spaceName}`,
        bodyKo: summary,
        titleJa: `🧠 ${spaceName}`,
        bodyJa: `${actorName}さんがメモ「${title}」を新規マインドマッププロジェクトとして開始しました。`,
        titleEn: `🧠 ${spaceName}`,
        bodyEn: `${actorName} started a new Mindmap project from thought '${title}'.`,
        url: `/?project=${projectId}`,
        projectId,
        tag: `space-to-mm-${projectId}`,
      });
    }

    res.status(201).json({ mode: 'NEW_PROJECT', projectId });
    return;
  }

  const projectId = Number(req.body?.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0 || !userCanAccessMindmapProject(projectId, userId)) {
    res.status(403).json({ error: '선택한 마인드맵 프로젝트에 접근할 수 없습니다.' });
    return;
  }

  const project = db.prepare('SELECT id, title FROM journal_projects WHERE id = ?').get(projectId) as any;

  if (mode === 'EXISTING_IDEA') {
    const ideaTitle = String(req.body?.title || '').trim() || thought.title || String(thought.content).slice(0, 48);
    const ideaNote = String(req.body?.note ?? thought.content).trim();

    const ideaId = db.transaction(() => {
      const iRes = db
        .prepare(`
          INSERT INTO journal_ideas (project_id, title, note, status, author_id)
          VALUES (?, ?, ?, 'OPEN', ?)
        `)
        .run(projectId, ideaTitle, ideaNote, userId);
      const iid = Number(iRes.lastInsertRowid);
      db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        nowJst,
        projectId
      );
      createCrossLink('THOUGHT', thoughtId, 'IDEA', iid, {
        spaceId,
        projectId,
        createdBy: userId,
      });
      if (thought.status === 'NEW') {
        db.prepare(`UPDATE shared_thoughts SET status = 'DISCUSSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          thoughtId
        );
      }
      return iid;
    })();

    const actorName = req.user!.name;
    const summary = `${actorName}님이 생각 '${ideaTitle}'을(를) 마인드맵 '${project.title}' 아이디어로 연결했습니다.`;
    recordActivity(spaceId, userId, 'THOUGHT_TO_MINDMAP', 'THOUGHT', thoughtId, summary, { projectId, ideaId });
    notifyMindmapProjectPeers(projectId, userId, {
      titleKo: `📌 ${project.title}`,
      bodyKo: `💡 ${actorName}님이 공유 메모장에서 아이디어 '${ideaTitle}'을(를) 추가했습니다.`,
      titleJa: `📌 ${project.title}`,
      bodyJa: `💡 ${actorName}さんが共有メモ帳からアイデア「${ideaTitle}」を追加しました。`,
      titleEn: `📌 ${project.title}`,
      bodyEn: `💡 ${actorName} added idea '${ideaTitle}' from Shared Thought Pad.`,
      url: `/?project=${projectId}`,
      projectId,
      tag: `space-to-mm-idea-${ideaId}`,
    });
    res.status(201).json({ mode: 'EXISTING_IDEA', projectId, ideaId });
    return;
  }

  if (mode === 'EXISTING_ENTRY') {
    const entryType = ['INTENT', 'PROGRESS', 'DIALOGUE_ME'].includes(req.body?.entryType)
      ? req.body.entryType
      : 'INTENT';
    const entryContent = String(req.body?.content ?? thought.content).trim();

    const entryId = db.transaction(() => {
      const eRes = db
        .prepare(`
          INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(projectId, entryType, entryContent, todayJst, timeJst, userId);
      const eid = Number(eRes.lastInsertRowid);
      db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        nowJst,
        projectId
      );
      createCrossLink('THOUGHT', thoughtId, 'ENTRY', eid, {
        spaceId,
        projectId,
        createdBy: userId,
      });
      if (thought.status === 'NEW') {
        db.prepare(`UPDATE shared_thoughts SET status = 'DISCUSSING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          thoughtId
        );
      }
      return eid;
    })();

    const actorName = req.user!.name;
    const snippet = entryContent.length > 50 ? `${entryContent.slice(0, 49)}…` : entryContent;
    const summary = `${actorName}님이 생각을 마인드맵 '${project.title}' 타임라인 기록으로 연결했습니다.`;
    recordActivity(spaceId, userId, 'THOUGHT_TO_MINDMAP', 'THOUGHT', thoughtId, summary, { projectId, entryId });
    notifyMindmapProjectPeers(projectId, userId, {
      titleKo: `📌 ${project.title}`,
      bodyKo: `📝 ${actorName}님이 공유 메모장에서 기록을 추가했습니다: ${snippet}`,
      titleJa: `📌 ${project.title}`,
      bodyJa: `📝 ${actorName}さんが共有メモ帳から記録を追加しました：${snippet}`,
      titleEn: `📌 ${project.title}`,
      bodyEn: `📝 ${actorName} added a timeline entry from Shared Thought Pad: ${snippet}`,
      url: `/?project=${projectId}`,
      projectId,
      tag: `space-to-mm-entry-${entryId}`,
    });
    res.status(201).json({ mode: 'EXISTING_ENTRY', projectId, entryId });
    return;
  }

  res.status(400).json({ error: '지원하지 않는 마인드맵 연동 방식입니다.' });
});

// 6B. Mindmap (Project / Idea / Entry) -> Shared Thought Pad
router.post('/from-mindmap/thought', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.body?.spaceId);
  const projectId = Number(req.body?.projectId);
  const sourceType = req.body?.sourceType as CrossEntityType;
  const sourceId = Number(req.body?.sourceId);

  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '선택한 공유 스페이스에 접근 권한이 없습니다.' });
    return;
  }
  if (!['PROJECT', 'IDEA', 'ENTRY'].includes(sourceType) || !Number.isInteger(sourceId) || sourceId <= 0) {
    res.status(400).json({ error: '원본 마인드맵 항목 정보가 올바르지 않습니다.' });
    return;
  }
  if (!userCanAccessMindmapProject(projectId, userId)) {
    res.status(403).json({ error: '원본 마인드맵 프로젝트에 접근 권한이 없습니다.' });
    return;
  }

  const title = String(req.body?.title || '').trim();
  const content = String(req.body?.content || '').trim();
  const tags = Array.isArray(req.body?.tags)
    ? Array.from(new Set(req.body.tags.map((t: unknown) => String(t || '').trim().replace(/^#/, '')).filter(Boolean))).slice(0, 8)
    : [];

  if (!content) {
    res.status(400).json({ error: '공유 메모장에 보낼 내용을 입력해 주세요.' });
    return;
  }

  const thoughtId = db.transaction(() => {
    const tRes = db
      .prepare(`
        INSERT INTO shared_thoughts (space_id, title, content, tags_json, status, author_id, updated_by)
        VALUES (?, ?, ?, ?, 'NEW', ?, ?)
      `)
      .run(spaceId, title, content, JSON.stringify(tags), userId, userId);
    const tid = Number(tRes.lastInsertRowid);
    createCrossLink(sourceType, sourceId, 'THOUGHT', tid, {
      spaceId,
      projectId,
      createdBy: userId,
    });
    return tid;
  })();

  const space = getSpaceById(spaceId);
  const labelText = title || content.slice(0, 32);
  const summary = `${req.user!.name}님이 마인드맵에서 생각을 공유했습니다: "${labelText}"`;
  recordActivity(spaceId, userId, 'THOUGHT_CREATED', 'THOUGHT', thoughtId, summary, { projectId });
  notifySpacePeers(spaceId, userId, {
    title: `💡 ${space?.name || '공유 메모장'}`,
    body: summary,
    url: `/?tab=thoughts&space=${spaceId}&thought=${thoughtId}`,
    tag: `mm-to-thought-${thoughtId}`,
  });

  const created = db
    .prepare(`
      SELECT t.*, au.name as author_name, uu.name as updated_by_name
      FROM shared_thoughts t
      INNER JOIN users au ON au.id = t.author_id
      LEFT JOIN users uu ON uu.id = t.updated_by
      WHERE t.id = ?
    `)
    .get(thoughtId);

  res.status(201).json({ thought: hydrateThoughtRows([created])[0] });
});

// 6C. Mindmap (Project / Idea / Entry) -> Shared Calendar Event
router.post('/from-mindmap/event', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const spaceId = Number(req.body?.spaceId);
  const projectId = Number(req.body?.projectId);
  const sourceType = req.body?.sourceType as CrossEntityType;
  const sourceId = Number(req.body?.sourceId);

  if (!getMembership(spaceId, userId)) {
    res.status(403).json({ error: '선택한 공유 스페이스에 접근 권한이 없습니다.' });
    return;
  }
  if (!['PROJECT', 'IDEA', 'ENTRY'].includes(sourceType) || !Number.isInteger(sourceId) || sourceId <= 0) {
    res.status(400).json({ error: '원본 마인드맵 항목 정보가 올바르지 않습니다.' });
    return;
  }
  if (!userCanAccessMindmapProject(projectId, userId)) {
    res.status(403).json({ error: '원본 마인드맵 프로젝트에 접근 권한이 없습니다.' });
    return;
  }

  const title = String(req.body?.title || '').trim();
  const startDate = String(req.body?.start_date || '').trim();
  if (!title || !isValidYmd(startDate)) {
    res.status(400).json({ error: '일정 제목과 날짜(YYYY-MM-DD)를 입력해 주세요.' });
    return;
  }

  const endDateRaw = isValidYmd(req.body?.end_date) ? String(req.body.end_date).trim() : startDate;
  const endDate = endDateRaw < startDate ? startDate : endDateRaw;
  const isAllDay = req.body?.is_all_day !== false ? 1 : 0;
  const startTime = isAllDay ? null : normalizeTime(req.body?.start_time) || '10:00';
  const endTime = isAllDay ? null : normalizeTime(req.body?.end_time) || startTime;
  const labelKey = String(req.body?.label_key || 'sky').trim();
  const color = String(req.body?.color || '#0369A1').trim();
  const textColor = String(req.body?.text_color || '#FFFFFF').trim() || '#FFFFFF';
  const description = String(req.body?.description || '').trim();
  const location = String(req.body?.location || '').trim();
  const confirmImmediately = req.body?.confirmImmediately !== false;
  const eventStatus = confirmImmediately ? 'CONFIRMED' : 'PROPOSED';
  const attendeeIds = Array.isArray(req.body?.attendee_ids)
    ? filterValidSpaceAttendees(spaceId, parseAttendeeIds(req.body.attendee_ids))
    : filterValidSpaceAttendees(spaceId, getMindmapProjectMemberIds(projectId));

  const eventId = db.transaction(() => {
    const eRes = db
      .prepare(`
        INSERT INTO calendar_events (
          space_id, title, description, start_date, end_date, start_time, end_time,
          is_all_day, label_key, color, text_color, location, attendee_ids_json, recurrence_type,
          reminder_minutes, event_status, created_by, updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NONE', ?, ?, ?, ?)
      `)
      .run(
        spaceId,
        title,
        description,
        startDate,
        endDate,
        startTime,
        endTime,
        isAllDay,
        labelKey,
        color,
        textColor,
        location,
        JSON.stringify(attendeeIds),
        req.body?.reminder_minutes !== undefined && req.body?.reminder_minutes !== '' && req.body?.reminder_minutes !== null
          ? Number(req.body.reminder_minutes)
          : 30,
        eventStatus,
        userId,
        userId
      );
    const eid = Number(eRes.lastInsertRowid);

    db.prepare(`
      INSERT INTO calendar_event_comments (event_id, author_id, is_system, content)
      VALUES (?, ?, 1, ?)
    `).run(
      eid,
      userId,
      confirmImmediately
        ? `${req.user!.name}님이 프로젝트 마인드맵에서 이 일정을 등록했습니다.`
        : `${req.user!.name}님이 프로젝트 마인드맵에서 이 날짜를 제안했습니다.`
    );

    if (!confirmImmediately) {
      db.prepare(`
        INSERT OR REPLACE INTO calendar_event_votes (event_id, user_id, vote)
        VALUES (?, ?, 'AVAILABLE')
      `).run(eid, userId);
    }

    createCrossLink(sourceType, sourceId, 'EVENT', eid, {
      spaceId,
      projectId,
      createdBy: userId,
    });
    return eid;
  })();

  const space = getSpaceById(spaceId);
  const spaceName = space?.name || '공유 캘린더';
  const actorName = req.user!.name;
  const summary = `${actorName}님이 마인드맵에서 '${title}' (${startDate}) 일정을 공유 캘린더에 연결했습니다.`;
  recordActivity(
    spaceId,
    userId,
    confirmImmediately ? 'EVENT_CREATED' : 'EVENT_PROPOSED',
    'EVENT',
    eventId,
    summary,
    { startDate, projectId }
  );
  notifyEventAttendees(spaceId, attendeeIds, userId, {
    titleKo: `📅 ${spaceName}`,
    bodyKo: summary,
    titleJa: `📅 ${spaceName}`,
    bodyJa: `${actorName}さんがマインドマップから「${title}」(${startDate})を共有カレンダーに連携しました。`,
    titleEn: `📅 ${spaceName}`,
    bodyEn: `${actorName} linked '${title}' (${startDate}) from Mindmap to Shared Calendar.`,
    url: `/?tab=calendar&space=${spaceId}&event=${eventId}`,
    tag: `mm-to-ev-${eventId}`,
  });

  const created = db
    .prepare(`SELECT e.*, u.name as creator_name FROM calendar_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?`)
    .get(eventId);

  res.status(201).json({ event: hydrateEventRows([created])[0] });
});

// 6D. Query all Space (Thought / Calendar) links for a Mindmap Project and its Ideas/Entries
router.get('/links/project/:projectId', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const projectId = Number(req.params.projectId);
  if (!Number.isInteger(projectId) || projectId <= 0 || !userCanAccessMindmapProject(projectId, userId)) {
    res.status(403).json({ error: '접근 권한이 없습니다.' });
    return;
  }

  const memberSpaceIds = new Set(
    (
      db.prepare('SELECT space_id FROM collab_space_members WHERE user_id = ?').all(userId) as Array<{
        space_id: number;
      }>
    ).map((r) => Number(r.space_id))
  );

  const filterAccessible = (links: ReturnType<typeof getHydratedCrossLinks>) =>
    links.filter((l) => !l.space_id || memberSpaceIds.has(Number(l.space_id)));

  const projectLinks = filterAccessible(getHydratedCrossLinks('PROJECT', projectId, ['THOUGHT', 'EVENT']));

  const ideaRows = db.prepare('SELECT id FROM journal_ideas WHERE project_id = ?').all(projectId) as Array<{
    id: number;
  }>;
  const ideaLinksById: Record<number, ReturnType<typeof getHydratedCrossLinks>> = {};
  for (const r of ideaRows) {
    const links = filterAccessible(getHydratedCrossLinks('IDEA', Number(r.id), ['THOUGHT', 'EVENT']));
    if (links.length > 0) ideaLinksById[Number(r.id)] = links;
  }

  const entryRows = db.prepare('SELECT id FROM journal_entries WHERE project_id = ?').all(projectId) as Array<{
    id: number;
  }>;
  const entryLinksById: Record<number, ReturnType<typeof getHydratedCrossLinks>> = {};
  for (const r of entryRows) {
    const links = filterAccessible(getHydratedCrossLinks('ENTRY', Number(r.id), ['THOUGHT', 'EVENT']));
    if (links.length > 0) entryLinksById[Number(r.id)] = links;
  }

  res.json({ projectLinks, ideaLinksById, entryLinksById });
});

export default router;
