import { db, DEFAULT_SPACE_LABELS, generateInviteToken } from '../db/database.js';
import { broadcastSpaceUpdate } from './spaceRealtime.js';
import { sendPushToUsers } from './webPush.js';

export type JoinRequestScope = 'PROJECT_ONLY' | 'SPACE_ONLY' | 'SPACE_AND_PROJECT';
export type JoinRequestApproverType = 'PROJECT_OWNER' | 'SPACE_OWNER';

export interface LinkedSpaceSummary {
  id: number;
  name: string;
  color: string;
  member_count: number;
  linked_project_count: number;
  owner_id: number | null;
  is_space_owner: boolean;
  can_delete_with_project: boolean;
}

export interface LinkedProjectSummary {
  id: number;
  title: string;
  color: string;
  mode: string;
  created_by: number;
  owner_name: string;
  is_member: boolean;
}

export interface LinkableSpaceOption {
  id: number;
  name: string;
  color: string;
  is_personal: boolean;
  is_owner: boolean;
  member_count: number;
  linked_project_count: number;
}

export interface LinkableSpaceMemberItem {
  user_id: number;
  name: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
  already_pending: boolean;
}

export interface CollabJoinRequestRow {
  id: number;
  project_id: number | null;
  project_title: string | null;
  space_id: number | null;
  space_name: string | null;
  target_user_id: number;
  target_user_name: string;
  target_user_email: string;
  invited_by_user_id: number | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  scope: JoinRequestScope;
  approver_type: JoinRequestApproverType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  can_resolve: boolean;
  created_at: string;
}

export interface MyPendingJoinRequestRow {
  id: number;
  project_id: number | null;
  project_title: string | null;
  space_id: number | null;
  space_name: string | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  scope: JoinRequestScope;
  approver_type: JoinRequestApproverType;
  created_at: string;
}

function formatNamePreview(names: string[]): { ko: string; ja: string; en: string } {
  const ko = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}명`;
  const ja = names.length <= 2 ? names.join('・') : `${names.slice(0, 2).join('・')} 他${names.length - 2}名`;
  const en = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  return { ko, ja, en };
}

export function getSpaceOwnerId(spaceId: number): number | null {
  const row = db
    .prepare("SELECT user_id FROM collab_space_members WHERE space_id = ? AND role = 'OWNER' ORDER BY id ASC LIMIT 1")
    .get(spaceId) as { user_id: number } | undefined;
  if (row?.user_id) return Number(row.user_id);
  const space = db.prepare('SELECT created_by FROM collab_spaces WHERE id = ?').get(spaceId) as
    | { created_by: number | null }
    | undefined;
  return space?.created_by ? Number(space.created_by) : null;
}

export function isSpaceOwner(spaceId: number, userId: number): boolean {
  const row = db
    .prepare("SELECT 1 FROM collab_space_members WHERE space_id = ? AND user_id = ? AND role = 'OWNER'")
    .get(spaceId, userId);
  return Boolean(row);
}

export function isSpaceMember(spaceId: number, userId: number): boolean {
  const row = db
    .prepare('SELECT 1 FROM collab_space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, userId);
  return Boolean(row);
}

export function getSpaceMemberIdSet(spaceId: number): Set<number> {
  const rows = db
    .prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?')
    .all(spaceId) as Array<{ user_id: number }>;
  return new Set(rows.map((r) => Number(r.user_id)).filter((id) => id > 0));
}

export function getLinkedProjectCountForSpace(spaceId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM journal_projects WHERE linked_space_id = ?')
    .get(spaceId) as { cnt: number } | undefined;
  return Number(row?.cnt || 0);
}

export function isProjectMemberOrOwner(projectId: number, projectOwnerId: number, userId: number): boolean {
  if (Number(projectOwnerId) === Number(userId)) return true;
  const row = db
    .prepare('SELECT 1 FROM journal_project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);
  return Boolean(row);
}

export function getLinkedSpaceForProject(
  projectId: number,
  viewerUserId?: number
): LinkedSpaceSummary | null {
  const row = db
    .prepare(`
      SELECT s.id, s.name, s.color, s.created_by,
        (SELECT COUNT(*) FROM collab_space_members m WHERE m.space_id = s.id) as member_count,
        (SELECT COUNT(*) FROM journal_projects jp2 WHERE jp2.linked_space_id = s.id) as linked_project_count,
        (SELECT m.user_id FROM collab_space_members m WHERE m.space_id = s.id AND m.role = 'OWNER' ORDER BY m.id ASC LIMIT 1) as owner_user_id
      FROM journal_projects p
      INNER JOIN collab_spaces s ON s.id = p.linked_space_id
      WHERE p.id = ?
      LIMIT 1
    `)
    .get(projectId) as
    | {
        id: number;
        name: string;
        color: string;
        created_by: number | null;
        member_count: number;
        linked_project_count: number;
        owner_user_id: number | null;
      }
    | undefined;
  if (!row) return null;
  const ownerId = row.owner_user_id ? Number(row.owner_user_id) : row.created_by ? Number(row.created_by) : null;
  const linkedProjectCount = Number(row.linked_project_count || 0);
  const viewerIsSpaceOwner = viewerUserId !== undefined ? isSpaceOwner(Number(row.id), viewerUserId) : false;
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color || '#1B4D3E',
    member_count: Number(row.member_count || 0),
    linked_project_count: linkedProjectCount,
    owner_id: ownerId,
    is_space_owner: viewerIsSpaceOwner,
    can_delete_with_project: linkedProjectCount === 1 && viewerIsSpaceOwner,
  };
}

export function getLinkedSpacesMapForProjects(
  projectIds: number[],
  viewerUserId?: number
): Map<number, LinkedSpaceSummary> {
  const map = new Map<number, LinkedSpaceSummary>();
  if (projectIds.length === 0) return map;
  const ph = projectIds.map(() => '?').join(',');
  const rows = db
    .prepare(`
      SELECT p.id as project_id, s.id, s.name, s.color, s.created_by,
        (SELECT COUNT(*) FROM collab_space_members m WHERE m.space_id = s.id) as member_count,
        (SELECT COUNT(*) FROM journal_projects jp2 WHERE jp2.linked_space_id = s.id) as linked_project_count,
        (SELECT m.user_id FROM collab_space_members m WHERE m.space_id = s.id AND m.role = 'OWNER' ORDER BY m.id ASC LIMIT 1) as owner_user_id
      FROM journal_projects p
      INNER JOIN collab_spaces s ON s.id = p.linked_space_id
      WHERE p.id IN (${ph})
    `)
    .all(...projectIds) as Array<{
    project_id: number;
    id: number;
    name: string;
    color: string;
    created_by: number | null;
    member_count: number;
    linked_project_count: number;
    owner_user_id: number | null;
  }>;

  const ownedSpaceIds = new Set<number>();
  if (viewerUserId !== undefined) {
    const ownedRows = db
      .prepare("SELECT space_id FROM collab_space_members WHERE user_id = ? AND role = 'OWNER'")
      .all(viewerUserId) as Array<{ space_id: number }>;
    for (const r of ownedRows) ownedSpaceIds.add(Number(r.space_id));
  }

  for (const r of rows) {
    const sid = Number(r.id);
    const ownerId = r.owner_user_id ? Number(r.owner_user_id) : r.created_by ? Number(r.created_by) : null;
    const linkedProjectCount = Number(r.linked_project_count || 0);
    const viewerIsSpaceOwner = viewerUserId !== undefined ? ownedSpaceIds.has(sid) : false;
    map.set(Number(r.project_id), {
      id: sid,
      name: r.name,
      color: r.color || '#1B4D3E',
      member_count: Number(r.member_count || 0),
      linked_project_count: linkedProjectCount,
      owner_id: ownerId,
      is_space_owner: viewerIsSpaceOwner,
      can_delete_with_project: linkedProjectCount === 1 && viewerIsSpaceOwner,
    });
  }
  return map;
}

export function getLinkedProjectsForSpace(
  spaceId: number,
  viewerUserId: number,
  viewerIsSpaceOwner: boolean
): {
  linked_projects: LinkedProjectSummary[];
  managed_linked_projects: LinkedProjectSummary[];
  total_count: number;
} {
  const rows = db
    .prepare(`
      SELECT p.id, p.title, p.color, p.mode, p.created_by,
             COALESCE(u.name, '') as owner_name,
             EXISTS (
               SELECT 1 FROM journal_project_members m
               WHERE m.project_id = p.id AND m.user_id = ?
             ) as is_proj_member
      FROM journal_projects p
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.linked_space_id = ?
      ORDER BY p.last_activity_at DESC, p.id DESC
    `)
    .all(viewerUserId, spaceId) as any[];

  const allSummaries: LinkedProjectSummary[] = rows.map((p) => ({
    id: Number(p.id),
    title: p.title,
    color: p.color || '#1B4D3E',
    mode: p.mode,
    created_by: Number(p.created_by),
    owner_name: p.owner_name || '',
    is_member: Number(p.created_by) === Number(viewerUserId) || Boolean(p.is_proj_member),
  }));

  const accessible = allSummaries.filter((p) => p.is_member);
  return {
    linked_projects: accessible,
    managed_linked_projects: viewerIsSpaceOwner ? allSummaries : accessible,
    total_count: allSummaries.length,
  };
}

export function getLinkableSpacesForUser(userId: number): LinkableSpaceOption[] {
  const rows = db
    .prepare(`
      SELECT s.id, s.name, s.color, s.is_personal, m.role,
        (SELECT COUNT(*) FROM collab_space_members m2 WHERE m2.space_id = s.id) as member_count,
        (SELECT COUNT(*) FROM journal_projects jp WHERE jp.linked_space_id = s.id) as linked_project_count
      FROM collab_spaces s
      INNER JOIN collab_space_members m ON m.space_id = s.id
      WHERE m.user_id = ?
      ORDER BY s.is_personal ASC, CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END, s.updated_at DESC, s.id DESC
    `)
    .all(userId) as any[];

  return rows.map((s) => ({
    id: Number(s.id),
    name: s.name,
    color: s.color || '#1B4D3E',
    is_personal: Boolean(s.is_personal),
    is_owner: s.role === 'OWNER',
    member_count: Number(s.member_count || 0),
    linked_project_count: Number(s.linked_project_count || 0),
  }));
}

export function getLinkableSpaceMembersForProject(projectId: number): {
  space: { id: number; name: string; color: string } | null;
  members: LinkableSpaceMemberItem[];
} {
  const project = db
    .prepare('SELECT id, created_by, linked_space_id FROM journal_projects WHERE id = ?')
    .get(projectId) as { id: number; created_by: number; linked_space_id: number | null } | undefined;
  if (!project || !project.linked_space_id) {
    return { space: null, members: [] };
  }

  const spaceId = Number(project.linked_space_id);
  const space = db.prepare('SELECT id, name, color FROM collab_spaces WHERE id = ?').get(spaceId) as
    | { id: number; name: string; color: string }
    | undefined;
  if (!space) return { space: null, members: [] };

  const projMembers = db
    .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
    .all(projectId) as Array<{ user_id: number }>;
  const projectUserIds = new Set<number>([
    Number(project.created_by),
    ...projMembers.map((m) => Number(m.user_id)),
  ]);

  const pendingRows = db
    .prepare("SELECT target_user_id FROM collab_join_requests WHERE project_id = ? AND status = 'PENDING'")
    .all(projectId) as Array<{ target_user_id: number }>;
  const pendingSet = new Set(pendingRows.map((r) => Number(r.target_user_id)));

  const spaceMembers = db
    .prepare(`
      SELECT m.user_id, m.role, u.name, u.email
      FROM collab_space_members m
      INNER JOIN users u ON u.id = m.user_id
      WHERE m.space_id = ?
      ORDER BY CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END, u.name ASC
    `)
    .all(spaceId) as Array<{ user_id: number; role: string; name: string; email: string }>;

  const members: LinkableSpaceMemberItem[] = spaceMembers
    .filter((m) => !projectUserIds.has(Number(m.user_id)))
    .map((m) => ({
      user_id: Number(m.user_id),
      name: m.name || '',
      email: m.email || '',
      role: m.role === 'OWNER' ? 'OWNER' : 'MEMBER',
      already_pending: pendingSet.has(Number(m.user_id)),
    }));

  return {
    space: { id: Number(space.id), name: space.name, color: space.color || '#1B4D3E' },
    members,
  };
}

export function createLinkedSpaceForProjectInTx(projectId: number): { spaceId: number; created: boolean } {
  const project = db
    .prepare('SELECT id, title, color, created_by, linked_space_id FROM journal_projects WHERE id = ?')
    .get(projectId) as
    | { id: number; title: string; color: string; created_by: number; linked_space_id: number | null }
    | undefined;
  if (!project) {
    throw new Error('프로젝트를 찾을 수 없습니다.');
  }
  if (project.linked_space_id) {
    return { spaceId: Number(project.linked_space_id), created: false };
  }

  const ownerId = Number(project.created_by);
  const projMembers = db
    .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
    .all(projectId) as Array<{ user_id: number }>;

  const res = db
    .prepare(`
      INSERT INTO collab_spaces (name, description, color, is_personal, invite_token, member_invite_token, labels_json, created_by)
      VALUES (?, '', ?, 0, ?, ?, ?, ?)
    `)
    .run(
      String(project.title || '').trim() || 'Shared Space',
      project.color || '#1B4D3E',
      generateInviteToken(),
      generateInviteToken(),
      JSON.stringify(DEFAULT_SPACE_LABELS),
      ownerId
    );
  const spaceId = Number(res.lastInsertRowid);

  db.prepare(`
    UPDATE journal_projects
    SET linked_space_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(spaceId, projectId);

  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
    VALUES (?, ?, ?, 0)
  `);
  insertMember.run(spaceId, ownerId, 'OWNER');
  for (const pm of projMembers) {
    const uid = Number(pm.user_id);
    if (uid > 0 && uid !== ownerId) {
      insertMember.run(spaceId, uid, 'MEMBER');
    }
  }

  db.prepare(`
    UPDATE collab_join_requests
    SET space_id = ?, scope = 'SPACE_AND_PROJECT', approver_type = 'SPACE_OWNER'
    WHERE project_id = ? AND status = 'PENDING' AND space_id IS NULL
  `).run(spaceId, projectId);

  return { spaceId, created: true };
}

export function linkExistingSpaceToProject(params: {
  projectId: number;
  spaceId: number;
  actorUserId: number;
  actorName: string;
}): {
  spaceId: number;
  addedToSpaceUsers: Array<{ id: number; name: string }>;
  pendingRequestsCreated: CollabJoinRequestRow[];
} {
  const { projectId, spaceId, actorUserId, actorName } = params;
  const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
  if (Number(project.created_by) !== actorUserId) {
    throw new Error('공유 스페이스 연동은 프로젝트 소유자만 할 수 있습니다.');
  }
  if (project.mode !== 'COLLAB') {
    throw new Error('협업 프로젝트에서만 공유 스페이스를 연동할 수 있습니다.');
  }
  if (project.linked_space_id) {
    throw new Error('이미 연동된 공유 스페이스가 있습니다.');
  }

  const space = db.prepare('SELECT * FROM collab_spaces WHERE id = ?').get(spaceId) as any;
  if (!space) throw new Error('공유 스페이스를 찾을 수 없습니다.');

  const membership = db
    .prepare('SELECT role FROM collab_space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, actorUserId) as { role: string } | undefined;
  if (!membership) {
    throw new Error('본인이 소속된 공유 스페이스에만 연결할 수 있습니다.');
  }

  const actorIsSpaceOwner = membership.role === 'OWNER';
  const spaceMemberIdsBefore = getSpaceMemberIdSet(spaceId);
  const projMemberRows = db
    .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
    .all(projectId) as Array<{ user_id: number }>;
  const outsiderIds = projMemberRows
    .map((r) => Number(r.user_id))
    .filter((uid) => uid > 0 && uid !== actorUserId && !spaceMemberIdsBefore.has(uid));

  const addedToSpaceUsers: Array<{ id: number; name: string }> = [];

  db.transaction(() => {
    db.prepare(`
      UPDATE journal_projects
      SET linked_space_id = ?,
          invite_token = COALESCE(invite_token, ?),
          member_invite_token = COALESCE(member_invite_token, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(spaceId, generateInviteToken(), generateInviteToken(), projectId);

    db.prepare(`
      UPDATE collab_spaces
      SET is_personal = 0,
          member_invite_token = COALESCE(member_invite_token, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(generateInviteToken(), spaceId);

    // Do NOT copy existing space members into the project (subset model: project ⊆ space).
    // Only handle existing project members who are NOT in the space yet:
    if (outsiderIds.length > 0 && actorIsSpaceOwner) {
      const insertSpaceMember = db.prepare(`
        INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
        VALUES (?, ?, 'MEMBER', 0)
      `);
      for (const uid of outsiderIds) {
        const uRow = db.prepare('SELECT id, name FROM users WHERE id = ?').get(uid) as
          | { id: number; name: string }
          | undefined;
        if (!uRow) continue;
        const info = insertSpaceMember.run(spaceId, uid);
        if (info.changes > 0) {
          addedToSpaceUsers.push({ id: uid, name: uRow.name });
        }
      }
      if (addedToSpaceUsers.length > 0) {
        const names = addedToSpaceUsers.map((u) => u.name);
        const preview = formatNamePreview(names);
        db.prepare(`
          INSERT INTO space_activities (space_id, actor_id, activity_type, target_type, target_id, summary, meta_json)
          VALUES (?, ?, 'MEMBER_JOINED', 'SPACE', ?, ?, ?)
        `).run(
          spaceId,
          actorUserId,
          spaceId,
          `${actorName}님이 ${preview.ko}님을 스페이스에 초대했습니다.`,
          JSON.stringify({ actorName, addedNames: names, source: 'PROJECT_LINK' })
        );
      }
    }

    // Re-evaluate existing pending project join requests
    const pendingProjectReqs = db
      .prepare("SELECT id, target_user_id FROM collab_join_requests WHERE project_id = ? AND status = 'PENDING'")
      .all(projectId) as Array<{ id: number; target_user_id: number }>;
    const updatedSpaceMemberIds = getSpaceMemberIdSet(spaceId);
    for (const pr of pendingProjectReqs) {
      const targetInSpace = updatedSpaceMemberIds.has(Number(pr.target_user_id));
      db.prepare(`
        UPDATE collab_join_requests
        SET space_id = ?,
            scope = ?,
            approver_type = ?
        WHERE id = ?
      `).run(
        spaceId,
        targetInSpace ? 'PROJECT_ONLY' : 'SPACE_AND_PROJECT',
        targetInSpace ? 'PROJECT_OWNER' : 'SPACE_OWNER',
        Number(pr.id)
      );
    }
  })();

  const pendingRequestsCreated: CollabJoinRequestRow[] = [];
  if (outsiderIds.length > 0 && !actorIsSpaceOwner) {
    for (const uid of outsiderIds) {
      const reqRes = createJoinRequest({
        projectId,
        spaceId,
        targetUserId: uid,
        invitedByUserId: actorUserId,
        invitedByName: actorName,
        source: 'PROJECT',
        scope: 'SPACE_AND_PROJECT',
        approverType: 'SPACE_OWNER',
        contextReason: 'LINK_EXISTING_PROJECT',
      });
      if (!reqRes.alreadyPending) {
        pendingRequestsCreated.push(reqRes.request);
      }
    }
  }

  if (addedToSpaceUsers.length > 0) {
    const spaceName = String(space.name || '');
    const projectTitle = String(project.title || '');
    void sendPushToUsers(
      addedToSpaceUsers.map((u) => u.id),
      {
        titleKo: `🔗 ${spaceName}`,
        bodyKo: `${actorName}님이 '${projectTitle}' 프로젝트를 '${spaceName}' 공유 스페이스에 연결하여 함께 참여되었습니다.`,
        titleJa: `🔗 ${spaceName}`,
        bodyJa: `${actorName}さんが「${projectTitle}」プロジェクトを共有スペース「${spaceName}」に連携し、スペースへ参加しました。`,
        titleEn: `🔗 ${spaceName}`,
        bodyEn: `${actorName} linked project '${projectTitle}' to Shared Space '${spaceName}' and added you to the space.`,
        url: `/?tab=calendar&space=${spaceId}`,
        tag: `space-link-add-${spaceId}-${projectId}`,
      }
    );
  }

  broadcastSpaceUpdate(spaceId, 'SPACE_UPDATED', { linkedProjectId: projectId, actorId: actorUserId });
  return { spaceId, addedToSpaceUsers, pendingRequestsCreated };
}

export function unlinkSpaceFromProject(params: {
  projectId: number;
  actorId: number;
  actorName: string;
  reason?: 'MANUAL' | 'MODE_SOLO' | 'PROJECT_DELETE' | 'SPACE_LEAVE';
  skipPush?: boolean;
}): { spaceId: number; spaceName: string } | null {
  const { projectId, actorId, actorName, reason = 'MANUAL', skipPush = false } = params;
  const project = db
    .prepare('SELECT id, title, created_by, linked_space_id FROM journal_projects WHERE id = ?')
    .get(projectId) as
    | { id: number; title: string; created_by: number; linked_space_id: number | null }
    | undefined;
  if (!project || !project.linked_space_id) return null;

  const spaceId = Number(project.linked_space_id);
  const space = db.prepare('SELECT id, name FROM collab_spaces WHERE id = ?').get(spaceId) as
    | { id: number; name: string }
    | undefined;
  const spaceName = space?.name || '';
  const projectOwnerId = Number(project.created_by);
  const spaceOwnerId = getSpaceOwnerId(spaceId);

  if (reason === 'MANUAL') {
    const canUnlink = projectOwnerId === actorId || isSpaceOwner(spaceId, actorId);
    if (!canUnlink) {
      throw new Error('연동 해제는 프로젝트 소유자 또는 공유 스페이스 방장만 할 수 있습니다.');
    }
  }

  const projMembers = (
    db.prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?').all(projectId) as Array<{
      user_id: number;
    }>
  ).map((m) => Number(m.user_id));

  db.transaction(() => {
    db.prepare(`
      UPDATE journal_projects
      SET linked_space_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(projectId);

    db.prepare(`
      DELETE FROM collab_join_requests
      WHERE project_id = ? AND space_id = ? AND status = 'PENDING' AND approver_type = 'SPACE_OWNER'
    `).run(projectId, spaceId);

    db.prepare(`
      UPDATE collab_join_requests
      SET space_id = NULL, scope = 'PROJECT_ONLY', approver_type = 'PROJECT_OWNER'
      WHERE project_id = ? AND space_id = ? AND status = 'PENDING'
    `).run(projectId, spaceId);
  })();

  broadcastSpaceUpdate(spaceId, 'SPACE_UPDATED', { unlinkedProjectId: projectId, actorId });

  if (reason === 'MANUAL' && !skipPush) {
    const recipientSet = new Set<number>([projectOwnerId, ...projMembers]);
    if (spaceOwnerId) recipientSet.add(spaceOwnerId);
    recipientSet.delete(actorId);
    const recipients = Array.from(recipientSet).filter((id) => id > 0);
    if (recipients.length > 0) {
      void sendPushToUsers(recipients, {
        titleKo: `🔓 연동 해제 · ${project.title}`,
        bodyKo: `${actorName}님이 '${project.title}' 프로젝트와 '${spaceName}' 공유 스페이스의 연동을 해제했습니다. 기존 데이터와 멤버는 모두 보존됩니다.`,
        titleJa: `🔓 連携解除 · ${project.title}`,
        bodyJa: `${actorName}さんが「${project.title}」プロジェクトと共有スペース「${spaceName}」の連携を解除しました。既存データとメンバーはすべて保持されます。`,
        titleEn: `🔓 Space Unlinked · ${project.title}`,
        bodyEn: `${actorName} unlinked project '${project.title}' from Shared Space '${spaceName}'. All existing data and members are preserved.`,
        url: `/?tab=mindmap&project=${projectId}`,
        projectId,
        tag: `collab-unlink-${projectId}-${spaceId}`,
      });
    }
  }

  return { spaceId, spaceName };
}

export function addUserToProject(params: {
  projectId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
  source: 'PROJECT' | 'SPACE';
  addToSpaceToo?: boolean;
  fromSpaceMember?: boolean;
  viaApproval?: boolean;
  viaLink?: boolean;
  skipPush?: boolean;
}): {
  joinedNewly: boolean;
  joinedSpaceToo: boolean;
  spaceId: number | null;
  autoCreatedSpace: boolean;
  projectTitle: string;
} {
  const {
    projectId,
    targetUserId,
    actorId,
    actorName,
    source,
    addToSpaceToo = false,
    fromSpaceMember = false,
    viaApproval = false,
    viaLink = false,
    skipPush = false,
  } = params;

  const result = db.transaction(() => {
    const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
    if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');

    const ownerId = Number(project.created_by);
    const targetUser = db
      .prepare('SELECT id, name, email FROM users WHERE id = ?')
      .get(targetUserId) as { id: number; name: string; email: string } | undefined;
    if (!targetUser) throw new Error('사용자를 찾을 수 없습니다.');

    const beforeProjMembers = (
      db.prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?').all(projectId) as Array<{
        user_id: number;
      }>
    ).map((m) => Number(m.user_id));

    const existingSpaceId = project.linked_space_id ? Number(project.linked_space_id) : null;
    const existingSpaceRow = existingSpaceId
      ? (db.prepare('SELECT id, name FROM collab_spaces WHERE id = ?').get(existingSpaceId) as
          | { id: number; name: string }
          | undefined)
      : undefined;

    const projInsert = db
      .prepare(`
        INSERT OR IGNORE INTO journal_project_members (project_id, user_id, role)
        VALUES (?, ?, 'MEMBER')
      `)
      .run(projectId, targetUserId);

    db.prepare(`
      UPDATE journal_projects
      SET mode = 'COLLAB',
          is_private = 0,
          partner_type = 'SHARED',
          invite_token = COALESCE(invite_token, ?),
          member_invite_token = COALESCE(member_invite_token, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(generateInviteToken(), generateInviteToken(), projectId);

    let spaceId: number | null = existingSpaceRow ? Number(existingSpaceRow.id) : null;
    let spaceName: string | null = existingSpaceRow?.name || null;
    let autoCreatedSpace = false;

    // Auto-create linked space when an unlinked EXTERNAL project gets its first real app account member
    if (!spaceId && project.partner_type === 'EXTERNAL' && beforeProjMembers.length === 0) {
      const created = createLinkedSpaceForProjectInTx(projectId);
      spaceId = created.spaceId;
      spaceName = String(project.title || '');
      autoCreatedSpace = created.created;
    }

    let spaceInserted = false;
    if (spaceId && (addToSpaceToo || autoCreatedSpace)) {
      const sInsert = db
        .prepare(`
          INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
          VALUES (?, ?, 'MEMBER', 0)
        `)
        .run(spaceId, targetUserId);
      spaceInserted = sInsert.changes > 0;
      db.prepare('UPDATE collab_spaces SET is_personal = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceId);

      if (spaceInserted) {
        db.prepare(`
          INSERT INTO space_activities (space_id, actor_id, activity_type, target_type, target_id, summary, meta_json)
          VALUES (?, ?, ?, 'SPACE', ?, ?, ?)
        `).run(
          spaceId,
          actorId,
          viaApproval ? 'MEMBER_JOIN_APPROVED' : 'MEMBER_JOINED',
          spaceId,
          viaApproval
            ? `${actorName}님이 ${targetUser.name}님의 참여 요청을 승인했습니다.`
            : viaLink
              ? `${targetUser.name}님이 초대 링크로 참여했습니다.`
              : `${actorName}님이 ${targetUser.name}님을 초대했습니다.`,
          JSON.stringify({ actorName, targetName: targetUser.name, source, viaApproval: Boolean(viaApproval) })
        );
      }
    }

    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE project_id = ? AND target_user_id = ? AND status = 'PENDING'
    `).run(actorId, projectId, targetUserId);

    const existingPeers = Array.from(new Set<number>([ownerId, ...beforeProjMembers])).filter(
      (id) => id > 0 && id !== actorId && id !== targetUserId
    );

    return {
      joinedProj: projInsert.changes > 0,
      joinedSpace: spaceInserted || autoCreatedSpace,
      joinedNewly: projInsert.changes > 0 || spaceInserted || autoCreatedSpace,
      spaceId,
      spaceName,
      autoCreatedSpace,
      projectTitle: String(project.title || ''),
      targetUserName: targetUser.name,
      existingPeers,
    };
  })();

  if (result.spaceId && result.joinedSpace) {
    broadcastSpaceUpdate(result.spaceId, 'MEMBER_JOINED', { actorId, targetUserId, projectId });
  }

  if (result.joinedNewly && !skipPush) {
    const joinedBoth = result.joinedProj && result.joinedSpace;
    const joinedSpaceOnly = !result.joinedProj && result.joinedSpace;
    const url = `/?tab=mindmap&project=${projectId}`;
    const targetName = result.targetUserName;

    if (joinedSpaceOnly && result.spaceId && result.spaceName) {
      if (targetUserId !== actorId) {
        void sendPushToUsers([targetUserId], {
          titleKo: `🤝 ${result.spaceName}`,
          bodyKo: `🎉 스페이스 방장 승인으로 '${result.spaceName}' 공유 스페이스에 합류되었습니다. ('${result.projectTitle}' 연동)`,
          titleJa: `🤝 ${result.spaceName}`,
          bodyJa: `🎉 スペースオーナー承認により、共有スペース「${result.spaceName}」に参加しました。（「${result.projectTitle}」連携）`,
          titleEn: `🤝 ${result.spaceName}`,
          bodyEn: `🎉 Space owner approved! You joined Shared Space '${result.spaceName}' (linked with '${result.projectTitle}').`,
          url: `/?tab=calendar&space=${result.spaceId}`,
          tag: `collab-space-approve-${result.spaceId}-${targetUserId}`,
        });
      }
    } else {
      const hasSpace = joinedBoth;
      if (targetUserId !== actorId) {
        let bodyKo = '';
        let bodyJa = '';
        let bodyEn = '';

        if (fromSpaceMember && !hasSpace) {
          bodyKo = `${actorName}님이 ${result.spaceName ? `'${result.spaceName}' ` : ''}공유 스페이스 멤버에서 '${result.projectTitle}' 프로젝트로 바로 추가했습니다.`;
          bodyJa = `${actorName}さんが${result.spaceName ? `「${result.spaceName}」` : ''}共有スペースメンバーから「${result.projectTitle}」プロジェクトへ追加しました。`;
          bodyEn = `${actorName} added you from ${result.spaceName ? `'${result.spaceName}' ` : ''}Shared Space to project '${result.projectTitle}'.`;
        } else if (viaApproval) {
          bodyKo = hasSpace
            ? `🎉 승인이 완료되어 '${result.projectTitle}' 프로젝트와 연동 공유 스페이스에 함께 합류되었습니다.`
            : `🎉 방장 승인으로 '${result.projectTitle}' 프로젝트에 합류되었습니다.`;
          bodyJa = hasSpace
            ? `🎉 承認により「${result.projectTitle}」プロジェクトと連携共有スペースに同時参加しました。`
            : `🎉 オーナー承認により「${result.projectTitle}」プロジェクトに参加しました。`;
          bodyEn = hasSpace
            ? `🎉 Approved! You have joined '${result.projectTitle}' and its linked Shared Space.`
            : `🎉 Approved by the owner! You have joined project '${result.projectTitle}'.`;
        } else {
          bodyKo = hasSpace
            ? `${actorName}님이 '${result.projectTitle}' 프로젝트와 연동 공유 스페이스(캘린더·메모장)에 초대했습니다.`
            : `${actorName}님이 '${result.projectTitle}' 협업 프로젝트에 초대했습니다.`;
          bodyJa = hasSpace
            ? `${actorName}さんが「${result.projectTitle}」プロジェクトと連携共有スペース（カレンダー・メモ帳）に招待しました。`
            : `${actorName}さんが「${result.projectTitle}」協業プロジェクトに招待しました。`;
          bodyEn = hasSpace
            ? `${actorName} invited you to '${result.projectTitle}' (Project & linked Shared Space).`
            : `${actorName} invited you to project '${result.projectTitle}'.`;
        }

        void sendPushToUsers([targetUserId], {
          titleKo: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyKo,
          titleJa: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyJa,
          titleEn: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyEn,
          url,
          projectId,
          tag: `collab-unified-join-${projectId}-${targetUserId}`,
        });
      }

      if (result.existingPeers.length > 0) {
        const scopeKo = hasSpace ? '프로젝트·공유 스페이스' : '프로젝트';
        const scopeJa = hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト';
        const scopeEn = hasSpace ? 'Project & Shared Space' : 'Project';

        void sendPushToUsers(result.existingPeers, {
          titleKo: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyKo: viaApproval
            ? `👋 ${targetName}님이 승인으로 '${result.projectTitle}'(${scopeKo})에 합류했습니다.`
            : viaLink
              ? `👋 ${targetName}님이 초대 링크로 '${result.projectTitle}'(${scopeKo})에 합류했습니다.`
              : `👋 ${actorName}님이 ${targetName}님을 '${result.projectTitle}'(${scopeKo})에 추가했습니다.`,
          titleJa: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyJa: viaApproval
            ? `👋 ${targetName}さんが承認により「${result.projectTitle}」（${scopeJa}）に参加しました。`
            : viaLink
              ? `👋 ${targetName}さんが招待リンクから「${result.projectTitle}」（${scopeJa}）に参加しました。`
              : `👋 ${actorName}さんが${targetName}さんを「${result.projectTitle}」（${scopeJa}）に追加しました。`,
          titleEn: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
          bodyEn: viaApproval
            ? `👋 ${targetName} joined '${result.projectTitle}' (${scopeEn}) after approval.`
            : viaLink
              ? `👋 ${targetName} joined '${result.projectTitle}' (${scopeEn}) via invite link.`
              : `👋 ${actorName} added ${targetName} to '${result.projectTitle}' (${scopeEn}).`,
          url,
          projectId,
          tag: `collab-unified-peer-${projectId}-${targetUserId}`,
        });
      }
    }
  }

  return {
    joinedNewly: result.joinedNewly,
    joinedSpaceToo: result.joinedSpace,
    spaceId: result.spaceId,
    autoCreatedSpace: result.autoCreatedSpace,
    projectTitle: result.projectTitle,
  };
}

export function addUserToSpaceOnly(params: {
  spaceId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
  viaApproval?: boolean;
  viaLink?: boolean;
  skipPush?: boolean;
}): { joinedNewly: boolean } {
  const { spaceId, targetUserId, actorId, actorName, viaApproval = false, viaLink = false, skipPush = false } = params;

  const space = db.prepare('SELECT id, name, is_personal FROM collab_spaces WHERE id = ?').get(spaceId) as
    | { id: number; name: string; is_personal: number }
    | undefined;
  if (!space) throw new Error('스페이스를 찾을 수 없습니다.');

  const targetUser = db.prepare('SELECT id, name FROM users WHERE id = ?').get(targetUserId) as
    | { id: number; name: string }
    | undefined;
  if (!targetUser) throw new Error('사용자를 찾을 수 없습니다.');

  const beforeMembers = Array.from(getSpaceMemberIdSet(spaceId));
  let inserted = false;

  db.transaction(() => {
    const info = db
      .prepare(`
        INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
        VALUES (?, ?, 'MEMBER', 0)
      `)
      .run(spaceId, targetUserId);
    inserted = info.changes > 0;

    if (inserted) {
      if (space.is_personal) {
        db.prepare('UPDATE collab_spaces SET is_personal = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceId);
      } else {
        db.prepare('UPDATE collab_spaces SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceId);
      }

      db.prepare(`
        INSERT INTO space_activities (space_id, actor_id, activity_type, target_type, target_id, summary, meta_json)
        VALUES (?, ?, ?, 'SPACE', ?, ?, ?)
      `).run(
        spaceId,
        actorId,
        viaApproval ? 'MEMBER_JOIN_APPROVED' : 'MEMBER_JOINED',
        spaceId,
        viaApproval
          ? `${actorName}님이 ${targetUser.name}님의 참여 요청을 승인했습니다.`
          : viaLink
            ? `${targetUser.name}님이 초대 링크로 스페이스에 참여했습니다.`
            : `${actorName}님이 ${targetUser.name}님을 스페이스에 초대했습니다.`,
        JSON.stringify({ actorName, targetName: targetUser.name, viaApproval: Boolean(viaApproval) })
      );
    }

    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE space_id = ? AND project_id IS NULL AND target_user_id = ? AND status = 'PENDING'
    `).run(actorId, spaceId, targetUserId);
  })();

  if (inserted) {
    broadcastSpaceUpdate(spaceId, 'MEMBER_JOINED', { actorId, targetUserId });

    if (!skipPush) {
      const spaceName = space.name || '공유 스페이스';
      const url = `/?tab=calendar&space=${spaceId}`;
      if (targetUserId !== actorId) {
        void sendPushToUsers([targetUserId], {
          titleKo: `📅 ${spaceName}`,
          bodyKo: viaApproval
            ? `🎉 스페이스 방장 승인으로 '${spaceName}' 공유 스페이스에 합류되었습니다.`
            : `${actorName}님이 '${spaceName}' 공유 스페이스(캘린더·메모장)에 초대했습니다.`,
          titleJa: `📅 ${spaceName}`,
          bodyJa: viaApproval
            ? `🎉 スペースオーナー承認により、共有スペース「${spaceName}」に参加しました。`
            : `${actorName}さんが共有スペース「${spaceName}」（カレンダー・メモ帳）に招待しました。`,
          titleEn: `📅 ${spaceName}`,
          bodyEn: viaApproval
            ? `🎉 Approved by the space owner! You have joined Shared Space '${spaceName}'.`
            : `${actorName} invited you to Shared Space '${spaceName}' (Calendar & Memo).`,
          url,
          tag: `space-invite-${spaceId}-${targetUserId}`,
        });
      }

      const peerIds = beforeMembers.filter((id) => id > 0 && id !== actorId && id !== targetUserId);
      if (peerIds.length > 0 && (viaApproval || viaLink)) {
        void sendPushToUsers(peerIds, {
          titleKo: `📅 ${spaceName}`,
          bodyKo: viaApproval
            ? `👋 ${targetUser.name}님이 스페이스 방장 승인으로 '${spaceName}'에 합류했습니다.`
            : `👋 ${targetUser.name}님이 초대 링크로 '${spaceName}'에 참여했습니다.`,
          titleJa: `📅 ${spaceName}`,
          bodyJa: viaApproval
            ? `👋 ${targetUser.name}さんがスペースオーナー承認により「${spaceName}」に参加しました。`
            : `👋 ${targetUser.name}さんが招待リンクから「${spaceName}」に参加しました。`,
          titleEn: `📅 ${spaceName}`,
          bodyEn: viaApproval
            ? `👋 ${targetUser.name} joined '${spaceName}' after space owner approval.`
            : `👋 ${targetUser.name} joined '${spaceName}' via invite link.`,
          url,
          tag: `space-join-peer-${spaceId}-${targetUserId}`,
        });
      }
    }
  }

  return { joinedNewly: inserted };
}

/**
 * Removes a user from a SINGLE project only (preserves Shared Space and other linked projects).
 */
export function removeUserFromProjectOnly(params: {
  projectId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
}): {
  removed: boolean;
} {
  const { projectId, targetUserId, actorId, actorName } = params;
  const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');

  const ownerId = Number(project.created_by);
  if (targetUserId === ownerId) {
    throw new Error('방장(소유자)은 나갈 수 없습니다. 프로젝트를 삭제해 주세요.');
  }

  const targetUser = db
    .prepare('SELECT id, name FROM users WHERE id = ?')
    .get(targetUserId) as { id: number; name: string } | undefined;

  const { removed, remainingPeers } = db.transaction(() => {
    const projDel = db
      .prepare('DELETE FROM journal_project_members WHERE project_id = ? AND user_id = ?')
      .run(projectId, targetUserId);

    if (Number(project.active_turn_user_id || 0) === targetUserId) {
      db.prepare('UPDATE journal_projects SET active_turn_user_id = ? WHERE id = ?').run(ownerId, projectId);
    }

    const remRows = db
      .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
      .all(projectId) as Array<{ user_id: number }>;
    const remPeers = Array.from(new Set<number>([ownerId, ...remRows.map((r) => Number(r.user_id))])).filter(
      (id) => id > 0 && id !== actorId && id !== targetUserId
    );

    return {
      removed: projDel.changes > 0,
      remainingPeers: remPeers,
    };
  })();

  if (removed) {
    const targetName = targetUser?.name || '멤버';
    const isSelf = targetUserId === actorId;
    const hasLinkedSpace = Boolean(project.linked_space_id);

    if (remainingPeers.length > 0) {
      void sendPushToUsers(remainingPeers, {
        titleKo: `📌 ${project.title}`,
        bodyKo: isSelf
          ? `👋 ${actorName}님이 '${project.title}' 프로젝트에서 나갔습니다.`
          : `👋 ${actorName}님이 ${targetName}님을 '${project.title}' 프로젝트에서 제외했습니다.`,
        titleJa: `📌 ${project.title}`,
        bodyJa: isSelf
          ? `👋 ${actorName}さんが「${project.title}」プロジェクトから退出しました。`
          : `👋 ${actorName}さんが${targetName}さんを「${project.title}」プロジェクトから除外しました。`,
        titleEn: `📌 ${project.title}`,
        bodyEn: isSelf
          ? `👋 ${actorName} left project '${project.title}'.`
          : `👋 ${actorName} removed ${targetName} from project '${project.title}'.`,
        url: `/?tab=mindmap&project=${projectId}`,
        projectId,
        tag: `collab-rm-${projectId}-${targetUserId}`,
      });
    }

    if (!isSelf) {
      void sendPushToUsers([targetUserId], {
        titleKo: `📌 ${project.title}`,
        bodyKo: hasLinkedSpace
          ? `👋 ${actorName}님이 '${project.title}' 프로젝트 멤버에서 제외했습니다. (공유 스페이스 소속은 유지됩니다)`
          : `👋 ${actorName}님이 '${project.title}' 프로젝트 멤버에서 제외했습니다.`,
        titleJa: `📌 ${project.title}`,
        bodyJa: hasLinkedSpace
          ? `👋 ${actorName}さんが「${project.title}」プロジェクトのメンバーから除外しました。（共有スペースの参加は維持されます）`
          : `👋 ${actorName}さんが「${project.title}」プロジェクトのメンバーから除外しました。`,
        titleEn: `📌 ${project.title}`,
        bodyEn: hasLinkedSpace
          ? `👋 ${actorName} removed you from project '${project.title}'. (Your Shared Space membership is preserved.)`
          : `👋 ${actorName} removed you from project '${project.title}'.`,
        url: '/',
        projectId,
        tag: `collab-kicked-${projectId}`,
      });
    }
  }

  return { removed };
}

/**
 * Removes a user from a Shared Space and cascades to all linked projects:
 * - Other-owned linked projects: removes the user from each project.
 * - Target-owned linked projects: preserves the project & members, automatically unlinks from this space.
 */
export function removeUserFromSpaceCascade(params: {
  spaceId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
}): {
  removed: boolean;
  removedProjectIds: number[];
  unlinkedOwnedProjects: Array<{ id: number; title: string }>;
} {
  const { spaceId, targetUserId, actorId, actorName } = params;
  const space = db.prepare('SELECT id, name FROM collab_spaces WHERE id = ?').get(spaceId) as
    | { id: number; name: string }
    | undefined;
  if (!space) throw new Error('스페이스를 찾을 수 없습니다.');

  const targetRow = db
    .prepare('SELECT role FROM collab_space_members WHERE space_id = ? AND user_id = ?')
    .get(spaceId, targetUserId) as { role: string } | undefined;
  if (!targetRow) throw new Error('해당 멤버를 찾을 수 없습니다.');
  if (targetRow.role === 'OWNER') {
    throw new Error('방장은 나갈 수 없습니다. 스페이스를 삭제해 주세요.');
  }

  const spaceOwnerId = getSpaceOwnerId(spaceId);
  const targetUser = db.prepare('SELECT id, name FROM users WHERE id = ?').get(targetUserId) as
    | { id: number; name: string }
    | undefined;
  const targetName = targetUser?.name || '멤버';

  const txResult = db.transaction(() => {
    const delInfo = db
      .prepare("DELETE FROM collab_space_members WHERE space_id = ? AND user_id = ? AND role != 'OWNER'")
      .run(spaceId, targetUserId);

    const linkedProjects = db
      .prepare('SELECT * FROM journal_projects WHERE linked_space_id = ?')
      .all(spaceId) as any[];

    const removedProjectIds: number[] = [];
    const unlinkedOwnedProjects: Array<{ id: number; title: string }> = [];

    for (const proj of linkedProjects) {
      const pid = Number(proj.id);
      if (Number(proj.created_by) === targetUserId) {
        db.prepare(`
          UPDATE journal_projects
          SET linked_space_id = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(pid);
        db.prepare(`
          DELETE FROM collab_join_requests
          WHERE project_id = ? AND space_id = ? AND status = 'PENDING' AND approver_type = 'SPACE_OWNER'
        `).run(pid, spaceId);
        db.prepare(`
          UPDATE collab_join_requests
          SET space_id = NULL, scope = 'PROJECT_ONLY', approver_type = 'PROJECT_OWNER'
          WHERE project_id = ? AND space_id = ? AND status = 'PENDING'
        `).run(pid, spaceId);
        unlinkedOwnedProjects.push({ id: pid, title: String(proj.title || '') });
      } else {
        const delProj = db
          .prepare('DELETE FROM journal_project_members WHERE project_id = ? AND user_id = ?')
          .run(pid, targetUserId);
        if (Number(proj.active_turn_user_id || 0) === targetUserId) {
          db.prepare('UPDATE journal_projects SET active_turn_user_id = ? WHERE id = ?').run(
            Number(proj.created_by),
            pid
          );
        }
        if (delProj.changes > 0) removedProjectIds.push(pid);
      }
    }

    db.prepare(`
      DELETE FROM collab_join_requests
      WHERE space_id = ? AND target_user_id = ? AND status = 'PENDING'
    `).run(spaceId, targetUserId);

    return {
      removed: delInfo.changes > 0,
      removedProjectIds,
      unlinkedOwnedProjects,
    };
  })();

  if (txResult.removed) {
    broadcastSpaceUpdate(spaceId, 'MEMBER_REMOVED', { actorId, targetUserId });
    const isSelf = targetUserId === actorId;
    const spaceName = space.name;

    if (txResult.unlinkedOwnedProjects.length > 0) {
      const titles = txResult.unlinkedOwnedProjects.map((p) => p.title);
      const preview = formatNamePreview(titles);

      if (!isSelf) {
        void sendPushToUsers([targetUserId], {
          titleKo: `🔓 소유 프로젝트 연동 자동 해제 · ${spaceName}`,
          bodyKo: `${actorName}님이 '${spaceName}' 공유 스페이스에서 제외함에 따라 본인 소유 프로젝트(${preview.ko})의 스페이스 연동이 자동 해제되었습니다. 프로젝트 데이터는 보존됩니다.`,
          titleJa: `🔓 所有プロジェクト連携の自動解除 · ${spaceName}`,
          bodyJa: `${actorName}さんにより共有スペース「${spaceName}」から除外されたため、所有プロジェクト（${preview.ja}）の連携が自動解除されました。データは保持されます。`,
          titleEn: `🔓 Owned Project Unlinked · ${spaceName}`,
          bodyEn: `You were removed from '${spaceName}' by ${actorName}. Your owned project(s) (${preview.en}) were automatically unlinked with all data preserved.`,
          url: '/?tab=mindmap',
          tag: `space-leave-unlink-${spaceId}-${targetUserId}`,
        });
      } else if (spaceOwnerId && spaceOwnerId !== actorId) {
        void sendPushToUsers([spaceOwnerId], {
          titleKo: `🔓 프로젝트 연동 자동 해제 · ${spaceName}`,
          bodyKo: `${targetName}님이 '${spaceName}' 스페이스에서 나가면서 본인 소유 프로젝트(${preview.ko})의 스페이스 연동이 자동 해제되었습니다.`,
          titleJa: `🔓 プロジェクト連携の自動解除 · ${spaceName}`,
          bodyJa: `${targetName}さんが「${spaceName}」スペースから退出したため、所有プロジェクト（${preview.ja}）の連携が自動解除されました。`,
          titleEn: `🔓 Project Auto-Unlinked · ${spaceName}`,
          bodyEn: `${targetName} left '${spaceName}', automatically unlinking their owned project(s) (${preview.en}).`,
          url: `/?tab=calendar&space=${spaceId}`,
          tag: `space-leave-unlink-owner-${spaceId}-${targetUserId}`,
        });
      }
    } else if (!isSelf) {
      const alsoRemovedProjects = txResult.removedProjectIds.length > 0;
      void sendPushToUsers([targetUserId], {
        titleKo: `📅 ${spaceName}`,
        bodyKo: alsoRemovedProjects
          ? `👋 ${actorName}님이 '${spaceName}' 공유 스페이스 및 연결된 프로젝트에서 제외했습니다.`
          : `👋 ${actorName}님이 '${spaceName}' 공유 스페이스에서 제외했습니다.`,
        titleJa: `📅 ${spaceName}`,
        bodyJa: alsoRemovedProjects
          ? `👋 ${actorName}さんが共有スペース「${spaceName}」および連携プロジェクトから除外しました。`
          : `👋 ${actorName}さんが共有スペース「${spaceName}」から除外しました。`,
        titleEn: `📅 ${spaceName}`,
        bodyEn: alsoRemovedProjects
          ? `👋 ${actorName} removed you from Shared Space '${spaceName}' and its linked project(s).`
          : `👋 ${actorName} removed you from Shared Space '${spaceName}'.`,
        url: '/',
        tag: `space-removed-${spaceId}-${targetUserId}`,
      });
    }
  }

  return txResult;
}

function hydrateJoinRequestRows(rows: any[], viewerUserId: number): CollabJoinRequestRow[] {
  return rows.map((r) => {
    const scope: JoinRequestScope =
      r.scope === 'SPACE_ONLY' || r.scope === 'SPACE_AND_PROJECT' ? r.scope : 'PROJECT_ONLY';
    const approverType: JoinRequestApproverType =
      r.approver_type === 'SPACE_OWNER' ? 'SPACE_OWNER' : 'PROJECT_OWNER';
    const spaceId = r.space_id ? Number(r.space_id) : null;
    const projectOwnerId = r.project_owner_id ? Number(r.project_owner_id) : null;

    let canResolve = false;
    if (approverType === 'SPACE_OWNER') {
      canResolve = spaceId !== null && isSpaceOwner(spaceId, viewerUserId);
    } else {
      canResolve = projectOwnerId !== null && projectOwnerId === viewerUserId;
    }

    return {
      id: Number(r.id),
      project_id: r.project_id ? Number(r.project_id) : null,
      project_title: r.project_title || null,
      space_id: spaceId,
      space_name: r.space_name || null,
      target_user_id: Number(r.target_user_id),
      target_user_name: r.target_user_name || '',
      target_user_email: r.target_user_email || '',
      invited_by_user_id: r.invited_by_user_id ? Number(r.invited_by_user_id) : null,
      invited_by_name: r.invited_by_name || '',
      source: r.source === 'SPACE' ? 'SPACE' : 'PROJECT',
      scope,
      approver_type: approverType,
      status: r.status,
      can_resolve: canResolve,
      created_at: r.created_at,
    };
  });
}

export function getPendingJoinRequestsForProject(
  projectId: number,
  viewerUserId = 0
): CollabJoinRequestRow[] {
  const rows = db
    .prepare(`
      SELECT r.id, r.project_id, r.space_id, r.target_user_id, r.invited_by_user_id,
             r.source, r.scope, r.approver_type, r.status, r.created_at,
             p.title as project_title, p.created_by as project_owner_id,
             s.name as space_name,
             tu.name as target_user_name,
             tu.email as target_user_email,
             COALESCE(iu.name, '') as invited_by_name
      FROM collab_join_requests r
      LEFT JOIN journal_projects p ON p.id = r.project_id
      LEFT JOIN collab_spaces s ON s.id = r.space_id
      INNER JOIN users tu ON tu.id = r.target_user_id
      LEFT JOIN users iu ON iu.id = r.invited_by_user_id
      WHERE r.project_id = ? AND r.status = 'PENDING'
      ORDER BY r.id ASC
    `)
    .all(projectId) as any[];
  return hydrateJoinRequestRows(rows, viewerUserId);
}

export function getPendingJoinRequestsForSpace(
  spaceId: number,
  viewerUserId: number,
  viewerIsSpaceOwner: boolean
): CollabJoinRequestRow[] {
  const rows = db
    .prepare(`
      SELECT r.id, r.project_id, r.space_id, r.target_user_id, r.invited_by_user_id,
             r.source, r.scope, r.approver_type, r.status, r.created_at,
             p.title as project_title, p.created_by as project_owner_id,
             s.name as space_name,
             tu.name as target_user_name,
             tu.email as target_user_email,
             COALESCE(iu.name, '') as invited_by_name
      FROM collab_join_requests r
      LEFT JOIN journal_projects p ON p.id = r.project_id
      LEFT JOIN collab_spaces s ON s.id = r.space_id
      INNER JOIN users tu ON tu.id = r.target_user_id
      LEFT JOIN users iu ON iu.id = r.invited_by_user_id
      WHERE r.space_id = ? AND r.status = 'PENDING' AND r.approver_type = 'SPACE_OWNER'
      ORDER BY r.id ASC
    `)
    .all(spaceId) as any[];

  const filtered = viewerIsSpaceOwner
    ? rows
    : rows.filter((r) => {
        if (!r.project_id) return true;
        if (Number(r.invited_by_user_id || 0) === viewerUserId) return true;
        return isProjectMemberOrOwner(Number(r.project_id), Number(r.project_owner_id || 0), viewerUserId);
      });

  return hydrateJoinRequestRows(filtered, viewerUserId);
}

export function getPendingJoinRequestCountsByProjects(projectIds: number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (projectIds.length === 0) return map;
  const ph = projectIds.map(() => '?').join(',');
  const rows = db
    .prepare(`
      SELECT project_id, COUNT(*) as cnt
      FROM collab_join_requests
      WHERE project_id IN (${ph}) AND status = 'PENDING'
      GROUP BY project_id
    `)
    .all(...projectIds) as Array<{ project_id: number; cnt: number }>;
  for (const r of rows) {
    map.set(Number(r.project_id), Number(r.cnt || 0));
  }
  return map;
}

export function getMyPendingJoinRequests(userId: number): MyPendingJoinRequestRow[] {
  const rows = db
    .prepare(`
      SELECT r.id, r.project_id, r.space_id, r.source, r.scope, r.approver_type, r.created_at,
             p.title as project_title,
             s.name as space_name,
             COALESCE(iu.name, '') as invited_by_name
      FROM collab_join_requests r
      LEFT JOIN journal_projects p ON p.id = r.project_id
      LEFT JOIN collab_spaces s ON s.id = r.space_id
      LEFT JOIN users iu ON iu.id = r.invited_by_user_id
      WHERE r.target_user_id = ? AND r.status = 'PENDING'
      ORDER BY r.id DESC
    `)
    .all(userId) as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    project_id: r.project_id ? Number(r.project_id) : null,
    project_title: r.project_title || null,
    space_id: r.space_id ? Number(r.space_id) : null,
    space_name: r.space_name || null,
    invited_by_name: r.invited_by_name || '',
    source: r.source === 'SPACE' ? 'SPACE' : 'PROJECT',
    scope:
      r.scope === 'SPACE_ONLY' || r.scope === 'SPACE_AND_PROJECT' ? r.scope : 'PROJECT_ONLY',
    approver_type: r.approver_type === 'SPACE_OWNER' ? 'SPACE_OWNER' : 'PROJECT_OWNER',
    created_at: r.created_at,
  }));
}

export function createJoinRequest(params: {
  projectId: number | null;
  spaceId: number | null;
  targetUserId: number;
  invitedByUserId: number | null;
  invitedByName: string;
  source: 'PROJECT' | 'SPACE';
  scope: JoinRequestScope;
  approverType: JoinRequestApproverType;
  contextReason?: 'INVITE' | 'LINK_EXISTING_PROJECT';
}): {
  alreadyPending: boolean;
  request: CollabJoinRequestRow;
} {
  const {
    projectId,
    spaceId: rawSpaceId,
    targetUserId,
    invitedByUserId,
    invitedByName,
    source,
    scope,
    approverType,
    contextReason = 'INVITE',
  } = params;

  const project = projectId
    ? (db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any)
    : null;
  if (projectId && !project) throw new Error('프로젝트를 찾을 수 없습니다.');

  const resolvedSpaceId = rawSpaceId ?? (project?.linked_space_id ? Number(project.linked_space_id) : null);
  const space = resolvedSpaceId
    ? (db.prepare('SELECT id, name FROM collab_spaces WHERE id = ?').get(resolvedSpaceId) as
        | { id: number; name: string }
        | undefined)
    : undefined;

  if (scope !== 'PROJECT_ONLY' && !space) {
    throw new Error('공유 스페이스를 찾을 수 없습니다.');
  }

  const projectOwnerId = project ? Number(project.created_by) : null;
  const spaceOwnerId = resolvedSpaceId ? getSpaceOwnerId(resolvedSpaceId) : null;
  const approverId = approverType === 'SPACE_OWNER' ? spaceOwnerId : projectOwnerId;
  if (!approverId) throw new Error('승인 권한자를 찾을 수 없습니다.');

  const existingPending = projectId
    ? (db
        .prepare("SELECT id FROM collab_join_requests WHERE project_id = ? AND target_user_id = ? AND status = 'PENDING'")
        .get(projectId, targetUserId) as { id: number } | undefined)
    : (db
        .prepare("SELECT id FROM collab_join_requests WHERE project_id IS NULL AND space_id = ? AND target_user_id = ? AND status = 'PENDING'")
        .get(resolvedSpaceId, targetUserId) as { id: number } | undefined);

  if (existingPending) {
    const existingList = projectId
      ? getPendingJoinRequestsForProject(projectId, invitedByUserId || 0)
      : resolvedSpaceId
        ? getPendingJoinRequestsForSpace(resolvedSpaceId, invitedByUserId || 0, false)
        : [];
    const existingRow = existingList.find((r) => r.id === Number(existingPending.id));
    if (existingRow) {
      return { alreadyPending: true, request: existingRow };
    }
  }

  const info = db
    .prepare(`
      INSERT INTO collab_join_requests (
        project_id, space_id, target_user_id, invited_by_user_id,
        source, scope, approver_type, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `)
    .run(projectId, resolvedSpaceId, targetUserId, invitedByUserId, source, scope, approverType);
  const newReqId = Number(info.lastInsertRowid);

  const list = projectId
    ? getPendingJoinRequestsForProject(projectId, invitedByUserId || 0)
    : resolvedSpaceId
      ? getPendingJoinRequestsForSpace(resolvedSpaceId, invitedByUserId || 0, true)
      : [];
  const created = list.find((r) => r.id === newReqId)!;

  if (resolvedSpaceId) {
    broadcastSpaceUpdate(resolvedSpaceId, 'JOIN_REQUEST_CREATED', { projectId, spaceId: resolvedSpaceId, requestId: newReqId });
  }

  const targetName = created.target_user_name;
  const projectTitle = project ? String(project.title || '') : '';
  const spaceName = space ? String(space.name || '') : '';

  let titleKo = '';
  let bodyKo = '';
  let titleJa = '';
  let bodyJa = '';
  let titleEn = '';
  let bodyEn = '';
  let url = '/';

  if (scope === 'SPACE_ONLY') {
    titleKo = `🔔 스페이스 초대 승인 요청 · ${spaceName}`;
    bodyKo = invitedByName
      ? `${invitedByName}님이 ${targetName}님을 '${spaceName}' 공유 스페이스에 초대 요청했습니다. 스페이스 방장 승인이 필요합니다.`
      : `${targetName}님이 멤버용 초대 링크로 '${spaceName}' 공유 스페이스 참여를 요청했습니다. 스페이스 방장 승인이 필요합니다.`;
    titleJa = `🔔 スペース招待承認リクエスト · ${spaceName}`;
    bodyJa = invitedByName
      ? `${invitedByName}さんが${targetName}さんを共有スペース「${spaceName}」へ招待申請しました。スペースオーナーの承認が必要です。`
      : `${targetName}さんがメンバー用招待リンクから共有スペース「${spaceName}」への参加を申請しました。スペースオーナーの承認が必要です。`;
    titleEn = `🔔 Space Invite Approval · ${spaceName}`;
    bodyEn = invitedByName
      ? `${invitedByName} requested to invite ${targetName} to Shared Space '${spaceName}'. Space owner approval required.`
      : `${targetName} requested to join Shared Space '${spaceName}' via member invite link. Space owner approval required.`;
    url = `/?tab=calendar&space=${resolvedSpaceId}`;
  } else if (scope === 'SPACE_AND_PROJECT' && contextReason === 'LINK_EXISTING_PROJECT') {
    titleKo = `🔔 스페이스 합류 승인 요청 · ${spaceName}`;
    bodyKo = `${invitedByName}님이 '${projectTitle}' 프로젝트를 '${spaceName}' 스페이스에 연결하며 미소속 멤버(${targetName})의 스페이스 합류 승인을 요청했습니다.`;
    titleJa = `🔔 スペース参加承認リクエスト · ${spaceName}`;
    bodyJa = `${invitedByName}さんが「${projectTitle}」をスペース「${spaceName}」に連携し、未所属メンバー（${targetName}）のスペース参加承認を申請しました。`;
    titleEn = `🔔 Space Join Approval · ${spaceName}`;
    bodyEn = `${invitedByName} linked '${projectTitle}' to '${spaceName}' and requested space approval for non-space member ${targetName}.`;
    url = `/?tab=calendar&space=${resolvedSpaceId}`;
  } else if (scope === 'SPACE_AND_PROJECT') {
    titleKo = `🔔 초대 승인 요청 · ${spaceName || projectTitle}`;
    bodyKo = invitedByName
      ? `${invitedByName}님이 스페이스 미소속 인원(${targetName})을 '${projectTitle}' 프로젝트·'${spaceName}' 공유 스페이스에 초대 요청했습니다. ${approverType === 'SPACE_OWNER' ? '스페이스 방장' : '프로젝트 방장'} 승인이 필요합니다.`
      : `${targetName}님이 초대 링크로 '${projectTitle}' 프로젝트·'${spaceName}' 공유 스페이스 참여를 요청했습니다. ${approverType === 'SPACE_OWNER' ? '스페이스 방장' : '프로젝트 방장'} 승인이 필요합니다.`;
    titleJa = `🔔 招待承認リクエスト · ${spaceName || projectTitle}`;
    bodyJa = invitedByName
      ? `${invitedByName}さんがスペース未所属の${targetName}さんを「${projectTitle}」プロジェクト・共有スペース「${spaceName}」へ招待申請しました。${approverType === 'SPACE_OWNER' ? 'スペースオーナー' : 'プロジェクトオーナー'}の承認が必要です。`
      : `${targetName}さんが招待リンクから「${projectTitle}」プロジェクト・共有スペース「${spaceName}」への参加を申請しました。${approverType === 'SPACE_OWNER' ? 'スペースオーナー' : 'プロジェクトオーナー'}の承認が必要です。`;
    titleEn = `🔔 Invite Approval Request · ${spaceName || projectTitle}`;
    bodyEn = invitedByName
      ? `${invitedByName} requested to invite ${targetName} to '${projectTitle}' & Shared Space '${spaceName}'. ${approverType === 'SPACE_OWNER' ? 'Space owner' : 'Project owner'} approval required.`
      : `${targetName} requested to join '${projectTitle}' & Shared Space '${spaceName}' via invite link. ${approverType === 'SPACE_OWNER' ? 'Space owner' : 'Project owner'} approval required.`;
    url =
      approverType === 'SPACE_OWNER' && resolvedSpaceId
        ? `/?tab=calendar&space=${resolvedSpaceId}`
        : `/?tab=mindmap&project=${projectId}`;
  } else {
    titleKo = `🔔 프로젝트 초대 승인 요청 · ${projectTitle}`;
    bodyKo = invitedByName
      ? `${invitedByName}님이 ${targetName}님을 '${projectTitle}' 프로젝트에 초대 요청했습니다. 프로젝트 방장 승인이 필요합니다.`
      : `${targetName}님이 멤버용 초대 링크로 '${projectTitle}' 프로젝트 참여를 요청했습니다. 프로젝트 방장 승인이 필요합니다.`;
    titleJa = `🔔 プロジェクト招待承認リクエスト · ${projectTitle}`;
    bodyJa = invitedByName
      ? `${invitedByName}さんが${targetName}さんを「${projectTitle}」プロジェクトへ招待申請しました。プロジェクトオーナーの承認が必要です。`
      : `${targetName}さんがメンバー用招待リンクから「${projectTitle}」プロジェクトへの参加を申請しました。プロジェクトオーナーの承認が必要です。`;
    titleEn = `🔔 Project Invite Approval · ${projectTitle}`;
    bodyEn = invitedByName
      ? `${invitedByName} requested to invite ${targetName} to project '${projectTitle}'. Project owner approval required.`
      : `${targetName} requested to join project '${projectTitle}' via member invite link. Project owner approval required.`;
    url = `/?tab=mindmap&project=${projectId}`;
  }

  void sendPushToUsers([approverId], {
    titleKo,
    bodyKo,
    titleJa,
    bodyJa,
    titleEn,
    bodyEn,
    url,
    ...(projectId ? { projectId } : {}),
    tag: `collab-join-req-${projectId || 0}-${resolvedSpaceId || 0}-${newReqId}`,
  });

  return { alreadyPending: false, request: created };
}

export function resolveJoinRequest(params: {
  requestId: number;
  actorUserId: number;
  actorName: string;
  decision: 'APPROVED' | 'REJECTED';
}): {
  request: {
    id: number;
    project_id: number | null;
    space_id: number | null;
    target_user_id: number;
    target_user_name: string;
    invited_by_user_id: number | null;
    source: 'PROJECT' | 'SPACE';
    scope: JoinRequestScope;
    approver_type: JoinRequestApproverType;
    status: 'APPROVED' | 'REJECTED';
  };
  spaceId: number | null;
} {
  const { requestId, actorUserId, actorName, decision } = params;

  const row = db
    .prepare(`
      SELECT r.*, p.title as project_title, p.created_by as project_owner_id,
             p.linked_space_id as project_linked_space_id,
             s.name as space_name,
             tu.name as target_user_name
      FROM collab_join_requests r
      LEFT JOIN journal_projects p ON p.id = r.project_id
      LEFT JOIN collab_spaces s ON s.id = r.space_id
      INNER JOIN users tu ON tu.id = r.target_user_id
      WHERE r.id = ?
    `)
    .get(requestId) as any;

  if (!row) throw new Error('승인 대기 요청을 찾을 수 없습니다.');
  if (row.status !== 'PENDING') {
    throw new Error('이미 처리된 요청입니다.');
  }

  const projectId = row.project_id ? Number(row.project_id) : null;
  const spaceId = row.space_id
    ? Number(row.space_id)
    : row.project_linked_space_id
      ? Number(row.project_linked_space_id)
      : null;
  const scope: JoinRequestScope =
    row.scope === 'SPACE_ONLY' || row.scope === 'SPACE_AND_PROJECT' ? row.scope : 'PROJECT_ONLY';
  const approverType: JoinRequestApproverType =
    row.approver_type === 'SPACE_OWNER' ? 'SPACE_OWNER' : 'PROJECT_OWNER';

  if (approverType === 'SPACE_OWNER') {
    if (!spaceId || !isSpaceOwner(spaceId, actorUserId)) {
      throw new Error('이 요청의 승인/거절은 공유 스페이스 방장만 할 수 있습니다.');
    }
  } else {
    if (!projectId || Number(row.project_owner_id) !== actorUserId) {
      throw new Error('이 요청의 승인/거절은 프로젝트 소유자(방장)만 할 수 있습니다.');
    }
  }

  const targetUserId = Number(row.target_user_id);
  const invitedByUserId = row.invited_by_user_id ? Number(row.invited_by_user_id) : null;
  const projectTitle = String(row.project_title || '');
  const spaceName = String(row.space_name || '');
  const targetUserName = String(row.target_user_name || '');
  const labelTitle = scope === 'SPACE_ONLY' ? spaceName : projectTitle || spaceName;
  let finalSpaceId = spaceId;

  if (decision === 'APPROVED') {
    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ?
    `).run(actorUserId, requestId);

    if (scope === 'SPACE_ONLY' && spaceId) {
      addUserToSpaceOnly({
        spaceId,
        targetUserId,
        actorId: actorUserId,
        actorName,
        viaApproval: true,
      });
    } else if (projectId) {
      const added = addUserToProject({
        projectId,
        targetUserId,
        actorId: actorUserId,
        actorName,
        source: row.source === 'SPACE' ? 'SPACE' : 'PROJECT',
        addToSpaceToo: scope === 'SPACE_AND_PROJECT',
        viaApproval: true,
      });
      finalSpaceId = added.spaceId ?? finalSpaceId;
    }
  } else {
    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'REJECTED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ?
    `).run(actorUserId, requestId);

    if (finalSpaceId) {
      broadcastSpaceUpdate(finalSpaceId, 'JOIN_REQUEST_REJECTED', {
        projectId,
        spaceId: finalSpaceId,
        requestId,
        actorId: actorUserId,
      });
    }

    const url =
      (scope === 'SPACE_ONLY' || row.source === 'SPACE') && finalSpaceId
        ? `/?tab=calendar&space=${finalSpaceId}`
        : projectId
          ? `/?tab=mindmap&project=${projectId}`
          : '/';

    const ownerRoleKo = approverType === 'SPACE_OWNER' ? '스페이스 방장' : '프로젝트 방장';
    const ownerRoleJa = approverType === 'SPACE_OWNER' ? 'スペースオーナー' : 'プロジェクトオーナー';
    const ownerRoleEn = approverType === 'SPACE_OWNER' ? 'space owner' : 'project owner';

    if (invitedByUserId && invitedByUserId !== actorUserId && invitedByUserId !== targetUserId) {
      void sendPushToUsers([invitedByUserId], {
        titleKo: `❌ 초대 요청 거절 · ${labelTitle}`,
        bodyKo: `${ownerRoleKo}이 '${labelTitle}'에 대한 ${targetUserName}님 초대 요청을 거절했습니다.`,
        titleJa: `❌ 招待申請却下 · ${labelTitle}`,
        bodyJa: `${ownerRoleJa}が「${labelTitle}」への${targetUserName}さんの招待申請を却下しました。`,
        titleEn: `❌ Invite Request Declined · ${labelTitle}`,
        bodyEn: `The ${ownerRoleEn} declined your invite request for ${targetUserName} to '${labelTitle}'.`,
        url,
        ...(projectId ? { projectId } : {}),
        tag: `collab-join-rej-inv-${requestId}`,
      });
    }

    if (targetUserId !== actorUserId) {
      void sendPushToUsers([targetUserId], {
        titleKo: `❌ 참여 요청 거절 · ${labelTitle}`,
        bodyKo: `'${labelTitle}' 참여 요청이 ${ownerRoleKo}에 의해 거절되었습니다.`,
        titleJa: `❌ 参加申請却下 · ${labelTitle}`,
        bodyJa: `「${labelTitle}」への参加申請は${ownerRoleJa}により却下されました。`,
        titleEn: `❌ Join Request Declined · ${labelTitle}`,
        bodyEn: `Your join request for '${labelTitle}' was declined by the ${ownerRoleEn}.`,
        url: '/',
        ...(projectId ? { projectId } : {}),
        tag: `collab-join-rej-tgt-${requestId}`,
      });
    }
  }

  return {
    request: {
      id: Number(row.id),
      project_id: projectId,
      space_id: finalSpaceId,
      target_user_id: targetUserId,
      target_user_name: targetUserName,
      invited_by_user_id: invitedByUserId,
      source: row.source === 'SPACE' ? 'SPACE' : 'PROJECT',
      scope,
      approver_type: approverType,
      status: decision,
    },
    spaceId: finalSpaceId,
  };
}
