import type { CollabJoinRequest } from '../../types/spaces';

export type JournalMode = 'SOLO' | 'COLLAB';
export type PartnerType = 'NONE' | 'SHARED' | 'EXTERNAL';
export type TurnState = 'MY_TURN' | 'THEIR_TURN' | 'HOLD' | 'DONE';
export type EntryType = 'DIALOGUE_ME' | 'DIALOGUE_THEM' | 'INTENT' | 'PROGRESS';
export type IdeaStatus = 'OPEN' | 'PROMOTED' | 'ARCHIVED';
export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface FreeMapEdge {
  id: string;
  fromKey: string;
  fromSide: PortSide;
  toKey: string;
  toSide: PortSide;
  color?: string;
  label?: string;
}

export interface MindMapLayoutData {
  positions: Record<string, { x: number; y: number }>;
  custom_edges: FreeMapEdge[];
  parent_overrides?: Record<string, string>;
}

export interface JournalEntryRevisionRequest {
  id: number;
  project_id: number;
  entry_id: number;
  requester_id: number;
  requester_name?: string;
  reason: string;
  status: 'OPEN' | 'RESOLVED';
  created_at?: string;
}

export interface JournalEntry {
  id: number;
  project_id: number;
  entry_type: EntryType;
  speaker_name: string | null;
  content: string;
  entry_date: string;
  entry_time: string | null;
  due_date?: string | null;
  due_time?: string | null;
  completed_target_type?: 'ENTRY' | 'IDEA' | null;
  completed_target_id?: number | null;
  completed_target_summary?: string | null;
  completed_target_kind?: string | null;
  completed_target_date?: string | null;
  author_id: number;
  author_name?: string;
  created_at?: string;
  revision_requests?: JournalEntryRevisionRequest[];
}

export interface JournalIdea {
  id: number;
  project_id: number;
  parent_idea_id?: number | null;
  related_idea_ids?: number[];
  title: string;
  note: string | null;
  status: IdeaStatus;
  author_id: number;
  author_name?: string;
  created_at: string;
}

export interface JournalParticipant {
  name: string;
  role?: string;
}

export interface JournalMember {
  user_id: number;
  name: string;
  email: string;
  role: string;
}

export interface JournalTurnWait {
  wait_days: number;
  started_at: string;
  target_date: string;
  target_name: string | null;
  days_elapsed: number;
  days_remaining: number;
  is_overdue: boolean;
  notified_at: string | null;
}

export interface LinkedSpaceSummary {
  id: number;
  name: string;
  color: string;
  member_count: number;
}

export interface JournalProject {
  id: number;
  title: string;
  mode: JournalMode;
  is_private: number;
  partner_type: PartnerType;
  partner_name: string | null;
  invite_token?: string | null;
  member_invite_token?: string | null;
  linked_space?: LinkedSpaceSummary | null;
  pending_join_requests?: CollabJoinRequest[];
  pending_join_request_count?: number;
  active_turn_user_id?: number | null;
  active_turn_user_name?: string | null;
  my_turn_wait?: JournalTurnWait | null;
  resolved_partner_name?: string;
  creator_name?: string;
  members?: JournalMember[];
  participants?: JournalParticipant[];
  intent_summary: string | null;
  initial_intent_summary?: string | null;
  intent_modified?: number;
  turn_state: TurnState;
  next_action: string | null;
  next_action_date: string | null;
  stale_threshold_days: number;
  last_activity_at: string;
  color: string;
  created_by: number;
  entry_count?: number;
  dialogue_count?: number;
  open_idea_count?: number;
  latest_entry_content?: string | null;
  latest_entry_type?: EntryType | null;
  latest_entry_date?: string | null;
  days_since_update?: number;
  is_stale?: boolean;
  is_missing_next_action?: boolean;
  is_overdue_next_action?: boolean;
  recent_activity?: Record<string, number>;
  timeline_entries?: JournalEntry[];
  ideas?: JournalIdea[];
  mindmap_layout?: MindMapLayoutData;
}
