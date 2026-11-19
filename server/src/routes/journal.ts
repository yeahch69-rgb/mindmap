import { Router, Request, Response } from 'express';
import { db, generateInviteToken } from '../db/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { getJstDateStr, getJstTimeStr, getJstDateTimeStr, getJstDateStrWithDayOffset } from '../utils/jstTime.js';
import { sendPushToUsers } from '../utils/webPush.js';

const router = Router();

const VALID_MODES = new Set(['SOLO', 'COLLAB']);
const VALID_PARTNER_TYPES = new Set(['NONE', 'SHARED', 'EXTERNAL']);
const VALID_TURN_STATES = new Set(['MY_TURN', 'THEIR_TURN', 'HOLD', 'DONE']);
const VALID_ENTRY_TYPES = new Set(['DIALOGUE_ME', 'DIALOGUE_THEM', 'INTENT', 'PROGRESS']);
const VALID_IDEA_STATUSES = new Set(['OPEN', 'PROMOTED', 'ARCHIVED']);
const VALID_PORT_SIDES = new Set(['top', 'right', 'bottom', 'left']);

function canAccessJournalProject(project: any, userId: number): boolean {
  if (!project) return false;
  if (Number(project.created_by) === Number(userId)) return true;
  if (project.mode === 'SOLO') return false;
  const member = db
    .prepare('SELECT id FROM journal_project_members WHERE project_id = ? AND user_id = ?')
    .get(Number(project.id), Number(userId));
  return Boolean(member);
}

function getProjectMembers(projectId: number): Array<{ user_id: number; name: string; email: string; role: string }> {
  return db
    .prepare(`
      SELECT m.user_id, u.name, u.email, m.role
      FROM journal_project_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.project_id = ?
      ORDER BY m.id ASC
    `)
    .all(projectId) as any[];
}

function notifyProjectPeers(
  project: { id: number; title: string; mode: string; created_by: number },
  actorUserId: number,
  body: string,
  tagSuffix: string
) {
  if (project.mode !== 'COLLAB') return;
  const members = getProjectMembers(Number(project.id));
  const peerIds = [Number(project.created_by), ...members.map((m) => Number(m.user_id))].filter(
    (id) => id > 0 && id !== Number(actorUserId)
  );
  if (peerIds.length === 0) return;
  void sendPushToUsers(peerIds, {
    title: `📌 ${project.title}`,
    body,
    projectId: Number(project.id),
    tag: `mindmap-${project.id}-${tagSuffix}`,
  });
}

function diffJstDays(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = String(fromYmd || '').slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(toYmd || '').slice(0, 10).split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
}

function sanitizeColor(raw: unknown): string {
  const str = typeof raw === 'string' ? raw.trim() : '';
  return /^#[0-9a-fA-F]{6}$/.test(str) ? str : '#1B4D3E';
}

function parseRelatedIdeaIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return Array.from(new Set(parsed.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)));
      }
    } catch {
      return [];
    }
  }
  return [];
}

function formatIdeaRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    parent_idea_id: row.parent_idea_id ? Number(row.parent_idea_id) : null,
    related_idea_ids: parseRelatedIdeaIds(row.related_idea_ids),
  };
}

function filterValidProjectIdeaIds(projectId: number, ids: number[], excludeId?: number): number[] {
  if (!ids.length) return [];
  const rows = db.prepare('SELECT id FROM journal_ideas WHERE project_id = ?').all(projectId) as Array<{ id: number }>;
  const validSet = new Set(rows.map((r) => Number(r.id)));
  return Array.from(new Set(ids.filter((id) => validSet.has(id) && id !== excludeId)));
}

function wouldCreateIdeaCycle(projectId: number, ideaId: number, candidateParentId: number): boolean {
  if (candidateParentId === ideaId) return true;
  const rows = db.prepare('SELECT id, parent_idea_id FROM journal_ideas WHERE project_id = ?').all(projectId) as Array<{
    id: number;
    parent_idea_id: number | null;
  }>;
  const parentMap = new Map<number, number | null>();
  for (const r of rows) {
    parentMap.set(Number(r.id), r.parent_idea_id ? Number(r.parent_idea_id) : null);
  }
  let curr: number | null = candidateParentId;
  const visited = new Set<number>();
  while (curr !== null) {
    if (curr === ideaId) return true;
    if (visited.has(curr)) return true;
    visited.add(curr);
    curr = parentMap.get(curr) ?? null;
  }
  return false;
}

function parseParticipants(raw: unknown): Array<{ name: string; role?: string }> {
  let list: any[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const seen = new Set<string>();
  const result: Array<{ name: string; role?: string }> = [];
  for (const item of list) {
    let name = '';
    let role = '';
    if (typeof item === 'string') {
      name = item.trim();
    } else if (item && typeof item === 'object') {
      name = typeof item.name === 'string' ? item.name.trim() : '';
      role = typeof item.role === 'string' ? item.role.trim() : '';
    }
    if (!name || name.length > 60) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(role ? { name, role: role.slice(0, 60) } : { name });
    if (result.length >= 40) break;
  }
  return result;
}

function sanitizeMindMapPositions(raw: unknown): Record<string, { x: number; y: number }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (typeof k !== 'string' || !k.trim() || k.length > 64) continue;
    if (!v || typeof v !== 'object') continue;
    const x = Number(v.x);
    const y = Number(v.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    result[k] = {
      x: Math.round(Math.max(-4000, Math.min(8000, x))),
      y: Math.round(Math.max(-4000, Math.min(8000, y))),
    };
  }
  return result;
}

function sanitizeMindMapEdges(
  raw: unknown
): Array<{ id: string; fromKey: string; fromSide: string; toKey: string; toSide: string; color?: string }> {
  if (!Array.isArray(raw)) return [];
  const edges: Array<{ id: string; fromKey: string; fromSide: string; toKey: string; toSide: string; color?: string }> = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const fromKey = typeof item.fromKey === 'string' ? item.fromKey.trim() : '';
    const toKey = typeof item.toKey === 'string' ? item.toKey.trim() : '';
    const fromSide = typeof item.fromSide === 'string' && VALID_PORT_SIDES.has(item.fromSide) ? item.fromSide : 'right';
    const toSide = typeof item.toSide === 'string' && VALID_PORT_SIDES.has(item.toSide) ? item.toSide : 'left';
    if (!fromKey || !toKey || fromKey === toKey || fromKey.length > 64 || toKey.length > 64) continue;
    const sig = `${fromKey}:${fromSide}->${toKey}:${toSide}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 80) : sig;
    const color =
      typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color.trim())
        ? item.color.trim()
        : undefined;
    edges.push({ id, fromKey, fromSide, toKey, toSide, ...(color ? { color } : {}) });
  }
  return edges;
}

function sanitizeParentOverrides(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    const ck = k.trim();
    const cv = v.trim();
    if (!ck || !cv || ck === cv || ck.length > 64 || cv.length > 64) continue;
    result[ck] = cv;
  }
  return result;
}

function formatMindMapLayoutRow(row: any) {
  if (!row) return { positions: {}, custom_edges: [], parent_overrides: {} };
  let positions = {};
  let custom_edges: any[] = [];
  let parent_overrides: Record<string, string> = {};
  try {
    if (typeof row.positions_json === 'string') {
      positions = sanitizeMindMapPositions(JSON.parse(row.positions_json));
    }
  } catch {
    positions = {};
  }
  try {
    if (typeof row.edges_json === 'string') {
      custom_edges = sanitizeMindMapEdges(JSON.parse(row.edges_json));
    }
  } catch {
    custom_edges = [];
  }
  try {
    if (typeof row.parent_overrides_json === 'string') {
      parent_overrides = sanitizeParentOverrides(JSON.parse(row.parent_overrides_json));
    }
  } catch {
    parent_overrides = {};
  }
  return { positions, custom_edges, parent_overrides };
}

/**
 * Multi-user relative turn perspective & dialogue speaker alignment
 */
function resolveViewerTurnPerspective(
  p: any,
  viewerId: number,
  members: Array<{ user_id: number; name: string }>
): { turn_state: string; resolved_partner_name: string; active_turn_user_name: string } {
  const hasAppMembers = p.mode === 'COLLAB' && members.length > 0;
  let effectiveTurn = p.turn_state;
  let activeTurnUserName = '';

  if (hasAppMembers && (p.turn_state === 'MY_TURN' || p.turn_state === 'THEIR_TURN')) {
    const activeTurnId = p.active_turn_user_id ? Number(p.active_turn_user_id) : Number(p.created_by);
    effectiveTurn = activeTurnId === Number(viewerId) ? 'MY_TURN' : 'THEIR_TURN';
    if (activeTurnId === Number(p.created_by)) {
      activeTurnUserName = p.creator_name || '';
    } else {
      activeTurnUserName =
        members.find((m) => Number(m.user_id) === activeTurnId)?.name ||
        p.active_turn_user_name ||
        '';
    }
  }

  let resolvedPartner = '';
  if (p.mode === 'COLLAB') {
    if (hasAppMembers) {
      const otherUsers = [
        ...(Number(p.created_by) !== Number(viewerId) ? [p.creator_name] : []),
        ...members.filter((m) => Number(m.user_id) !== Number(viewerId)).map((m) => m.name),
      ].filter(Boolean);
      resolvedPartner = otherUsers.join(', ') || p.partner_name || '';
    } else {
      resolvedPartner = p.partner_name || '';
    }
  }

  return {
    turn_state: effectiveTurn,
    resolved_partner_name: resolvedPartner,
    active_turn_user_name: activeTurnUserName,
  };
}

function resolveTargetTurnUserId(
  existing: any,
  members: Array<{ user_id: number; name: string }>,
  actorUserId: number,
  nextTurnState: string,
  rawTargetTurnUserId: unknown
): number | null {
  if (nextTurnState === 'MY_TURN') return actorUserId;
  if (nextTurnState === 'THEIR_TURN') {
    const allowedOtherIds = Array.from(
      new Set([Number(existing.created_by), ...members.map((m) => Number(m.user_id))])
    ).filter((id) => id > 0 && id !== actorUserId);

    const requested = Number(rawTargetTurnUserId);
    if (Number.isInteger(requested) && requested > 0 && allowedOtherIds.includes(requested)) {
      return requested;
    }
    return allowedOtherIds[0] ?? null;
  }
  return existing.active_turn_user_id ? Number(existing.active_turn_user_id) : null;
}

function mapEntryForViewer(en: any, viewerId: number) {
  // In shared member projects, another member's DIALOGUE_ME appears on the left as DIALOGUE_THEM with their name
  if (en.entry_type === 'DIALOGUE_ME' && Number(en.author_id) !== Number(viewerId)) {
    return {
      ...en,
      entry_type: 'DIALOGUE_THEM',
      speaker_name: en.speaker_name || en.author_name || '',
    };
  }
  return en;
}

// 1. Overview (Accessible projects + Inbox + Entries + Ideas + Layouts)
router.get('/overview', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const todayJst = getJstDateStr();
  const windowStart14d = getJstDateStrWithDayOffset(-13);

  try {
    const rawProjects = db.prepare(`
      SELECT p.*,
        creator.name as creator_name,
        (SELECT COUNT(*) FROM journal_entries e WHERE e.project_id = p.id) as entry_count,
        (SELECT COUNT(*) FROM journal_entries e WHERE e.project_id = p.id AND e.entry_type IN ('DIALOGUE_ME', 'DIALOGUE_THEM')) as dialogue_count,
        (SELECT COUNT(*) FROM journal_ideas i WHERE i.project_id = p.id AND i.status = 'OPEN') as open_idea_count,
        (SELECT content FROM journal_entries e WHERE e.project_id = p.id ORDER BY e.entry_date DESC, COALESCE(e.entry_time, '00:00') DESC, e.id DESC LIMIT 1) as latest_entry_content,
        (SELECT entry_type FROM journal_entries e WHERE e.project_id = p.id ORDER BY e.entry_date DESC, COALESCE(e.entry_time, '00:00') DESC, e.id DESC LIMIT 1) as latest_entry_type,
        (SELECT entry_date FROM journal_entries e WHERE e.project_id = p.id ORDER BY e.entry_date DESC, COALESCE(e.entry_time, '00:00') DESC, e.id DESC LIMIT 1) as latest_entry_date
      FROM journal_projects p
      LEFT JOIN users creator ON p.created_by = creator.id
      WHERE (
        p.created_by = ?
        OR (
          p.mode != 'SOLO'
          AND EXISTS (
            SELECT 1 FROM journal_project_members m
            WHERE m.project_id = p.id AND m.user_id = ?
          )
        )
      )
      ORDER BY p.last_activity_at DESC, p.id DESC
    `).all(userId, userId) as any[];

    const projectIds = rawProjects.map((p) => Number(p.id));
    const membersByProject = new Map<number, any[]>();
    if (projectIds.length > 0) {
      const memberRows = db.prepare(`
        SELECT m.project_id, m.user_id, u.name, u.email, m.role
        FROM journal_project_members m
        INNER JOIN users u ON u.id = m.user_id
        INNER JOIN journal_projects p ON p.id = m.project_id
        WHERE (
          p.created_by = ?
          OR (
            p.mode != 'SOLO'
            AND EXISTS (SELECT 1 FROM journal_project_members m2 WHERE m2.project_id = p.id AND m2.user_id = ?)
          )
        )
        ORDER BY m.id ASC
      `).all(userId, userId) as any[];
      for (const mr of memberRows) {
        const pid = Number(mr.project_id);
        const list = membersByProject.get(pid) || [];
        list.push(mr);
        membersByProject.set(pid, list);
      }
    }

    const recentActivityRows = db.prepare(`
      SELECT e.project_id, e.entry_date, COUNT(*) as cnt
      FROM journal_entries e
      INNER JOIN journal_projects p ON p.id = e.project_id
      WHERE e.entry_date >= ?
        AND (
          p.created_by = ?
          OR (
            p.mode != 'SOLO'
            AND EXISTS (SELECT 1 FROM journal_project_members m WHERE m.project_id = p.id AND m.user_id = ?)
          )
        )
      GROUP BY e.project_id, e.entry_date
    `).all(windowStart14d, userId, userId) as Array<{ project_id: number; entry_date: string; cnt: number }>;

    const recentMap = new Map<number, Record<string, number>>();
    for (const row of recentActivityRows) {
      let byDate = recentMap.get(row.project_id);
      if (!byDate) {
        byDate = {};
        recentMap.set(row.project_id, byDate);
      }
      byDate[row.entry_date] = row.cnt;
    }

    const allEntryRows = db.prepare(`
      SELECT e.id, e.project_id, e.entry_type, e.speaker_name, e.content, e.entry_date, e.entry_time, e.due_date, e.due_time, e.completed_target_type, e.completed_target_id, e.author_id, u.name as author_name
      FROM journal_entries e
      INNER JOIN journal_projects p ON p.id = e.project_id
      LEFT JOIN users u ON e.author_id = u.id
      WHERE (
        p.created_by = ?
        OR (
          p.mode != 'SOLO'
          AND EXISTS (SELECT 1 FROM journal_project_members m WHERE m.project_id = p.id AND m.user_id = ?)
        )
      )
      ORDER BY e.entry_date ASC, COALESCE(e.entry_time, '00:00') ASC, e.id ASC
    `).all(userId, userId) as any[];

    const entriesByProject = new Map<number, any[]>();
    for (const row of allEntryRows) {
      const pid = Number(row.project_id);
      const list = entriesByProject.get(pid) || [];
      list.push(mapEntryForViewer(row, userId));
      entriesByProject.set(pid, list);
    }

    const allIdeaRows = db.prepare(`
      SELECT i.*, u.name as author_name
      FROM journal_ideas i
      INNER JOIN journal_projects p ON p.id = i.project_id
      LEFT JOIN users u ON i.author_id = u.id
      WHERE (
        p.created_by = ?
        OR (
          p.mode != 'SOLO'
          AND EXISTS (SELECT 1 FROM journal_project_members m WHERE m.project_id = p.id AND m.user_id = ?)
        )
      )
      ORDER BY CASE WHEN i.status = 'OPEN' THEN 0 WHEN i.status = 'PROMOTED' THEN 1 ELSE 2 END, i.id ASC
    `).all(userId, userId) as any[];

    const ideasByProject = new Map<number, any[]>();
    for (const row of allIdeaRows) {
      const pid = Number(row.project_id);
      const list = ideasByProject.get(pid) || [];
      list.push(formatIdeaRow(row));
      ideasByProject.set(pid, list);
    }

    const allLayoutRows = db.prepare(`
      SELECT l.project_id, l.positions_json, l.edges_json, l.parent_overrides_json
      FROM journal_mindmap_layouts l
      INNER JOIN journal_projects p ON p.id = l.project_id
      WHERE (
        p.created_by = ?
        OR (
          p.mode != 'SOLO'
          AND EXISTS (SELECT 1 FROM journal_project_members m WHERE m.project_id = p.id AND m.user_id = ?)
        )
      )
    `).all(userId, userId) as any[];

    const layoutsByProject = new Map<number, any>();
    for (const row of allLayoutRows) {
      layoutsByProject.set(Number(row.project_id), formatMindMapLayoutRow(row));
    }

    const projects = rawProjects.map((p) => {
      const members = membersByProject.get(Number(p.id)) || [];
      const { turn_state, resolved_partner_name, active_turn_user_name } = resolveViewerTurnPerspective(
        p,
        userId,
        members
      );
      const lastYmd = String(p.last_activity_at || todayJst).slice(0, 10);
      const daysSinceUpdate = diffJstDays(lastYmd, todayJst);
      const threshold = Math.max(1, Number(p.stale_threshold_days) || 7);
      const hasNextAction = Boolean(p.next_action && String(p.next_action).trim().length > 0);
      const isActive = turn_state !== 'DONE' && turn_state !== 'HOLD';
      const isStale = isActive && (daysSinceUpdate >= threshold || !hasNextAction);
      const isOverdueNextAction = Boolean(
        isActive && p.next_action_date && String(p.next_action_date).slice(0, 10) < todayJst
      );

      return {
        ...p,
        turn_state,
        is_private: Number(p.is_private),
        days_since_update: daysSinceUpdate,
        is_stale: isStale || isOverdueNextAction,
        is_missing_next_action: isActive && !hasNextAction,
        is_overdue_next_action: isOverdueNextAction,
        resolved_partner_name,
        active_turn_user_name,
        members,
        participants: parseParticipants(p.participants_json),
        recent_activity: recentMap.get(p.id) || {},
        timeline_entries: entriesByProject.get(Number(p.id)) || [],
        ideas: ideasByProject.get(Number(p.id)) || [],
        mindmap_layout: layoutsByProject.get(Number(p.id)) || { positions: {}, custom_edges: [], parent_overrides: {} },
      };
    });

    const inbox = db.prepare(`
      SELECT id, content, linked_project_id, is_processed, author_id, created_at
      FROM journal_inbox
      WHERE author_id = ? AND is_processed = 0
      ORDER BY id DESC
    `).all(userId);

    res.json({ projects, inbox, todayJst });
  } catch (err: any) {
    res.status(500).json({ error: '프로젝트 저널 조회 실패: ' + err.message });
  }
});

// 2. Create project
router.post('/projects', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const {
    title,
    mode = 'SOLO',
    partner_type = 'NONE',
    partner_name,
    participants,
    intent_summary,
    turn_state = 'MY_TURN',
    next_action,
    next_action_date,
    stale_threshold_days = 7,
    color = '#1B4D3E',
  } = req.body || {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: '프로젝트 제목을 입력해주세요.' });
    return;
  }

  const finalMode = VALID_MODES.has(mode) ? mode : 'SOLO';
  const finalIsPrivate = finalMode === 'SOLO' ? 1 : 0;
  const finalPartnerType =
    finalMode === 'SOLO'
      ? 'NONE'
      : VALID_PARTNER_TYPES.has(partner_type)
      ? partner_type
      : 'SHARED';
  const finalPartnerName =
    finalMode === 'COLLAB' && partner_name ? String(partner_name).trim() : null;
  const finalInviteToken = finalMode === 'COLLAB' ? generateInviteToken() : null;
  const finalTurnState = VALID_TURN_STATES.has(turn_state) ? turn_state : 'MY_TURN';
  const finalThreshold = Math.min(90, Math.max(1, Number(stale_threshold_days) || 7));
  const finalParticipants = parseParticipants(participants);
  const nowJst = getJstDateTimeStr();
  const todayJst = getJstDateStr();
  const timeJst = getJstTimeStr();

  const trimmedIntent = intent_summary && String(intent_summary).trim() ? String(intent_summary).trim() : null;

  try {
    const createTx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO journal_projects (
          title, mode, is_private, partner_type, partner_name, invite_token, active_turn_user_id,
          participants_json, intent_summary, initial_intent_summary, intent_modified, turn_state, next_action, next_action_date,
          stale_threshold_days, last_activity_at, color, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(title).trim(),
        finalMode,
        finalIsPrivate,
        finalPartnerType,
        finalPartnerName,
        finalInviteToken,
        finalTurnState === 'MY_TURN' ? userId : null,
        JSON.stringify(finalParticipants),
        trimmedIntent,
        trimmedIntent,
        finalTurnState,
        next_action ? String(next_action).trim() : null,
        next_action_date ? String(next_action_date).trim() : null,
        finalThreshold,
        nowJst,
        sanitizeColor(color),
        userId
      );

      const newId = Number(info.lastInsertRowid);
      if (trimmedIntent) {
        db.prepare(`
          INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
          VALUES (?, 'INTENT', ?, ?, ?, ?)
        `).run(newId, trimmedIntent, todayJst, timeJst, userId);
      }

      return newId;
    });

    const newId = createTx();
    const created = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(newId) as any;
    res.status(201).json({
      ...created,
      participants: parseParticipants(created?.participants_json),
      members: [],
    });
  } catch (err: any) {
    res.status(500).json({ error: '프로젝트 생성 실패: ' + err.message });
  }
});

// 3. Project Detail
router.get('/projects/:id', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const project = db.prepare(`
      SELECT p.*, creator.name as creator_name
      FROM journal_projects p
      LEFT JOIN users creator ON p.created_by = creator.id
      WHERE p.id = ?
    `).get(projectId) as any;

    if (!project) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }

    if (!canAccessJournalProject(project, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    const members = getProjectMembers(projectId);
    const { turn_state, resolved_partner_name, active_turn_user_name } = resolveViewerTurnPerspective(
      project,
      userId,
      members
    );

    const rawEntries = db.prepare(`
      SELECT e.*, u.name as author_name
      FROM journal_entries e
      LEFT JOIN users u ON e.author_id = u.id
      WHERE e.project_id = ?
      ORDER BY e.entry_date ASC, COALESCE(e.entry_time, '00:00') ASC, e.id ASC
    `).all(projectId) as any[];

    const rawIdeas = db.prepare(`
      SELECT i.*, u.name as author_name
      FROM journal_ideas i
      LEFT JOIN users u ON i.author_id = u.id
      WHERE i.project_id = ?
      ORDER BY CASE WHEN i.status = 'OPEN' THEN 0 WHEN i.status = 'PROMOTED' THEN 1 ELSE 2 END, i.id DESC
    `).all(projectId) as any[];
    const ideas = rawIdeas.map(formatIdeaRow);

    const mappedRawEntries = rawEntries.map((en) => mapEntryForViewer(en, userId));
    const entryLookup = new Map<number, any>();
    for (const en of mappedRawEntries) entryLookup.set(Number(en.id), en);
    const ideaLookup = new Map<number, any>();
    for (const idItem of ideas) ideaLookup.set(Number(idItem.id), idItem);

    const entries = mappedRawEntries.map((en) => {
      let completed_target_summary: string | null = null;
      let completed_target_kind: string | null = null;
      let completed_target_date: string | null = null;
      if (en.completed_target_type === 'ENTRY' && en.completed_target_id) {
        const tgt = entryLookup.get(Number(en.completed_target_id));
        if (tgt) {
          completed_target_summary = tgt.content;
          completed_target_kind = tgt.entry_type;
          completed_target_date = tgt.entry_date;
        }
      } else if (en.completed_target_type === 'IDEA' && en.completed_target_id) {
        const tgt = ideaLookup.get(Number(en.completed_target_id));
        if (tgt) {
          completed_target_summary = tgt.title;
          completed_target_kind = 'IDEA';
          completed_target_date = null;
        }
      }
      return {
        ...en,
        completed_target_summary,
        completed_target_kind,
        completed_target_date,
      };
    });

    const layoutRow = db
      .prepare('SELECT positions_json, edges_json, parent_overrides_json FROM journal_mindmap_layouts WHERE project_id = ?')
      .get(projectId);

    res.json({
      project: {
        ...project,
        turn_state,
        is_private: Number(project.is_private),
        resolved_partner_name,
        active_turn_user_name,
        members,
        participants: parseParticipants(project.participants_json),
        mindmap_layout: formatMindMapLayoutRow(layoutRow),
      },
      entries,
      ideas,
    });
  } catch (err: any) {
    res.status(500).json({ error: '프로젝트 상세 조회 실패: ' + err.message });
  }
});

// 4. Update project settings / Turn / Next Step / Stakeholders
router.patch('/projects/:id', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (!canAccessJournalProject(existing, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    const body = req.body || {};
    const isCreator = Number(existing.created_by) === userId;
    const members = getProjectMembers(projectId);

    const nextMode = body.mode !== undefined && isCreator && VALID_MODES.has(body.mode) ? body.mode : existing.mode;
    const nextIsPrivate = nextMode === 'SOLO' ? 1 : 0;
    const nextPartnerType =
      nextMode === 'SOLO'
        ? 'NONE'
        : body.partner_type !== undefined && VALID_PARTNER_TYPES.has(body.partner_type)
        ? body.partner_type
        : existing.partner_type === 'NONE'
        ? 'SHARED'
        : existing.partner_type;
    const nextPartnerName =
      nextMode === 'COLLAB'
        ? (body.partner_name !== undefined ? (body.partner_name ? String(body.partner_name).trim() : null) : existing.partner_name)
        : null;
    const nextInviteToken =
      nextMode === 'COLLAB' ? existing.invite_token || generateInviteToken() : existing.invite_token;

    const nextTitle = body.title !== undefined && String(body.title).trim() ? String(body.title).trim() : existing.title;
    const nextIntent = body.intent_summary !== undefined ? (body.intent_summary ? String(body.intent_summary).trim() : null) : existing.intent_summary;
    const existingInitialIntent =
      existing.initial_intent_summary !== undefined && existing.initial_intent_summary !== null
        ? existing.initial_intent_summary
        : existing.intent_summary ?? null;
    let nextInitialIntent = existingInitialIntent;
    let nextIntentModified = Number(existing.intent_modified) === 1 ? 1 : 0;
    if (body.intent_summary !== undefined && nextIntent !== existing.intent_summary) {
      if (existingInitialIntent === null && nextIntent !== null && nextIntentModified === 0) {
        nextInitialIntent = nextIntent;
      } else {
        nextIntentModified = 1;
      }
    }
    const nextTurnState = body.turn_state !== undefined && VALID_TURN_STATES.has(body.turn_state) ? body.turn_state : existing.turn_state;

    let nextActiveTurnUserId = existing.active_turn_user_id ? Number(existing.active_turn_user_id) : null;
    if (body.turn_state !== undefined || body.target_turn_user_id !== undefined) {
      nextActiveTurnUserId = resolveTargetTurnUserId(
        existing,
        members,
        userId,
        nextTurnState,
        body.target_turn_user_id
      );
    }

    const nextAction = body.next_action !== undefined ? (body.next_action ? String(body.next_action).trim() : null) : existing.next_action;
    const nextActionDate = body.next_action_date !== undefined ? (body.next_action_date ? String(body.next_action_date).trim() : null) : existing.next_action_date;
    const nextThreshold = body.stale_threshold_days !== undefined ? Math.min(90, Math.max(1, Number(body.stale_threshold_days) || 7)) : existing.stale_threshold_days;
    const nextColor = body.color !== undefined ? sanitizeColor(body.color) : existing.color;
    const nextParticipants =
      body.participants !== undefined
        ? parseParticipants(body.participants)
        : parseParticipants(existing.participants_json);
    const nowJst = getJstDateTimeStr();

    db.prepare(`
      UPDATE journal_projects
      SET title = ?,
          mode = ?,
          is_private = ?,
          partner_type = ?,
          partner_name = ?,
          invite_token = ?,
          active_turn_user_id = ?,
          participants_json = ?,
          intent_summary = ?,
          initial_intent_summary = ?,
          intent_modified = ?,
          turn_state = ?,
          next_action = ?,
          next_action_date = ?,
          stale_threshold_days = ?,
          color = ?,
          last_activity_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextTitle,
      nextMode,
      nextIsPrivate,
      nextPartnerType,
      nextPartnerName,
      nextInviteToken,
      nextActiveTurnUserId,
      JSON.stringify(nextParticipants),
      nextIntent,
      nextInitialIntent,
      nextIntentModified,
      nextTurnState,
      nextAction,
      nextActionDate,
      nextThreshold,
      nextColor,
      nowJst,
      projectId
    );

    const updated = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;

    if (updated) {
      const actorName = req.user!.name;
      const changedLabels: string[] = [];
      let turnMsg: string | null = null;
      const prevActiveTurnId = existing.active_turn_user_id ? Number(existing.active_turn_user_id) : null;
      const turnChanged =
        nextTurnState !== existing.turn_state ||
        (nextTurnState === 'THEIR_TURN' && nextActiveTurnUserId !== prevActiveTurnId);

      if (turnChanged) {
        if (nextTurnState === 'THEIR_TURN') {
          let targetName = '';
          if (nextActiveTurnUserId) {
            const targetRow = db
              .prepare('SELECT name FROM users WHERE id = ?')
              .get(nextActiveTurnUserId) as { name?: string } | undefined;
            targetName = targetRow?.name || '';
          }
          turnMsg = targetName
            ? `${actorName}님이 ${targetName}님에게 턴을 넘겼습니다.`
            : `${actorName}님이 턴을 넘겼습니다.`;
        } else if (nextTurnState === 'DONE') {
          turnMsg = `${actorName}님이 프로젝트를 완료 상태로 변경했습니다.`;
        } else if (nextTurnState === 'HOLD') {
          turnMsg = `${actorName}님이 프로젝트를 보류 상태로 변경했습니다.`;
        } else {
          turnMsg = `${actorName}님이 턴 상태를 업데이트했습니다.`;
        }
      }
      if (nextTitle !== existing.title) changedLabels.push('제목');
      if (nextIntent !== existing.intent_summary) changedLabels.push('핵심 의도·메모');
      if (nextAction !== existing.next_action || nextActionDate !== existing.next_action_date) {
        changedLabels.push('다음 할 일');
      }
      if (JSON.stringify(nextParticipants) !== String(existing.participants_json || '[]')) {
        changedLabels.push('관계자 목록');
      }

      if (turnMsg || changedLabels.length > 0) {
        const bodyText =
          turnMsg && changedLabels.length > 0
            ? `${turnMsg} (${changedLabels.join(', ')} 수정)`
            : turnMsg || `${actorName}님이 ${changedLabels.join(', ')}을(를) 수정했습니다.`;
        notifyProjectPeers(
          { id: projectId, title: nextTitle, mode: nextMode, created_by: Number(existing.created_by) },
          userId,
          bodyText,
          'project-update'
        );
      }
    }

    res.json({
      ...updated,
      participants: parseParticipants(updated?.participants_json),
      members,
    });
  } catch (err: any) {
    res.status(500).json({ error: '프로젝트 수정 실패: ' + err.message });
  }
});

// 5. Delete project (creator only)
router.delete('/projects/:id', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (Number(existing.created_by) !== userId) {
      res.status(403).json({ error: '프로젝트 삭제는 작성자 본인만 할 수 있습니다.' });
      return;
    }

    const peerIds =
      existing.mode === 'COLLAB'
        ? [
            Number(existing.created_by),
            ...getProjectMembers(projectId).map((m) => Number(m.user_id)),
          ].filter((id) => id > 0 && id !== userId)
        : [];

    db.prepare('DELETE FROM journal_projects WHERE id = ?').run(projectId);
    if (peerIds.length > 0) {
      void sendPushToUsers(peerIds, {
        title: `📌 ${existing.title}`,
        body: `🗑️ ${req.user!.name}님이 프로젝트를 삭제했습니다.`,
        projectId,
        tag: `mindmap-${projectId}-deleted`,
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '프로젝트 삭제 실패: ' + err.message });
  }
});

// Collaboration Invite & Member Management (No global directory exposure!)
router.post('/projects/:id/invite/regenerate', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (Number(existing.created_by) !== userId) {
      res.status(403).json({ error: '초대 코드는 프로젝트 소유자만 재발급할 수 있습니다.' });
      return;
    }

    const newToken = generateInviteToken();
    db.prepare(`
      UPDATE journal_projects
      SET invite_token = ?, mode = 'COLLAB', is_private = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newToken, projectId);

    res.json({ invite_token: newToken });
  } catch (err: any) {
    res.status(500).json({ error: '초대 코드 생성 실패: ' + err.message });
  }
});

router.post('/projects/:id/members', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);
  const cleanEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!cleanEmail) {
    res.status(400).json({ error: '초대할 사용자의 이메일을 입력해주세요.' });
    return;
  }

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (Number(existing.created_by) !== userId) {
      res.status(403).json({ error: '멤버 초대는 프로젝트 소유자만 할 수 있습니다.' });
      return;
    }

    const targetUser = db
      .prepare('SELECT id, name, email FROM users WHERE email = ?')
      .get(cleanEmail) as { id: number; name: string; email: string } | undefined;

    if (!targetUser) {
      res.status(404).json({
        error: '해당 이메일로 가입된 계정이 없습니다. 상단 초대 링크를 복사해 전달해 주세요.',
      });
      return;
    }
    if (Number(targetUser.id) === userId) {
      res.status(400).json({ error: '본인은 이미 프로젝트 소유자입니다.' });
      return;
    }

    db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO journal_project_members (project_id, user_id, role)
        VALUES (?, ?, 'MEMBER')
      `).run(projectId, Number(targetUser.id));

      db.prepare(`
        UPDATE journal_projects
        SET mode = 'COLLAB', is_private = 0, partner_type = 'SHARED',
            invite_token = COALESCE(invite_token, ?), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(generateInviteToken(), projectId);
    })();

    notifyProjectPeers(
      { id: projectId, title: existing.title, mode: 'COLLAB', created_by: Number(existing.created_by) },
      userId,
      `👋 ${req.user!.name}님이 ${targetUser.name}님을 프로젝트 멤버로 초대했습니다.`,
      `member-add-${targetUser.id}`
    );

    res.status(201).json({ members: getProjectMembers(projectId) });
  } catch (err: any) {
    res.status(500).json({ error: '멤버 추가 실패: ' + err.message });
  }
});

router.delete('/projects/:id/members/:memberUserId', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const memberUserId = Number(req.params.memberUserId);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (Number(existing.created_by) !== userId && memberUserId !== userId) {
      res.status(403).json({ error: '권한이 없습니다.' });
      return;
    }

    const targetUser = db
      .prepare('SELECT id, name FROM users WHERE id = ?')
      .get(memberUserId) as { id: number; name: string } | undefined;

    const info = db
      .prepare('DELETE FROM journal_project_members WHERE project_id = ? AND user_id = ?')
      .run(projectId, memberUserId);

    if (info.changes > 0 && Number(existing.active_turn_user_id) === memberUserId) {
      db.prepare('UPDATE journal_projects SET active_turn_user_id = ? WHERE id = ?').run(
        Number(existing.created_by),
        projectId
      );
    }

    if (info.changes > 0 && existing.mode === 'COLLAB') {
      const targetName = targetUser?.name || '멤버';
      const bodyText =
        memberUserId === userId
          ? `👋 ${req.user!.name}님이 프로젝트에서 나갔습니다.`
          : `👋 ${req.user!.name}님이 ${targetName}님을 멤버에서 제외했습니다.`;
      notifyProjectPeers(
        { id: projectId, title: existing.title, mode: existing.mode, created_by: Number(existing.created_by) },
        userId,
        bodyText,
        `member-rm-${memberUserId}`
      );
      if (memberUserId !== userId) {
        void sendPushToUsers([memberUserId], {
          title: `📌 ${existing.title}`,
          body: `👋 ${req.user!.name}님이 프로젝트 멤버에서 제외했습니다.`,
          projectId,
          tag: `mindmap-${projectId}-removed`,
        });
      }
    }

    res.json({ members: getProjectMembers(projectId) });
  } catch (err: any) {
    res.status(500).json({ error: '멤버 제거 실패: ' + err.message });
  }
});

router.post('/invites/accept', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

  // Allow pasting a full invite URL or raw token
  let token = rawToken;
  const queryMatch = rawToken.match(/[?&]invite=([a-fA-F0-9]+)/);
  if (queryMatch) token = queryMatch[1];

  if (!token) {
    res.status(400).json({ error: '유효한 초대 코드 또는 링크를 입력해주세요.' });
    return;
  }

  try {
    const project = db
      .prepare('SELECT id, title, created_by FROM journal_projects WHERE invite_token = ?')
      .get(token) as { id: number; title: string; created_by: number } | undefined;

    if (!project) {
      res.status(404).json({ error: '초대 코드를 찾을 수 없거나 만료되었습니다.' });
      return;
    }

    if (Number(project.created_by) === userId) {
      res.json({ project_id: project.id, title: project.title, alreadyOwner: true });
      return;
    }

    let joinedNewly = false;
    db.transaction(() => {
      const insertInfo = db.prepare(`
        INSERT OR IGNORE INTO journal_project_members (project_id, user_id, role)
        VALUES (?, ?, 'MEMBER')
      `).run(project.id, userId);
      joinedNewly = insertInfo.changes > 0;

      db.prepare(`
        UPDATE journal_projects
        SET mode = 'COLLAB', is_private = 0, partner_type = 'SHARED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(project.id);
    })();

    if (joinedNewly) {
      notifyProjectPeers(
        { id: Number(project.id), title: project.title, mode: 'COLLAB', created_by: Number(project.created_by) },
        userId,
        `👋 ${req.user!.name}님이 초대코드로 참여했습니다.`,
        `invite-${userId}`
      );
    }

    res.json({ project_id: project.id, title: project.title, joined: true });
  } catch (err: any) {
    res.status(500).json({ error: '초대 수락 실패: ' + err.message });
  }
});

// 6. Add timeline entry
router.post('/projects/:id/entries', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);
  const {
    entry_type = 'INTENT',
    speaker_name,
    content,
    entry_date,
    entry_time,
    due_date,
    due_time,
    next_turn_state,
    target_turn_user_id,
    next_action,
    completed_target_type,
    completed_target_id,
  } = req.body || {};

  if (!content || !String(content).trim()) {
    res.status(400).json({ error: '기록할 내용을 입력해주세요.' });
    return;
  }

  const finalType = VALID_ENTRY_TYPES.has(entry_type) ? entry_type : 'INTENT';
  const finalDate =
    entry_date === undefined
      ? getJstDateStr()
      : entry_date && /^\d{4}-\d{2}-\d{2}$/.test(String(entry_date))
      ? String(entry_date)
      : '';
  const finalTime = entry_time && /^\d{2}:\d{2}$/.test(String(entry_time)) ? String(entry_time) : null;
  const finalDueDate = due_date && /^\d{4}-\d{2}-\d{2}$/.test(String(due_date)) ? String(due_date) : null;
  const finalDueTime = due_time && /^\d{2}:\d{2}$/.test(String(due_time)) ? String(due_time) : null;
  const nowJst = getJstDateTimeStr();

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (!canAccessJournalProject(existing, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    let validTargetType: 'ENTRY' | 'IDEA' | null = null;
    let validTargetId: number | null = null;
    if (finalType === 'PROGRESS' && completed_target_type && completed_target_id) {
      const targetNum = Number(completed_target_id);
      if (completed_target_type === 'ENTRY') {
        const tgt = db
          .prepare("SELECT id FROM journal_entries WHERE id = ? AND project_id = ? AND entry_type != 'PROGRESS'")
          .get(targetNum, projectId);
        if (!tgt) {
          res.status(400).json({ error: '완료 대상 항목을 찾을 수 없습니다.' });
          return;
        }
        validTargetType = 'ENTRY';
        validTargetId = targetNum;
      } else if (completed_target_type === 'IDEA') {
        const tgt = db
          .prepare('SELECT id FROM journal_ideas WHERE id = ? AND project_id = ?')
          .get(targetNum, projectId);
        if (!tgt) {
          res.status(400).json({ error: '완료 대상 항목을 찾을 수 없습니다.' });
          return;
        }
        validTargetType = 'IDEA';
        validTargetId = targetNum;
      }
    }

    const members = getProjectMembers(projectId);

    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO journal_entries (project_id, entry_type, speaker_name, content, entry_date, entry_time, due_date, due_time, completed_target_type, completed_target_id, author_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId,
        finalType,
        speaker_name ? String(speaker_name).trim() : null,
        String(content).trim(),
        finalDate,
        finalTime,
        finalDueDate,
        finalDueTime,
        validTargetType,
        validTargetId,
        userId
      );

      const updatedTurn = next_turn_state && VALID_TURN_STATES.has(next_turn_state) ? next_turn_state : existing.turn_state;
      const updatedActiveTurnUserId = next_turn_state
        ? resolveTargetTurnUserId(existing, members, userId, updatedTurn, target_turn_user_id)
        : existing.active_turn_user_id
        ? Number(existing.active_turn_user_id)
        : null;

      const updatedNextAction = next_action !== undefined ? (next_action ? String(next_action).trim() : null) : existing.next_action;

      db.prepare(`
        UPDATE journal_projects
        SET turn_state = ?,
            active_turn_user_id = ?,
            next_action = ?,
            last_activity_at = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(updatedTurn, updatedActiveTurnUserId, updatedNextAction, nowJst, projectId);

      return Number(info.lastInsertRowid);
    });

    const entryId = tx();
    const created = db.prepare(`
      SELECT e.*, u.name as author_name
      FROM journal_entries e
      LEFT JOIN users u ON e.author_id = u.id
      WHERE e.id = ?
    `).get(entryId);

    const snippet = String(content).trim().slice(0, 70);
    const dueSuffix = finalDueDate ? ` (마감 ${finalDueDate}${finalDueTime ? ` ${finalDueTime}` : ''})` : '';
    const entryBody =
      finalType === 'PROGRESS'
        ? `✅ ${req.user!.name}님이 완료 기록을 남겼습니다: ${snippet}`
        : `${req.user!.name}: ${snippet}${dueSuffix}`;
    notifyProjectPeers(
      { id: projectId, title: existing.title, mode: existing.mode, created_by: Number(existing.created_by) },
      userId,
      entryBody,
      `entry-${entryId}`
    );

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: '기록 등록 실패: ' + err.message });
  }
});

// 7. Delete timeline entry
router.delete('/entries/:entryId', authenticateToken, (req: Request, res: Response) => {
  const entryId = Number(req.params.entryId);
  const userId = Number(req.user!.id);

  try {
    const entry = db.prepare(`
      SELECT e.*, p.created_by as project_owner_id, p.title as project_title, p.mode as project_mode
      FROM journal_entries e
      INNER JOIN journal_projects p ON p.id = e.project_id
      WHERE e.id = ?
    `).get(entryId) as any;

    if (!entry) {
      res.status(404).json({ error: '기록을 찾을 수 없습니다.' });
      return;
    }

    if (Number(entry.author_id) !== userId && Number(entry.project_owner_id) !== userId) {
      res.status(403).json({ error: '삭제 권한이 없습니다.' });
      return;
    }

    db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entryId);
    notifyProjectPeers(
      {
        id: Number(entry.project_id),
        title: entry.project_title,
        mode: entry.project_mode,
        created_by: Number(entry.project_owner_id),
      },
      userId,
      `🗑️ ${req.user!.name}님이 타임라인 기록을 삭제했습니다: ${String(entry.content || '').trim().slice(0, 45)}`,
      `entry-del-${entryId}`
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '기록 삭제 실패: ' + err.message });
  }
});

// 8. Create idea
router.post('/projects/:id/ideas', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);
  const { title, note, parent_idea_id, related_idea_ids } = req.body || {};

  if (!title || !String(title).trim()) {
    res.status(400).json({ error: '아이디어 제목을 입력해주세요.' });
    return;
  }

  const nowJst = getJstDateTimeStr();

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (!canAccessJournalProject(existing, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    let validParentId: number | null = null;
    if (parent_idea_id !== undefined && parent_idea_id !== null && String(parent_idea_id).trim() !== '') {
      const candidateParent = Number(parent_idea_id);
      const parentRow = db
        .prepare('SELECT id FROM journal_ideas WHERE id = ? AND project_id = ?')
        .get(candidateParent, projectId) as { id: number } | undefined;
      if (!parentRow) {
        res.status(400).json({ error: '상위 아이디어를 찾을 수 없습니다.' });
        return;
      }
      validParentId = Number(parentRow.id);
    }

    const validRelatedIds = filterValidProjectIdeaIds(projectId, parseRelatedIdeaIds(related_idea_ids));

    const tx = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO journal_ideas (project_id, parent_idea_id, related_idea_ids, title, note, status, author_id)
        VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
      `).run(
        projectId,
        validParentId,
        JSON.stringify(validRelatedIds),
        String(title).trim(),
        note ? String(note).trim() : null,
        userId
      );

      const newIdeaId = Number(info.lastInsertRowid);
      for (const targetId of validRelatedIds) {
        const targetRow = db
          .prepare('SELECT related_idea_ids FROM journal_ideas WHERE id = ? AND project_id = ?')
          .get(targetId, projectId) as { related_idea_ids?: string } | undefined;
        if (targetRow) {
          const merged = Array.from(new Set([...parseRelatedIdeaIds(targetRow.related_idea_ids), newIdeaId]));
          db.prepare('UPDATE journal_ideas SET related_idea_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            JSON.stringify(merged),
            targetId
          );
        }
      }

      db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nowJst, projectId);
      return newIdeaId;
    });

    const ideaId = tx();
    const created = db.prepare(`
      SELECT i.*, u.name as author_name
      FROM journal_ideas i
      LEFT JOIN users u ON i.author_id = u.id
      WHERE i.id = ?
    `).get(ideaId);

    notifyProjectPeers(
      { id: projectId, title: existing.title, mode: existing.mode, created_by: Number(existing.created_by) },
      userId,
      `💡 ${req.user!.name} — ${String(title).trim().slice(0, 60)}`,
      `idea-${ideaId}`
    );

    res.status(201).json(formatIdeaRow(created));
  } catch (err: any) {
    res.status(500).json({ error: '아이디어 등록 실패: ' + err.message });
  }
});

// 9. Update / link / promote idea
router.patch('/ideas/:ideaId', authenticateToken, (req: Request, res: Response) => {
  const ideaId = Number(req.params.ideaId);
  const userId = Number(req.user!.id);
  const { status, title, note, promoteToNextStep, parent_idea_id, related_idea_ids, toggle_related_idea_id } = req.body || {};
  const nowJst = getJstDateTimeStr();
  const todayJst = getJstDateStr();
  const timeJst = getJstTimeStr();

  try {
    const existing = db.prepare(`
      SELECT i.*, p.mode, p.title as project_title, p.created_by as project_owner_id
      FROM journal_ideas i
      INNER JOIN journal_projects p ON p.id = i.project_id
      WHERE i.id = ?
    `).get(ideaId) as any;

    if (!existing) {
      res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
      return;
    }
    if (!canAccessJournalProject({ id: existing.project_id, mode: existing.mode, created_by: existing.project_owner_id }, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    const projectId = Number(existing.project_id);
    const nextTitle = title !== undefined && String(title).trim() ? String(title).trim() : existing.title;
    const nextNote = note !== undefined ? (note ? String(note).trim() : null) : existing.note;
    const nextStatus = promoteToNextStep
      ? 'PROMOTED'
      : status !== undefined && VALID_IDEA_STATUSES.has(status)
      ? status
      : existing.status;

    let nextParentId: number | null = existing.parent_idea_id ? Number(existing.parent_idea_id) : null;
    if (parent_idea_id !== undefined) {
      if (parent_idea_id === null || String(parent_idea_id).trim() === '') {
        nextParentId = null;
      } else {
        const candidate = Number(parent_idea_id);
        const parentRow = db
          .prepare('SELECT id FROM journal_ideas WHERE id = ? AND project_id = ?')
          .get(candidate, projectId) as { id: number } | undefined;
        if (!parentRow) {
          res.status(400).json({ error: '상위 아이디어를 찾을 수 없습니다.' });
          return;
        }
        if (wouldCreateIdeaCycle(projectId, ideaId, candidate)) {
          res.status(400).json({ error: '하위 아이디어를 상위 노드로 순환 지정할 수 없습니다.' });
          return;
        }
        nextParentId = candidate;
      }
    }

    let nextRelatedIds: number[] = parseRelatedIdeaIds(existing.related_idea_ids);
    let toggleTargetId: number | null = null;
    if (toggle_related_idea_id !== undefined && toggle_related_idea_id !== null) {
      const targetId = Number(toggle_related_idea_id);
      if (targetId === ideaId) {
        res.status(400).json({ error: '같은 아이디어끼리는 연결할 수 없습니다.' });
        return;
      }
      const targetRow = db
        .prepare('SELECT id, related_idea_ids FROM journal_ideas WHERE id = ? AND project_id = ?')
        .get(targetId, projectId) as { id: number; related_idea_ids?: string } | undefined;
      if (!targetRow) {
        res.status(400).json({ error: '연결 대상 아이디어를 찾을 수 없습니다.' });
        return;
      }
      toggleTargetId = targetId;
      if (nextRelatedIds.includes(targetId)) {
        nextRelatedIds = nextRelatedIds.filter((id) => id !== targetId);
      } else {
        nextRelatedIds = [...nextRelatedIds, targetId];
      }
    } else if (related_idea_ids !== undefined) {
      nextRelatedIds = filterValidProjectIdeaIds(projectId, parseRelatedIdeaIds(related_idea_ids), ideaId);
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE journal_ideas
        SET title = ?, note = ?, status = ?, parent_idea_id = ?, related_idea_ids = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextTitle, nextNote, nextStatus, nextParentId, JSON.stringify(nextRelatedIds), ideaId);

      if (toggleTargetId !== null) {
        const targetRow = db
          .prepare('SELECT related_idea_ids FROM journal_ideas WHERE id = ?')
          .get(toggleTargetId) as { related_idea_ids?: string } | undefined;
        if (targetRow) {
          const targetRelated = parseRelatedIdeaIds(targetRow.related_idea_ids);
          const shouldLink = nextRelatedIds.includes(toggleTargetId);
          const updatedTargetRelated = shouldLink
            ? Array.from(new Set([...targetRelated, ideaId]))
            : targetRelated.filter((id) => id !== ideaId);
          db.prepare('UPDATE journal_ideas SET related_idea_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            JSON.stringify(updatedTargetRelated),
            toggleTargetId
          );
        }
      }

      if (promoteToNextStep) {
        db.prepare(`
          UPDATE journal_projects
          SET next_action = ?, turn_state = CASE WHEN turn_state = 'DONE' THEN 'MY_TURN' ELSE turn_state END,
              last_activity_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(nextTitle, nowJst, projectId);

        db.prepare(`
          INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
          VALUES (?, 'INTENT', ?, ?, ?, ?)
        `).run(projectId, `💡 → Next Step: ${nextTitle}`, todayJst, timeJst, userId);
      } else {
        db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nowJst, projectId);
      }
    })();

    const updated = db.prepare(`
      SELECT i.*, u.name as author_name
      FROM journal_ideas i
      LEFT JOIN users u ON i.author_id = u.id
      WHERE i.id = ?
    `).get(ideaId);

    const prevParent = existing.parent_idea_id ? Number(existing.parent_idea_id) : null;
    const prevRelatedStr = JSON.stringify(parseRelatedIdeaIds(existing.related_idea_ids));
    const hasIdeaChange =
      Boolean(promoteToNextStep) ||
      nextTitle !== existing.title ||
      nextNote !== existing.note ||
      nextStatus !== existing.status ||
      nextParentId !== prevParent ||
      JSON.stringify(nextRelatedIds) !== prevRelatedStr;

    if (hasIdeaChange) {
      const ideaBody = promoteToNextStep
        ? `🚀 ${req.user!.name}님이 아이디어 '${nextTitle}'을(를) 다음 할 일로 승격했습니다.`
        : `💡 ${req.user!.name}님이 아이디어 '${nextTitle}'을(를) 수정했습니다.`;
      notifyProjectPeers(
        {
          id: projectId,
          title: existing.project_title,
          mode: existing.mode,
          created_by: Number(existing.project_owner_id),
        },
        userId,
        ideaBody,
        `idea-upd-${ideaId}`
      );
    }

    res.json(formatIdeaRow(updated));
  } catch (err: any) {
    res.status(500).json({ error: '아이디어 수정 실패: ' + err.message });
  }
});

// 10. Delete idea
router.delete('/ideas/:ideaId', authenticateToken, (req: Request, res: Response) => {
  const ideaId = Number(req.params.ideaId);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare(`
      SELECT i.*, p.created_by as project_owner_id, p.title as project_title, p.mode as project_mode
      FROM journal_ideas i
      INNER JOIN journal_projects p ON p.id = i.project_id
      WHERE i.id = ?
    `).get(ideaId) as any;

    if (!existing) {
      res.status(404).json({ error: '아이디어를 찾을 수 없습니다.' });
      return;
    }
    if (Number(existing.author_id) !== userId && Number(existing.project_owner_id) !== userId) {
      res.status(403).json({ error: '삭제 권한이 없습니다.' });
      return;
    }

    const projectId = Number(existing.project_id);
    db.transaction(() => {
      db.prepare('DELETE FROM journal_ideas WHERE id = ?').run(ideaId);
      const remaining = db
        .prepare('SELECT id, related_idea_ids FROM journal_ideas WHERE project_id = ?')
        .all(projectId) as Array<{ id: number; related_idea_ids?: string }>;
      const remainingIds = new Set(remaining.map((r) => Number(r.id)));
      for (const row of remaining) {
        const parsed = parseRelatedIdeaIds(row.related_idea_ids);
        const filtered = parsed.filter((id) => remainingIds.has(id) && id !== Number(row.id));
        if (filtered.length !== parsed.length) {
          db.prepare('UPDATE journal_ideas SET related_idea_ids = ? WHERE id = ?').run(
            JSON.stringify(filtered),
            row.id
          );
        }
      }
    })();

    notifyProjectPeers(
      {
        id: projectId,
        title: existing.project_title,
        mode: existing.project_mode,
        created_by: Number(existing.project_owner_id),
      },
      userId,
      `🗑️ ${req.user!.name}님이 아이디어 '${existing.title}'을(를) 삭제했습니다.`,
      `idea-del-${ideaId}`
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '아이디어 삭제 실패: ' + err.message });
  }
});

// 11. Quick Inbox
router.post('/inbox', authenticateToken, (req: Request, res: Response) => {
  const userId = Number(req.user!.id);
  const { content } = req.body || {};
  if (!content || !String(content).trim()) {
    res.status(400).json({ error: '내용을 입력해주세요.' });
    return;
  }

  try {
    const info = db.prepare(`
      INSERT INTO journal_inbox (content, author_id)
      VALUES (?, ?)
    `).run(String(content).trim(), userId);

    const created = db.prepare('SELECT * FROM journal_inbox WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ error: '인박스 저장 실패: ' + err.message });
  }
});

router.post('/inbox/:id/assign', authenticateToken, (req: Request, res: Response) => {
  const inboxId = Number(req.params.id);
  const userId = Number(req.user!.id);
  const { project_id, target_kind = 'INTENT' } = req.body || {};

  if (!project_id) {
    res.status(400).json({ error: '배치할 프로젝트를 선택해주세요.' });
    return;
  }

  try {
    const inboxItem = db.prepare('SELECT * FROM journal_inbox WHERE id = ? AND author_id = ?').get(inboxId, userId) as any;
    if (!inboxItem) {
      res.status(404).json({ error: '인박스 항목을 찾을 수 없습니다.' });
      return;
    }

    const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(Number(project_id)) as any;
    if (!project || !canAccessJournalProject(project, userId)) {
      res.status(403).json({ error: '선택한 프로젝트에 접근할 수 없습니다.' });
      return;
    }

    const nowJst = getJstDateTimeStr();
    const todayJst = getJstDateStr();
    const timeJst = getJstTimeStr();

    db.transaction(() => {
      if (target_kind === 'IDEA') {
        db.prepare(`
          INSERT INTO journal_ideas (project_id, title, note, status, author_id)
          VALUES (?, ?, NULL, 'OPEN', ?)
        `).run(project.id, inboxItem.content, userId);
      } else {
        const entryType = VALID_ENTRY_TYPES.has(target_kind) ? target_kind : 'INTENT';
        db.prepare(`
          INSERT INTO journal_entries (project_id, entry_type, content, entry_date, entry_time, author_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(project.id, entryType, inboxItem.content, todayJst, timeJst, userId);
      }

      db.prepare(`
        UPDATE journal_inbox SET linked_project_id = ?, is_processed = 1 WHERE id = ?
      `).run(project.id, inboxId);

      db.prepare(`
        UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(nowJst, project.id);
    })();

    notifyProjectPeers(
      {
        id: Number(project.id),
        title: project.title,
        mode: project.mode,
        created_by: Number(project.created_by),
      },
      userId,
      target_kind === 'IDEA'
        ? `💡 ${req.user!.name} — ${String(inboxItem.content).trim().slice(0, 60)}`
        : `${req.user!.name}: ${String(inboxItem.content).trim().slice(0, 60)}`,
      `inbox-${inboxId}`
    );

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '인박스 분류 실패: ' + err.message });
  }
});

router.delete('/inbox/:id', authenticateToken, (req: Request, res: Response) => {
  const inboxId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const info = db.prepare('DELETE FROM journal_inbox WHERE id = ? AND author_id = ?').run(inboxId, userId);
    if (info.changes === 0) {
      res.status(404).json({ error: '인박스 항목을 찾을 수 없습니다.' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '인박스 삭제 실패: ' + err.message });
  }
});

// 14. Free Mind Map Layout Persistence
router.put('/projects/:id/mindmap-layout', authenticateToken, (req: Request, res: Response) => {
  const projectId = Number(req.params.id);
  const userId = Number(req.user!.id);

  try {
    const existing = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!existing) {
      res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
      return;
    }
    if (!canAccessJournalProject(existing, userId)) {
      res.status(403).json({ error: '접근 권한이 없습니다.' });
      return;
    }

    const prevLayout = db
      .prepare('SELECT edges_json, parent_overrides_json FROM journal_mindmap_layouts WHERE project_id = ?')
      .get(projectId) as { edges_json?: string; parent_overrides_json?: string } | undefined;

    let prevEdgesNormalized = '[]';
    let prevParentsNormalized = '{}';
    if (prevLayout) {
      try {
        prevEdgesNormalized = JSON.stringify(
          sanitizeMindMapEdges(prevLayout.edges_json ? JSON.parse(prevLayout.edges_json) : [])
        );
      } catch {}
      try {
        prevParentsNormalized = JSON.stringify(
          sanitizeParentOverrides(prevLayout.parent_overrides_json ? JSON.parse(prevLayout.parent_overrides_json) : {})
        );
      } catch {}
    }

    const body = req.body || {};
    const sanitizedPositions = sanitizeMindMapPositions(body.positions);
    const sanitizedEdges = sanitizeMindMapEdges(body.custom_edges);
    const sanitizedParents = sanitizeParentOverrides(body.parent_overrides);

    const edgesJson = JSON.stringify(sanitizedEdges);
    const parentsJson = JSON.stringify(sanitizedParents);

    db.prepare(`
      INSERT INTO journal_mindmap_layouts (project_id, positions_json, edges_json, parent_overrides_json, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(project_id) DO UPDATE SET
        positions_json = excluded.positions_json,
        edges_json = excluded.edges_json,
        parent_overrides_json = excluded.parent_overrides_json,
        updated_by = excluded.updated_by,
        updated_at = CURRENT_TIMESTAMP
    `).run(projectId, JSON.stringify(sanitizedPositions), edgesJson, parentsJson, userId);

    // Ignore position-only node drags; notify peers only when structural edges or hierarchy changed
    if (edgesJson !== prevEdgesNormalized || parentsJson !== prevParentsNormalized) {
      notifyProjectPeers(
        { id: projectId, title: existing.title, mode: existing.mode, created_by: Number(existing.created_by) },
        userId,
        `🕸️ ${req.user!.name}님이 자유 마인드맵 연결 구조를 수정했습니다.`,
        'mindmap-structure'
      );
    }

    res.json({
      positions: sanitizedPositions,
      custom_edges: sanitizedEdges,
      parent_overrides: sanitizedParents,
    });
  } catch (err: any) {
    res.status(500).json({ error: '마인드맵 레이아웃 저장 실패: ' + err.message });
  }
});

export default router;
