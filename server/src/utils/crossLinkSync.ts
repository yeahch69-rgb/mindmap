import { db } from '../db/database.js';
import { getJstDateTimeStr } from './jstTime.js';
import { broadcastSpaceUpdate } from './spaceRealtime.js';

export type CrossEntityType = 'THOUGHT' | 'EVENT' | 'PROJECT' | 'IDEA' | 'ENTRY';

export interface CrossLinkBadge {
  entity_type: CrossEntityType;
  entity_id: number;
  title: string;
  preview: string;
  space_id?: number;
  space_name?: string;
  project_id?: number;
  project_title?: string;
  start_date?: string;
  event_status?: string;
}

function canonicalOrder(
  aType: CrossEntityType,
  aId: number,
  bType: CrossEntityType,
  bId: number
): [CrossEntityType, number, CrossEntityType, number] {
  const keyA = `${aType}:${aId}`;
  const keyB = `${bType}:${bId}`;
  return keyA <= keyB ? [aType, aId, bType, bId] : [bType, bId, aType, aId];
}

export function createCrossLink(
  aType: CrossEntityType,
  aId: number,
  bType: CrossEntityType,
  bId: number,
  opts: { spaceId?: number | null; projectId?: number | null; createdBy?: number | null } = {}
) {
  if (aType === bType && aId === bId) return;
  const [sType, sId, tType, tId] = canonicalOrder(aType, aId, bType, bId);
  db.prepare(`
    INSERT OR IGNORE INTO cross_entity_links (source_type, source_id, target_type, target_id, space_id, project_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sType, sId, tType, tId, opts.spaceId ?? null, opts.projectId ?? null, opts.createdBy ?? null);
}

export function removeLinksForEntity(entityType: CrossEntityType, entityId: number) {
  db.prepare(`
    DELETE FROM cross_entity_links
    WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
  `).run(entityType, entityId, entityType, entityId);
}

/** BFS across cross_entity_links + calendar_events.linked_thought_id to find all connected nodes. */
export function getConnectedCluster(
  originType: CrossEntityType,
  originId: number
): Array<{ type: CrossEntityType; id: number }> {
  const visited = new Set<string>([`${originType}:${originId}`]);
  const queue: Array<{ type: CrossEntityType; id: number }> = [{ type: originType, id: originId }];
  const others: Array<{ type: CrossEntityType; id: number }> = [];

  const enqueue = (type: CrossEntityType, id: number) => {
    if (!Number.isInteger(id) || id <= 0) return;
    const key = `${type}:${id}`;
    if (visited.has(key)) return;
    visited.add(key);
    const node = { type, id };
    queue.push(node);
    others.push(node);
  };

  while (queue.length > 0) {
    const cur = queue.shift()!;

    const rows = db
      .prepare(`
        SELECT source_type, source_id, target_type, target_id
        FROM cross_entity_links
        WHERE (source_type = ? AND source_id = ?) OR (target_type = ? AND target_id = ?)
      `)
      .all(cur.type, cur.id, cur.type, cur.id) as Array<{
      source_type: CrossEntityType;
      source_id: number;
      target_type: CrossEntityType;
      target_id: number;
    }>;

    for (const r of rows) {
      if (r.source_type === cur.type && Number(r.source_id) === cur.id) {
        enqueue(r.target_type, Number(r.target_id));
      } else {
        enqueue(r.source_type, Number(r.source_id));
      }
    }

    // Also traverse direct Thought <-> Event FK so 3-way sync spans Mindmap <-> Thought <-> Event seamlessly
    if (cur.type === 'THOUGHT') {
      const evs = db
        .prepare("SELECT id FROM calendar_events WHERE linked_thought_id = ? AND event_status != 'CANCELLED'")
        .all(cur.id) as Array<{ id: number }>;
      for (const e of evs) enqueue('EVENT', Number(e.id));
    } else if (cur.type === 'EVENT') {
      const ev = db.prepare('SELECT linked_thought_id FROM calendar_events WHERE id = ?').get(cur.id) as
        | { linked_thought_id: number | null }
        | undefined;
      if (ev?.linked_thought_id) enqueue('THOUGHT', Number(ev.linked_thought_id));
    }
  }

  return others;
}

/** Real-time two-way content sync across every connected Mindmap/Thought/Calendar entity. */
export function syncContentAcrossLinkedEntities(
  originType: CrossEntityType,
  originId: number,
  changes: { title?: string; content?: string },
  actorId: number
): number[] {
  const connected = getConnectedCluster(originType, originId);
  if (connected.length === 0) return [];

  const cleanTitle = changes.title !== undefined ? String(changes.title).trim() : undefined;
  const cleanContent = changes.content !== undefined ? String(changes.content).trim() : undefined;
  if (cleanTitle === undefined && cleanContent === undefined) return [];

  const affectedSpaceIds = new Set<number>();
  const nowJst = getJstDateTimeStr();

  const tx = db.transaction(() => {
    for (const node of connected) {
      if (node.type === 'THOUGHT') {
        const row = db
          .prepare('SELECT id, space_id, title, content FROM shared_thoughts WHERE id = ?')
          .get(node.id) as any;
        if (!row) continue;
        const nextTitle = cleanTitle !== undefined ? cleanTitle : row.title;
        const nextContent = cleanContent !== undefined && cleanContent !== '' ? cleanContent : row.content;
        if (nextTitle !== row.title || nextContent !== row.content) {
          db.prepare(`
            UPDATE shared_thoughts
            SET title = ?, content = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(nextTitle, nextContent, actorId, node.id);
          affectedSpaceIds.add(Number(row.space_id));
        }
      } else if (node.type === 'EVENT') {
        const row = db
          .prepare('SELECT id, space_id, title, description FROM calendar_events WHERE id = ?')
          .get(node.id) as any;
        if (!row) continue;
        const nextTitle = cleanTitle && cleanTitle.length > 0 ? cleanTitle : row.title;
        const nextDesc = cleanContent !== undefined ? cleanContent : row.description;
        if (nextTitle !== row.title || nextDesc !== row.description) {
          db.prepare(`
            UPDATE calendar_events
            SET title = ?, description = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(nextTitle, nextDesc, actorId, node.id);
          affectedSpaceIds.add(Number(row.space_id));
        }
      } else if (node.type === 'PROJECT') {
        const row = db
          .prepare('SELECT id, title, intent_summary FROM journal_projects WHERE id = ?')
          .get(node.id) as any;
        if (!row) continue;
        const nextTitle = cleanTitle && cleanTitle.length > 0 ? cleanTitle : row.title;
        const nextIntent = cleanContent !== undefined ? cleanContent : row.intent_summary;
        if (nextTitle !== row.title || nextIntent !== row.intent_summary) {
          db.prepare(`
            UPDATE journal_projects
            SET title = ?, intent_summary = ?, last_activity_at = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(nextTitle, nextIntent, nowJst, node.id);
        }
      } else if (node.type === 'IDEA') {
        const row = db
          .prepare('SELECT id, project_id, title, note FROM journal_ideas WHERE id = ?')
          .get(node.id) as any;
        if (!row) continue;
        const nextTitle =
          cleanTitle && cleanTitle.length > 0
            ? cleanTitle
            : cleanContent && !row.title
              ? cleanContent.slice(0, 60)
              : row.title;
        const nextNote = cleanContent !== undefined ? cleanContent : row.note;
        if (nextTitle !== row.title || nextNote !== row.note) {
          db.prepare(`
            UPDATE journal_ideas
            SET title = ?, note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(nextTitle, nextNote, node.id);
          db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            nowJst,
            Number(row.project_id)
          );
        }
      } else if (node.type === 'ENTRY') {
        const row = db
          .prepare('SELECT id, project_id, content FROM journal_entries WHERE id = ?')
          .get(node.id) as any;
        if (!row) continue;
        const nextContent =
          cleanContent && cleanContent.length > 0
            ? cleanContent
            : cleanTitle && cleanTitle.length > 0
              ? cleanTitle
              : row.content;
        if (nextContent !== row.content) {
          db.prepare('UPDATE journal_entries SET content = ? WHERE id = ?').run(nextContent, node.id);
          db.prepare('UPDATE journal_projects SET last_activity_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            nowJst,
            Number(row.project_id)
          );
        }
      }
    }
  });
  tx();

  const spaceIdList = Array.from(affectedSpaceIds);
  for (const sid of spaceIdList) {
    broadcastSpaceUpdate(sid, 'CROSS_SYNC_UPDATED', { originType, originId, actorId });
  }
  return spaceIdList;
}

/** Resolve rich clickable badges for all entities directly or transitively linked to (entityType, entityId). */
export function getHydratedCrossLinks(
  entityType: CrossEntityType,
  entityId: number,
  filterTypes?: CrossEntityType[]
): CrossLinkBadge[] {
  const connected = getConnectedCluster(entityType, entityId);
  const badges: CrossLinkBadge[] = [];

  for (const node of connected) {
    if (filterTypes && !filterTypes.includes(node.type)) continue;

    if (node.type === 'PROJECT') {
      const p = db.prepare('SELECT id, title, intent_summary FROM journal_projects WHERE id = ?').get(node.id) as any;
      if (!p) continue;
      badges.push({
        entity_type: 'PROJECT',
        entity_id: Number(p.id),
        project_id: Number(p.id),
        project_title: p.title,
        title: p.title,
        preview: p.intent_summary || '',
      });
    } else if (node.type === 'IDEA') {
      const idea = db
        .prepare(`
          SELECT i.id, i.project_id, i.title, i.note, p.title as project_title
          FROM journal_ideas i
          INNER JOIN journal_projects p ON p.id = i.project_id
          WHERE i.id = ?
        `)
        .get(node.id) as any;
      if (!idea) continue;
      badges.push({
        entity_type: 'IDEA',
        entity_id: Number(idea.id),
        project_id: Number(idea.project_id),
        project_title: idea.project_title,
        title: idea.title,
        preview: idea.note || '',
      });
    } else if (node.type === 'ENTRY') {
      const entry = db
        .prepare(`
          SELECT e.id, e.project_id, e.content, p.title as project_title
          FROM journal_entries e
          INNER JOIN journal_projects p ON p.id = e.project_id
          WHERE e.id = ?
        `)
        .get(node.id) as any;
      if (!entry) continue;
      badges.push({
        entity_type: 'ENTRY',
        entity_id: Number(entry.id),
        project_id: Number(entry.project_id),
        project_title: entry.project_title,
        title: String(entry.content || '').slice(0, 40),
        preview: entry.content || '',
      });
    } else if (node.type === 'THOUGHT') {
      const t = db
        .prepare(`
          SELECT t.id, t.space_id, t.title, t.content, s.name as space_name
          FROM shared_thoughts t
          INNER JOIN collab_spaces s ON s.id = t.space_id
          WHERE t.id = ?
        `)
        .get(node.id) as any;
      if (!t) continue;
      badges.push({
        entity_type: 'THOUGHT',
        entity_id: Number(t.id),
        space_id: Number(t.space_id),
        space_name: t.space_name,
        title: t.title || String(t.content || '').slice(0, 36),
        preview: t.content || '',
      });
    } else if (node.type === 'EVENT') {
      const ev = db
        .prepare(`
          SELECT e.id, e.space_id, e.title, e.description, e.start_date, e.event_status, s.name as space_name
          FROM calendar_events e
          INNER JOIN collab_spaces s ON s.id = e.space_id
          WHERE e.id = ? AND e.event_status != 'CANCELLED'
        `)
        .get(node.id) as any;
      if (!ev) continue;
      badges.push({
        entity_type: 'EVENT',
        entity_id: Number(ev.id),
        space_id: Number(ev.space_id),
        space_name: ev.space_name,
        title: ev.title,
        preview: ev.description || '',
        start_date: ev.start_date,
        event_status: ev.event_status,
      });
    }
  }

  return badges;
}
