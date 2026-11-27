export type MainNavTab = 'mindmap' | 'calendar' | 'thoughts';

export interface SpaceLabelPreset {
  key: string;
  color: string;
  name: string;
}

export interface SpaceMember {
  user_id: number;
  name: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
  joined_at: string;
}

export type JoinRequestScope = 'PROJECT_ONLY' | 'SPACE_ONLY' | 'SPACE_AND_PROJECT';
export type JoinRequestApproverType = 'PROJECT_OWNER' | 'SPACE_OWNER';

export interface LinkedProjectSummary {
  id: number;
  title: string;
  color: string;
  mode: string;
  created_by: number;
  owner_name?: string;
  is_member?: boolean;
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

export interface CollabJoinRequest {
  id: number;
  project_id: number | null;
  project_title?: string | null;
  space_id: number | null;
  space_name?: string | null;
  target_user_id: number;
  target_user_name: string;
  target_user_email: string;
  invited_by_user_id: number | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  scope: JoinRequestScope;
  approver_type: JoinRequestApproverType;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  can_resolve?: boolean;
  created_at: string;
}

export interface MyPendingJoinRequest {
  id: number;
  project_id: number | null;
  project_title: string | null;
  space_id: number | null;
  space_name: string | null;
  invited_by_name: string;
  source: 'PROJECT' | 'SPACE';
  scope?: JoinRequestScope;
  approver_type?: JoinRequestApproverType;
  created_at: string;
}

export interface CollabSpace {
  id: number;
  name: string;
  description: string;
  color: string;
  is_personal: boolean;
  linked_project_id?: number | null;
  linked_project?: LinkedProjectSummary | null;
  linked_projects?: LinkedProjectSummary[];
  managed_linked_projects?: LinkedProjectSummary[];
  linked_project_count?: number;
  pending_join_requests?: CollabJoinRequest[];
  pending_join_request_count?: number;
  invite_token: string | null;
  member_invite_token?: string | null;
  labels: SpaceLabelPreset[];
  created_by: number;
  my_role: 'OWNER' | 'MEMBER';
  unread_count: number;
  thought_count: number;
  proposed_event_count: number;
  members: SpaceMember[];
  created_at: string;
  updated_at: string;
}

export interface EventVote {
  event_id: number;
  user_id: number;
  vote: 'AVAILABLE' | 'UNAVAILABLE';
  user_name: string;
}

export interface LinkedThoughtSnippet {
  id: number;
  title: string;
  content: string;
  status: string;
}

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

export type RecurrenceType = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type EventStatus = 'PROPOSED' | 'CONFIRMED' | 'CANCELLED';

export type AnniversaryCalendarType = 'SOLAR' | 'LUNAR';

export interface SpaceAnniversary {
  id: number;
  space_id: number;
  title: string;
  memo: string;
  calendar_type: AnniversaryCalendarType;
  base_date: string; // YYYY-MM-DD (Gregorian if SOLAR, Korean Lunar if LUNAR)
  is_leap_month: boolean;
  is_recurring: boolean;
  reminder_days: number[]; // e.g. [] | [0] | [0, 1, 3, 7]
  created_by: number;
  creator_name: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventItem {
  id: number;
  space_id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  label_key: string;
  color: string;
  text_color?: string;
  location: string;
  url: string;
  attendee_ids: number[];
  recurrence_type: RecurrenceType;
  recurrence_until: string | null;
  reminder_minutes: number | null;
  event_status: EventStatus;
  linked_thought_id: number | null;
  linked_thought: LinkedThoughtSnippet | null;
  created_by: number;
  creator_name: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  votes: EventVote[];
  comment_count: number;
  total_log_count: number;
  mindmap_links?: CrossLinkBadge[];
}

export interface CalendarEventComment {
  id: number;
  event_id: number;
  author_id: number | null;
  author_name: string;
  is_system: boolean;
  content: string;
  created_at: string;
}

export type ThoughtStatus = 'NEW' | 'DISCUSSING' | 'PROPOSED' | 'SCHEDULED' | 'ARCHIVED';
export type ThoughtStance = 'GOOD' | 'THINK' | 'BAD';
export type ThoughtCommentType = 'COMMENT' | 'EDIT_PROPOSAL' | 'ADD_PROPOSAL';

export interface ThoughtReaction {
  thought_id: number;
  user_id: number;
  stance: ThoughtStance;
  user_name: string;
}

export interface SharedThought {
  id: number;
  space_id: number;
  title: string;
  content: string;
  tags: string[];
  status: ThoughtStatus;
  is_pinned: boolean;
  is_important: boolean;
  author_id: number;
  author_name: string;
  updated_by: number | null;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
  reactions: ThoughtReaction[];
  comment_count: number;
  open_proposal_count: number;
  revision_count: number;
  linked_events: CalendarEventItem[];
  mindmap_links?: CrossLinkBadge[];
}

export interface ThoughtComment {
  id: number;
  thought_id: number;
  author_id: number;
  author_name: string;
  comment_type: ThoughtCommentType;
  content: string;
  applied_at: string | null;
  applied_by: number | null;
  applied_by_name: string | null;
  created_at: string;
}

export interface ThoughtRevision {
  id: number;
  thought_id: number;
  editor_id: number;
  editor_name: string;
  source_comment_id: number | null;
  change_type: 'EDIT_MERGE' | 'ADD_MERGE' | 'MANUAL_EDIT';
  previous_content: string;
  new_content: string;
  note: string;
  created_at: string;
}

export interface SpaceActivity {
  id: number;
  space_id: number;
  actor_id: number;
  actor_name: string;
  activity_type: string;
  target_type: 'EVENT' | 'THOUGHT' | 'SPACE';
  target_id: number | null;
  summary: string;
  meta: Record<string, unknown>;
  is_unread: boolean;
  created_at: string;
}

export const SPACE_COLOR_PRESETS = [
  '#1B4D3E',
  '#0369A1',
  '#BE123C',
  '#B45309',
  '#6D28D9',
  '#0F766E',
  '#475569',
];
