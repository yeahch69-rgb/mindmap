import { db, DEFAULT_SPACE_LABELS, generateInviteToken } from '../db/database.js';
import { broadcastSpaceUpdate } from './spaceRealtime.js';
import { sendPushToUsers } from './webPush.js';

export interface LinkedSpaceSummary {
  id: number;
  name: string;
  color: string;
  member_count: number;
}

export interface LinkedProjectSummary {
  id: number;
  title: string;
  color: string;
  mode: string;
  created_by: number;
}

export interface CollabJoinRequestRow {
  id: number;
  project_id: number;
  space_id: number | null;
  target_user_id: number;
  target_user_name: string;
  target_user_email: string;
  invited_by_user_id: number | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
}

export interface MyPendingJoinRequestRow {
  id: number;
  project_id: number;
  project_title: string;
  space_id: number | null;
  space_name: string | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  created_at: string;
}

export function getLinkedSpaceForProject(projectId: number): LinkedSpaceSummary | null {
  const row = db
    .prepare(`
      SELECT s.id, s.name, s.color,
        (SELECT COUNT(*) FROM collab_space_members m WHERE m.space_id = s.id) as member_count
      FROM collab_spaces s
      WHERE s.linked_project_id = ?
      LIMIT 1
    `)
    .get(projectId) as { id: number; name: string; color: string; member_count: number } | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color || '#1B4D3E',
    member_count: Number(row.member_count || 0),
  };
}

export function getLinkedSpacesMapForProjects(projectIds: number[]): Map<number, LinkedSpaceSummary> {
  const map = new Map<number, LinkedSpaceSummary>();
  if (projectIds.length === 0) return map;
  const ph = projectIds.map(() => '?').join(',');
  const rows = db
    .prepare(`
      SELECT s.id, s.linked_project_id, s.name, s.color,
        (SELECT COUNT(*) FROM collab_space_members m WHERE m.space_id = s.id) as member_count
      FROM collab_spaces s
      WHERE s.linked_project_id IN (${ph})
    `)
    .all(...projectIds) as Array<{
    id: number;
    linked_project_id: number;
    name: string;
    color: string;
    member_count: number;
  }>;
  for (const r of rows) {
    map.set(Number(r.linked_project_id), {
      id: Number(r.id),
      name: r.name,
      color: r.color || '#1B4D3E',
      member_count: Number(r.member_count || 0),
    });
  }
  return map;
}

export function getLinkedProjectForSpace(
  space: { linked_project_id?: number | null } | null | undefined
): LinkedProjectSummary | null {
  const pid = Number(space?.linked_project_id || 0);
  if (!pid) return null;
  const row = db
    .prepare('SELECT id, title, color, mode, created_by FROM journal_projects WHERE id = ?')
    .get(pid) as { id: number; title: string; color: string; mode: string; created_by: number } | undefined;
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    color: row.color || '#1B4D3E',
    mode: row.mode,
    created_by: Number(row.created_by),
  };
}

export function createLinkedSpaceForProjectInTx(projectId: number): { spaceId: number; created: boolean } {
  const existing = db
    .prepare('SELECT id FROM collab_spaces WHERE linked_project_id = ? LIMIT 1')
    .get(projectId) as { id: number } | undefined;
  if (existing?.id) {
    return { spaceId: Number(existing.id), created: false };
  }

  const project = db
    .prepare('SELECT id, title, color, created_by FROM journal_projects WHERE id = ?')
    .get(projectId) as { id: number; title: string; color: string; created_by: number } | undefined;
  if (!project) {
    throw new Error('프로젝트를 찾을 수 없습니다.');
  }

  const ownerId = Number(project.created_by);
  const projMembers = db
    .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
    .all(projectId) as Array<{ user_id: number }>;

  const res = db
    .prepare(`
      INSERT INTO collab_spaces (name, description, color, is_personal, linked_project_id, invite_token, member_invite_token, labels_json, created_by)
      VALUES (?, '', ?, 0, ?, ?, ?, ?, ?)
    `)
    .run(
      String(project.title || '').trim() || 'Shared Space',
      project.color || '#1B4D3E',
      projectId,
      generateInviteToken(),
      generateInviteToken(),
      JSON.stringify(DEFAULT_SPACE_LABELS),
      ownerId
    );
  const spaceId = Number(res.lastInsertRowid);

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
    SET space_id = ?
    WHERE project_id = ? AND status = 'PENDING' AND space_id IS NULL
  `).run(spaceId, projectId);

  return { spaceId, created: true };
}

export function linkExistingSpaceToProject(
  projectId: number,
  spaceId: number,
  ownerUserId: number
): { spaceId: number } {
  const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
  if (Number(project.created_by) !== ownerUserId) {
    throw new Error('공유 스페이스 연동은 프로젝트 소유자만 할 수 있습니다.');
  }
  if (project.mode !== 'COLLAB') {
    throw new Error('협업 프로젝트에서만 공유 스페이스를 연동할 수 있습니다.');
  }
  if (getLinkedSpaceForProject(projectId)) {
    throw new Error('이미 연동된 공유 스페이스가 있습니다.');
  }

  const space = db.prepare('SELECT * FROM collab_spaces WHERE id = ?').get(spaceId) as any;
  if (!space) throw new Error('공유 스페이스를 찾을 수 없습니다.');
  if (space.linked_project_id) {
    throw new Error('이미 다른 프로젝트와 연동된 공유 스페이스입니다.');
  }
  const ownerMembership = db
    .prepare("SELECT role FROM collab_space_members WHERE space_id = ? AND user_id = ? AND role = 'OWNER'")
    .get(spaceId, ownerUserId);
  if (!ownerMembership) {
    throw new Error('본인이 방장인 미연동 공유 스페이스만 연결할 수 있습니다.');
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE collab_spaces
      SET linked_project_id = ?,
          is_personal = 0,
          member_invite_token = COALESCE(member_invite_token, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(projectId, generateInviteToken(), spaceId);

    // Ensure project has both invite tokens and SHARED/COLLAB ready
    db.prepare(`
      UPDATE journal_projects
      SET invite_token = COALESCE(invite_token, ?),
          member_invite_token = COALESCE(member_invite_token, ?),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(generateInviteToken(), generateInviteToken(), projectId);

    const projMembers = (
      db.prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?').all(projectId) as Array<{
        user_id: number;
      }>
    ).map((r) => Number(r.user_id));

    const spaceMembers = (
      db.prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?').all(spaceId) as Array<{
        user_id: number;
      }>
    ).map((r) => Number(r.user_id));

    const unionIds = Array.from(new Set<number>([ownerUserId, ...projMembers, ...spaceMembers])).filter((id) => id > 0);

    const insertSpaceMember = db.prepare(`
      INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
      VALUES (?, ?, ?, 0)
    `);
    const insertProjMember = db.prepare(`
      INSERT OR IGNORE INTO journal_project_members (project_id, user_id, role)
      VALUES (?, ?, 'MEMBER')
    `);

    for (const uid of unionIds) {
      insertSpaceMember.run(spaceId, uid, uid === ownerUserId ? 'OWNER' : 'MEMBER');
      if (uid !== ownerUserId) {
        insertProjMember.run(projectId, uid);
      }
    }

    if (unionIds.some((id) => id !== ownerUserId) && project.partner_type === 'NONE') {
      db.prepare("UPDATE journal_projects SET partner_type = 'SHARED' WHERE id = ?").run(projectId);
    }

    db.prepare(`
      UPDATE collab_join_requests
      SET space_id = ?
      WHERE project_id = ? AND status = 'PENDING'
    `).run(spaceId, projectId);
  })();

  broadcastSpaceUpdate(spaceId, 'SPACE_UPDATED', { linkedProjectId: projectId, actorId: ownerUserId });
  return { spaceId };
}

export function unlinkSpaceFromProject(projectId: number, actorId: number): number | null {
  const space = db
    .prepare('SELECT id FROM collab_spaces WHERE linked_project_id = ?')
    .get(projectId) as { id: number } | undefined;
  if (!space?.id) return null;
  const spaceId = Number(space.id);

  db.prepare(`
    UPDATE collab_spaces
    SET linked_project_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(spaceId);

  db.prepare(`
    UPDATE collab_join_requests
    SET space_id = NULL
    WHERE project_id = ? AND space_id = ?
  `).run(projectId, spaceId);

  broadcastSpaceUpdate(spaceId, 'SPACE_UPDATED', { unlinkedProjectId: projectId, actorId });
  return spaceId;
}

export function addUserToProjectAndLinkedSpace(params: {
  projectId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
  source: 'PROJECT' | 'SPACE';
  viaApproval?: boolean;
  viaLink?: boolean;
  skipPush?: boolean;
}): {
  joinedNewly: boolean;
  spaceId: number | null;
  autoCreatedSpace: boolean;
  projectTitle: string;
} {
  const { projectId, targetUserId, actorId, actorName, source, viaApproval, viaLink, skipPush } = params;

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

    const existingSpaceBefore = db
      .prepare('SELECT id, name FROM collab_spaces WHERE linked_project_id = ?')
      .get(projectId) as { id: number; name: string } | undefined;

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

    let spaceId: number | null = existingSpaceBefore ? Number(existingSpaceBefore.id) : null;
    let autoCreatedSpace = false;

    // Auto-create linked space when an EXTERNAL project gets its first real app account member
    if (!spaceId && project.partner_type === 'EXTERNAL' && beforeProjMembers.length === 0) {
      const created = createLinkedSpaceForProjectInTx(projectId);
      spaceId = created.spaceId;
      autoCreatedSpace = created.created;
    }

    let spaceInserted = false;
    if (spaceId) {
      const sInsert = db
        .prepare(`
          INSERT OR IGNORE INTO collab_space_members (space_id, user_id, role, last_read_activity_id)
          VALUES (?, ?, 'MEMBER', 0)
        `)
        .run(spaceId, targetUserId);
      spaceInserted = sInsert.changes > 0;
      db.prepare('UPDATE collab_spaces SET is_personal = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(spaceId);

      if (projInsert.changes > 0 || spaceInserted) {
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

    // Mark any pending join request for this user as approved
    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE project_id = ? AND target_user_id = ? AND status = 'PENDING'
    `).run(actorId, projectId, targetUserId);

    const existingPeers = Array.from(new Set<number>([ownerId, ...beforeProjMembers])).filter(
      (id) => id > 0 && id !== actorId && id !== targetUserId
    );

    return {
      joinedNewly: projInsert.changes > 0 || spaceInserted || autoCreatedSpace,
      spaceId,
      autoCreatedSpace,
      projectTitle: String(project.title || ''),
      targetUserName: targetUser.name,
      existingPeers,
    };
  })();

  if (result.spaceId && result.joinedNewly) {
    broadcastSpaceUpdate(result.spaceId, 'MEMBER_JOINED', { actorId, targetUserId, projectId });
  }

  if (result.joinedNewly && !skipPush) {
    const hasSpace = Boolean(result.spaceId);
    const url = `/?tab=mindmap&project=${projectId}`;
    const targetName = result.targetUserName;

    // 1. Unified single notification to the newly joined user (when invited or approved by someone else)
    if (targetUserId !== actorId) {
      void sendPushToUsers([targetUserId], {
        titleKo: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyKo: viaApproval
          ? hasSpace
            ? `🎉 방장 승인으로 '${result.projectTitle}' 프로젝트와 연동 공유 스페이스에 함께 합류되었습니다.`
            : `🎉 방장 승인으로 '${result.projectTitle}' 프로젝트에 합류되었습니다.`
          : hasSpace
            ? `${actorName}님이 '${result.projectTitle}' 프로젝트와 연동 공유 스페이스(캘린더·메모장)에 초대했습니다.`
            : `${actorName}님이 '${result.projectTitle}' 협업 프로젝트에 초대했습니다.`,
        titleJa: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyJa: viaApproval
          ? hasSpace
            ? `🎉 オーナー承認により「${result.projectTitle}」プロジェクトと連携共有スペースに同時参加しました。`
            : `🎉 オーナー承認により「${result.projectTitle}」プロジェクトに参加しました。`
          : hasSpace
            ? `${actorName}さんが「${result.projectTitle}」プロジェクトと連携共有スペース（カレンダー・メモ帳）に招待しました。`
            : `${actorName}さんが「${result.projectTitle}」協業プロジェクトに招待しました。`,
        titleEn: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyEn: viaApproval
          ? hasSpace
            ? `🎉 Approved by the owner! You have joined '${result.projectTitle}' and its linked Shared Space.`
            : `🎉 Approved by the owner! You have joined project '${result.projectTitle}'.`
          : hasSpace
            ? `${actorName} invited you to '${result.projectTitle}' (Project & linked Shared Space).`
            : `${actorName} invited you to project '${result.projectTitle}'.`,
        url,
        projectId,
        tag: `collab-unified-join-${projectId}-${targetUserId}`,
      });
    }

    // 2. Unified single notification to existing peers
    if (result.existingPeers.length > 0) {
      void sendPushToUsers(result.existingPeers, {
        titleKo: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyKo: viaApproval
          ? `👋 ${targetName}님이 방장 승인으로 '${result.projectTitle}'(${hasSpace ? '프로젝트·공유 스페이스' : '프로젝트'})에 합류했습니다.`
          : viaLink
            ? `👋 ${targetName}님이 초대 링크로 '${result.projectTitle}'(${hasSpace ? '프로젝트·공유 스페이스' : '프로젝트'})에 합류했습니다.`
            : `👋 ${actorName}님이 ${targetName}님을 '${result.projectTitle}'(${hasSpace ? '프로젝트·공유 스페이스' : '프로젝트'})에 초대했습니다.`,
        titleJa: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyJa: viaApproval
          ? `👋 ${targetName}さんがオーナー承認により「${result.projectTitle}」（${hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト'}）に参加しました。`
          : viaLink
            ? `👋 ${targetName}さんが招待リンクから「${result.projectTitle}」（${hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト'}）に参加しました。`
            : `👋 ${actorName}さんが${targetName}さんを「${result.projectTitle}」（${hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト'}）に招待しました。`,
        titleEn: hasSpace ? `🤝 ${result.projectTitle}` : `📌 ${result.projectTitle}`,
        bodyEn: viaApproval
          ? `👋 ${targetName} joined '${result.projectTitle}' (${hasSpace ? 'Project & Shared Space' : 'Project'}) after owner approval.`
          : viaLink
            ? `👋 ${targetName} joined '${result.projectTitle}' (${hasSpace ? 'Project & Shared Space' : 'Project'}) via invite link.`
            : `👋 ${actorName} invited ${targetName} to '${result.projectTitle}' (${hasSpace ? 'Project & Shared Space' : 'Project'}).`,
        url,
        projectId,
        tag: `collab-unified-peer-${projectId}-${targetUserId}`,
      });
    }
  }

  return {
    joinedNewly: result.joinedNewly,
    spaceId: result.spaceId,
    autoCreatedSpace: result.autoCreatedSpace,
    projectTitle: result.projectTitle,
  };
}

export function removeUserFromProjectAndLinkedSpace(params: {
  projectId: number;
  targetUserId: number;
  actorId: number;
  actorName: string;
}): {
  removed: boolean;
  spaceId: number | null;
} {
  const { projectId, targetUserId, actorId, actorName } = params;
  const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');

  const ownerId = Number(project.created_by);
  if (targetUserId === ownerId) {
    throw new Error('방장(소유자)은 나갈 수 없습니다. 프로젝트 또는 스페이스를 삭제해 주세요.');
  }

  const targetUser = db
    .prepare('SELECT id, name FROM users WHERE id = ?')
    .get(targetUserId) as { id: number; name: string } | undefined;

  const linkedSpace = getLinkedSpaceForProject(projectId);
  const spaceId = linkedSpace?.id ?? null;

  const { removed, remainingPeers } = db.transaction(() => {
    const projDel = db
      .prepare('DELETE FROM journal_project_members WHERE project_id = ? AND user_id = ?')
      .run(projectId, targetUserId);

    if (Number(project.active_turn_user_id || 0) === targetUserId) {
      db.prepare('UPDATE journal_projects SET active_turn_user_id = ? WHERE id = ?').run(ownerId, projectId);
    }

    let spaceDelChanges = 0;
    if (spaceId) {
      const sDel = db
        .prepare("DELETE FROM collab_space_members WHERE space_id = ? AND user_id = ? AND role != 'OWNER'")
        .run(spaceId, targetUserId);
      spaceDelChanges = sDel.changes;
    }

    const remRows = db
      .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
      .all(projectId) as Array<{ user_id: number }>;
    const remPeers = Array.from(new Set<number>([ownerId, ...remRows.map((r) => Number(r.user_id))])).filter(
      (id) => id > 0 && id !== actorId && id !== targetUserId
    );

    return {
      removed: projDel.changes > 0 || spaceDelChanges > 0,
      remainingPeers: remPeers,
    };
  })();

  if (removed) {
    if (spaceId) {
      broadcastSpaceUpdate(spaceId, 'MEMBER_REMOVED', { actorId, targetUserId, projectId });
    }
    const targetName = targetUser?.name || '멤버';
    const hasSpace = Boolean(spaceId);
    const isSelf = targetUserId === actorId;

    if (remainingPeers.length > 0) {
      void sendPushToUsers(remainingPeers, {
        titleKo: `📌 ${project.title}`,
        bodyKo: isSelf
          ? `👋 ${actorName}님이 ${hasSpace ? '프로젝트와 연동 공유 스페이스' : '프로젝트'}에서 나갔습니다.`
          : `👋 ${actorName}님이 ${targetName}님을 ${hasSpace ? '프로젝트와 연동 공유 스페이스' : '프로젝트'}에서 제외했습니다.`,
        titleJa: `📌 ${project.title}`,
        bodyJa: isSelf
          ? `👋 ${actorName}さんが${hasSpace ? 'プロジェクトと連携共有スペース' : 'プロジェクト'}から退出しました。`
          : `👋 ${actorName}さんが${targetName}さんを${hasSpace ? 'プロジェクトと連携共有スペース' : 'プロジェクト'}から除外しました。`,
        titleEn: `📌 ${project.title}`,
        bodyEn: isSelf
          ? `👋 ${actorName} left ${hasSpace ? 'the project and its linked Shared Space' : 'the project'}.`
          : `👋 ${actorName} removed ${targetName} from ${hasSpace ? 'the project and its linked Shared Space' : 'the project'}.`,
        url: `/?tab=mindmap&project=${projectId}`,
        projectId,
        tag: `collab-rm-${projectId}-${targetUserId}`,
      });
    }

    if (!isSelf) {
      void sendPushToUsers([targetUserId], {
        titleKo: `📌 ${project.title}`,
        bodyKo: `👋 ${actorName}님이 '${project.title}'${hasSpace ? '(프로젝트·공유 스페이스)' : ''} 멤버에서 제외했습니다.`,
        titleJa: `📌 ${project.title}`,
        bodyJa: `👋 ${actorName}さんが「${project.title}」${hasSpace ? '（プロジェクト・共有スペース）' : ''}のメンバーから除外しました。`,
        titleEn: `📌 ${project.title}`,
        bodyEn: `👋 ${actorName} removed you from '${project.title}'${hasSpace ? ' (Project & Shared Space)' : ''}.`,
        url: '/',
        projectId,
        tag: `collab-kicked-${projectId}`,
      });
    }
  }

  return { removed, spaceId };
}

export function getPendingJoinRequestsForProject(projectId: number): CollabJoinRequestRow[] {
  const rows = db
    .prepare(`
      SELECT r.id, r.project_id, r.space_id, r.target_user_id, r.invited_by_user_id, r.source, r.status, r.created_at,
             tu.name as target_user_name,
             tu.email as target_user_email,
             COALESCE(iu.name, '') as invited_by_name
      FROM collab_join_requests r
      INNER JOIN users tu ON tu.id = r.target_user_id
      LEFT JOIN users iu ON iu.id = r.invited_by_user_id
      WHERE r.project_id = ? AND r.status = 'PENDING'
      ORDER BY r.id ASC
    `)
    .all(projectId) as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    project_id: Number(r.project_id),
    space_id: r.space_id ? Number(r.space_id) : null,
    target_user_id: Number(r.target_user_id),
    target_user_name: r.target_user_name || '',
    target_user_email: r.target_user_email || '',
    invited_by_user_id: r.invited_by_user_id ? Number(r.invited_by_user_id) : null,
    invited_by_name: r.invited_by_name || '',
    source: r.source === 'SPACE' ? 'SPACE' : 'PROJECT',
    status: r.status,
    created_at: r.created_at,
  }));
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
      SELECT r.id, r.project_id, r.space_id, r.source, r.created_at,
             p.title as project_title,
             s.name as space_name,
             COALESCE(iu.name, '') as invited_by_name
      FROM collab_join_requests r
      INNER JOIN journal_projects p ON p.id = r.project_id
      LEFT JOIN collab_spaces s ON s.id = r.space_id
      LEFT JOIN users iu ON iu.id = r.invited_by_user_id
      WHERE r.target_user_id = ? AND r.status = 'PENDING'
      ORDER BY r.id DESC
    `)
    .all(userId) as any[];
  return rows.map((r) => ({
    id: Number(r.id),
    project_id: Number(r.project_id),
    project_title: r.project_title || '',
    space_id: r.space_id ? Number(r.space_id) : null,
    space_name: r.space_name || null,
    invited_by_name: r.invited_by_name || '',
    source: r.source === 'SPACE' ? 'SPACE' : 'PROJECT',
    created_at: r.created_at,
  }));
}

export function createJoinRequestForProject(params: {
  projectId: number;
  targetUserId: number;
  invitedByUserId: number | null;
  invitedByName: string;
  source: 'PROJECT' | 'SPACE';
}): {
  alreadyPending: boolean;
  request: CollabJoinRequestRow;
} {
  const { projectId, targetUserId, invitedByUserId, invitedByName, source } = params;
  const project = db.prepare('SELECT * FROM journal_projects WHERE id = ?').get(projectId) as any;
  if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');

  const ownerId = Number(project.created_by);
  const linkedSpace = getLinkedSpaceForProject(projectId);
  const spaceId = linkedSpace?.id ?? null;

  const existingPending = db
    .prepare("SELECT id FROM collab_join_requests WHERE project_id = ? AND target_user_id = ? AND status = 'PENDING'")
    .get(projectId, targetUserId) as { id: number } | undefined;

  if (existingPending) {
    const existingRow = getPendingJoinRequestsForProject(projectId).find((r) => r.id === Number(existingPending.id));
    if (existingRow) {
      return { alreadyPending: true, request: existingRow };
    }
  }

  const info = db
    .prepare(`
      INSERT INTO collab_join_requests (project_id, space_id, target_user_id, invited_by_user_id, source, status)
      VALUES (?, ?, ?, ?, ?, 'PENDING')
    `)
    .run(projectId, spaceId, targetUserId, invitedByUserId, source);
  const newReqId = Number(info.lastInsertRowid);
  const created = getPendingJoinRequestsForProject(projectId).find((r) => r.id === newReqId)!;

  if (spaceId) {
    broadcastSpaceUpdate(spaceId, 'JOIN_REQUEST_CREATED', { projectId, requestId: newReqId });
  }

  const hasSpace = Boolean(spaceId);
  const targetName = created.target_user_name;
  const url =
    source === 'SPACE' && spaceId
      ? `/?tab=calendar&space=${spaceId}`
      : `/?tab=mindmap&project=${projectId}`;

  const bodyKo = invitedByName
    ? `${invitedByName}님이 ${targetName}님을 '${project.title}'(${hasSpace ? '프로젝트·공유 스페이스' : '프로젝트'})에 초대 요청했습니다. 승인이 필요합니다.`
    : `${targetName}님이 멤버용 초대 링크로 '${project.title}'(${hasSpace ? '프로젝트·공유 스페이스' : '프로젝트'}) 참여를 요청했습니다. 승인이 필요합니다.`;
  const bodyJa = invitedByName
    ? `${invitedByName}さんが${targetName}さんを「${project.title}」（${hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト'}）へ招待申請しました。承認が必要です。`
    : `${targetName}さんがメンバー用招待リンクから「${project.title}」（${hasSpace ? 'プロジェクト・共有スペース' : 'プロジェクト'}）への参加を申請しました。承認が必要です。`;
  const bodyEn = invitedByName
    ? `${invitedByName} requested to invite ${targetName} to '${project.title}' (${hasSpace ? 'Project & Shared Space' : 'Project'}). Owner approval required.`
    : `${targetName} requested to join '${project.title}' (${hasSpace ? 'Project & Shared Space' : 'Project'}) via member invite link. Owner approval required.`;

  void sendPushToUsers([ownerId], {
    titleKo: `🔔 초대 승인 요청 · ${project.title}`,
    bodyKo,
    titleJa: `🔔 招待承認リクエスト · ${project.title}`,
    bodyJa,
    titleEn: `🔔 Invite Approval Request · ${project.title}`,
    bodyEn,
    url,
    projectId,
    tag: `collab-join-req-${projectId}-${newReqId}`,
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
    project_id: number;
    space_id: number | null;
    target_user_id: number;
    target_user_name: string;
    invited_by_user_id: number | null;
    source: 'PROJECT' | 'SPACE';
    status: 'APPROVED' | 'REJECTED';
  };
  spaceId: number | null;
} {
  const { requestId, actorUserId, actorName, decision } = params;

  const row = db
    .prepare(`
      SELECT r.*, p.title as project_title, p.created_by as project_owner_id,
             tu.name as target_user_name
      FROM collab_join_requests r
      INNER JOIN journal_projects p ON p.id = r.project_id
      INNER JOIN users tu ON tu.id = r.target_user_id
      WHERE r.id = ?
    `)
    .get(requestId) as any;

  if (!row) throw new Error('승인 대기 요청을 찾을 수 없습니다.');
  if (Number(row.project_owner_id) !== actorUserId) {
    throw new Error('초대 요청 승인/거절은 방장(소유자)만 할 수 있습니다.');
  }
  if (row.status !== 'PENDING') {
    throw new Error('이미 처리된 요청입니다.');
  }

  const projectId = Number(row.project_id);
  const targetUserId = Number(row.target_user_id);
  const invitedByUserId = row.invited_by_user_id ? Number(row.invited_by_user_id) : null;
  const projectTitle = String(row.project_title || '');
  const targetUserName = String(row.target_user_name || '');
  let finalSpaceId: number | null = getLinkedSpaceForProject(projectId)?.id ?? null;

  if (decision === 'APPROVED') {
    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'APPROVED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ?
    `).run(actorUserId, requestId);

    const added = addUserToProjectAndLinkedSpace({
      projectId,
      targetUserId,
      actorId: actorUserId,
      actorName,
      source: row.source === 'SPACE' ? 'SPACE' : 'PROJECT',
      viaApproval: true,
    });
    finalSpaceId = added.spaceId;
  } else {
    db.prepare(`
      UPDATE collab_join_requests
      SET status = 'REJECTED', resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ?
    `).run(actorUserId, requestId);

    if (finalSpaceId) {
      broadcastSpaceUpdate(finalSpaceId, 'JOIN_REQUEST_REJECTED', { projectId, requestId, actorId: actorUserId });
    }

    const url =
      row.source === 'SPACE' && finalSpaceId
        ? `/?tab=calendar&space=${finalSpaceId}`
        : `/?tab=mindmap&project=${projectId}`;

    if (invitedByUserId && invitedByUserId !== actorUserId && invitedByUserId !== targetUserId) {
      void sendPushToUsers([invitedByUserId], {
        titleKo: `❌ 초대 요청 거절 · ${projectTitle}`,
        bodyKo: `방장이 '${projectTitle}'에 대한 ${targetUserName}님 초대 요청을 거절했습니다.`,
        titleJa: `❌ 招待申請却下 · ${projectTitle}`,
        bodyJa: `オーナーが「${projectTitle}」への${targetUserName}さんの招待申請を却下しました。`,
        titleEn: `❌ Invite Request Declined · ${projectTitle}`,
        bodyEn: `The owner declined your invite request for ${targetUserName} to '${projectTitle}'.`,
        url,
        projectId,
        tag: `collab-join-rej-inv-${requestId}`,
      });
    }

    if (targetUserId !== actorUserId) {
      void sendPushToUsers([targetUserId], {
        titleKo: `❌ 참여 요청 거절 · ${projectTitle}`,
        bodyKo: `'${projectTitle}' 참여 요청이 방장에 의해 거절되었습니다.`,
        titleJa: `❌ 参加申請却下 · ${projectTitle}`,
        bodyJa: `「${projectTitle}」への参加申請はオーナーにより却下されました。`,
        titleEn: `❌ Join Request Declined · ${projectTitle}`,
        bodyEn: `Your join request for '${projectTitle}' was declined by the owner.`,
        url: '/',
        projectId,
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
      status: decision,
    },
    spaceId: finalSpaceId,
  };
}
