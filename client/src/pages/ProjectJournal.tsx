import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api } from '../api/client';
import { getJstTodayStr, formatJstTime, getJstDateKey } from '../utils/dateTime';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { TranslateButton } from '../components/common/TranslateButton';
import { useContentTranslation } from '../hooks/useContentTranslation';
import { loadFullWidthMap, setDocFullWidthPref, FullWidthMap } from '../utils/docWidthPrefs';
import {
  BookMarked,
  Plus,
  Lock,
  Users,
  Send,
  Flame,
  Hourglass,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  MessageSquare,
  Compass,
  Lightbulb,
  ArrowRight,
  Trash2,
  Edit2,
  ArrowLeft,
  ArrowRightLeft,
  Inbox,
  BarChart3,
  LayoutGrid,
  ListOrdered,
  Sparkles,
  Calendar,
  Search,
  RefreshCw,
  GitBranch,
  Move,
  Settings,
  UserPlus,
  X,
  KeyRound,
  Copy,
  Check,
  Share2,
  History,
  CornerDownRight,
} from 'lucide-react';
import { JournalHorizontalTimeline } from '../components/journal/JournalHorizontalTimeline';
import { JournalMindMap } from '../components/journal/JournalMindMap';
import { JournalFreeMindMap } from '../components/journal/JournalFreeMindMap';
import {
  CreateJournalEntryPayload,
  CreateJournalIdeaPayload,
  ROOT_SUBTOPIC_KEY,
  cleanTopicMilestoneTitle,
  isCurrentFocusIntentEntry,
  isTopicMilestoneEntry,
} from '../components/journal/mindmapUtils';
import {
  JournalMode,
  PartnerType,
  TurnState,
  EntryType,
  IdeaStatus,
  JournalParticipant,
  JournalProject,
  JournalEntry,
  JournalIdea,
  MindMapLayoutData,
} from '../components/journal/types';
import { CollabSpace, CrossLinkBadge } from '../types/spaces';
import { MindmapSendSource, SendFromMindmapModal } from '../components/spaces/SendFromMindmapModal';

/** Format timeline date/time compactly as YY.MM.DD HH:MM. */
function formatCompactTimelineDateTime(
  dateStr: string,
  timeStr: string
): { compact: string; full: string } {
  const full = `${dateStr}${timeStr ? `${dateStr ? ' ' : ''}${timeStr}` : ''}`;
  const shortDate = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? `${dateStr.slice(2, 4)}.${dateStr.slice(5, 7)}.${dateStr.slice(8, 10)}`
    : dateStr;
  const compact = `${shortDate}${timeStr ? `${shortDate ? ' ' : ''}${timeStr}` : ''}`;
  return { compact, full };
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10); // jst-ignore: pure YYYY-MM-DD calendar arithmetic
}

interface JournalInboxItem {
  id: number;
  content: string;
  linked_project_id: number | null;
  is_processed: number;
  author_id: number;
  created_at: string;
}

const COLOR_PRESETS = ['#1B4D3E', '#0369A1', '#7C3AED', '#C2410C', '#B45309', '#334155'];

interface ProjectJournalProps {
  pendingInviteToken?: string | null;
  onConsumePendingInvite?: () => void;
  initialProjectId?: number | null;
  onConsumeInitialProjectId?: () => void;
  spaces?: CollabSpace[];
  activeSpaceId?: number | null;
  onJumpToSpaceThought?: (spaceId: number, thoughtId: number) => void;
  onJumpToSpaceEvent?: (spaceId: number, eventId: number, startDate?: string) => void;
  onSpacesNeedRefresh?: () => void;
  realtimeTick?: number;
}

export const ProjectJournal: React.FC<ProjectJournalProps> = ({
  pendingInviteToken,
  onConsumePendingInvite,
  initialProjectId,
  onConsumeInitialProjectId,
  spaces = [],
  activeSpaceId = null,
  onJumpToSpaceThought,
  onJumpToSpaceEvent,
  onSpacesNeedRefresh,
  realtimeTick = 0,
}) => {
  const { user } = useAuth();
  const { L, t } = useLanguage();
  const tr = useContentTranslation();

  const [projects, setProjects] = useState<JournalProject[]>([]);
  const [inbox, setInbox] = useState<JournalInboxItem[]>([]);
  const [todayJst, setTodayJst] = useState<string>(getJstTodayStr);
  const [isLoading, setIsLoading] = useState(true);

  // Filters & Views
  const [viewMode, setViewMode] = useState<'BOARD' | 'PRIORITY' | 'VISUAL'>('BOARD');
  const [visualSubTab, setVisualSubTab] = useState<'TIMELINE' | 'MINDMAP' | 'FREEMAP'>('TIMELINE');
  const [mindMapProjectId, setMindMapProjectId] = useState<number | 'ALL'>('ALL');
  const [turnFilter, setTurnFilter] = useState<'ALL' | 'MY_TURN' | 'THEIR_TURN' | 'STALE' | 'CLOSED'>('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | 'SOLO' | 'COLLAB'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Quick 3-sec Inbox
  const [inboxText, setInboxText] = useState('');
  const [isSavingInbox, setIsSavingInbox] = useState(false);
  const [assigningInboxId, setAssigningInboxId] = useState<number | null>(null);
  const [assignProjectId, setAssignProjectId] = useState<string>('');
  const [assignTargetKind, setAssignTargetKind] = useState<'DIALOGUE_ME' | 'DIALOGUE_THEM' | 'INTENT' | 'PROGRESS' | 'IDEA'>('INTENT');
  const inboxInputRef = useRef<HTMLInputElement>(null);

  // Selected Project Detail State
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [fullWidthMap, setFullWidthMap] = useState<FullWidthMap>(() =>
    loadFullWidthMap('nygc_journal_full_width_map')
  );
  const [detailProject, setDetailProject] = useState<JournalProject | null>(null);
  const [detailEntries, setDetailEntries] = useState<JournalEntry[]>([]);
  const [detailIdeas, setDetailIdeas] = useState<JournalIdea[]>([]);
  const [spaceBridgeSource, setSpaceBridgeSource] = useState<MindmapSendSource | null>(null);
  const [spaceBridgeToast, setSpaceBridgeToast] = useState('');
  const [projectSpaceLinks, setProjectSpaceLinks] = useState<CrossLinkBadge[]>([]);
  const [ideaSpaceLinks, setIdeaSpaceLinks] = useState<Record<number, CrossLinkBadge[]>>({});
  const [entrySpaceLinks, setEntrySpaceLinks] = useState<Record<number, CrossLinkBadge[]>>({});
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailSubTab, setDetailSubTab] = useState<'TIMELINE' | 'MINDMAP' | 'FREEMAP'>('TIMELINE');
  const [lastMindMapTab, setLastMindMapTab] = useState<'MINDMAP' | 'FREEMAP'>('MINDMAP');
  const [focusMindMapNodeKey, setFocusMindMapNodeKey] = useState<string | null>(null);
  const [highlightTimelineKey, setHighlightTimelineKey] = useState<string | null>(null);
  const [entryFilter, setEntryFilter] = useState<'ALL' | 'DIALOGUE' | 'INTENT' | 'IDEA' | 'PROGRESS'>('ALL');
  const [entrySortDesc, setEntrySortDesc] = useState(true);

  // Unified Timeline Composer State (Na / Them / Intent / Idea / Progress)
  const [composerKind, setComposerKind] = useState<EntryType | 'IDEA'>('INTENT');
  const [timelineParentNodeKey, setTimelineParentNodeKey] = useState<string | null>(null);
  const [autoSwitchTurnOnSubmit, setAutoSwitchTurnOnSubmit] = useState(false);
  const [entryDate, setEntryDate] = useState<string>(getJstTodayStr);
  const [entryTime, setEntryTime] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [dueTime, setDueTime] = useState<string>('');
  const [entrySpeaker, setEntrySpeaker] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [completedTarget, setCompletedTarget] = useState<string>(''); // '' | 'ENTRY:123' | 'IDEA:45'
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editingIdeaId, setEditingIdeaId] = useState<number | null>(null);
  const [revisionFormEntryId, setRevisionFormEntryId] = useState<number | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [isSubmittingRevision, setIsSubmittingRevision] = useState(false);
  const [showTheirTurnPanel, setShowTheirTurnPanel] = useState(false);
  const [pendingTurnTargetUserId, setPendingTurnTargetUserId] = useState<number | null>(null);
  const [pendingWaitDays, setPendingWaitDays] = useState<string>('');
  const [isSavingTurnSwitch, setIsSavingTurnSwitch] = useState(false);
  const [isAddingEntry, setIsAddingEntry] = useState(false);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const entryContentRef = useRef<HTMLTextAreaElement>(null);
  const ideaTitleRef = useRef<HTMLInputElement>(null);

  // Idea fields inside Unified Timeline Composer
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaNote, setIdeaNote] = useState('');
  const [isAddingIdea, setIsAddingIdea] = useState(false);

  // Stakeholders / Participants Preset Modal State
  const [isParticipantsModalOpen, setIsParticipantsModalOpen] = useState(false);
  const [participantsDraft, setParticipantsDraft] = useState<JournalParticipant[]>([]);
  const [newParticipantName, setNewParticipantName] = useState('');
  const [newParticipantRole, setNewParticipantRole] = useState('');
  const [isSavingParticipants, setIsSavingParticipants] = useState(false);
  const [speakerCustomInput, setSpeakerCustomInput] = useState(false);

  // Inline Intent Edit & Initial Intent Peek State
  const [isEditingIntent, setIsEditingIntent] = useState(false);
  const [intentDraft, setIntentDraft] = useState('');
  const [showInitialIntent, setShowInitialIntent] = useState(false);
  const [isSavingIntent, setIsSavingIntent] = useState(false);

  // Inline Next Step Edit State
  const [isEditingNextStep, setIsEditingNextStep] = useState(false);
  const [nextStepDraft, setNextStepDraft] = useState('');
  const [nextStepDateDraft, setNextStepDateDraft] = useState('');

  // Create / Edit Project Modal
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<JournalProject | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formMode, setFormMode] = useState<JournalMode>('SOLO');
  const [formPartnerType, setFormPartnerType] = useState<PartnerType>('SHARED');
  const [formPartnerName, setFormPartnerName] = useState('');
  const [formIntent, setFormIntent] = useState('');
  const [formTurnState, setFormTurnState] = useState<TurnState>('MY_TURN');
  const [formNextAction, setFormNextAction] = useState('');
  const [formNextActionDate, setFormNextActionDate] = useState('');
  const [formThresholdDays, setFormThresholdDays] = useState(7);
  const [formColor, setFormColor] = useState('#1B4D3E');
  const [isSubmittingProject, setIsSubmittingProject] = useState(false);

  // Modal Sub-Tabs (Join merged into New Project modal, Invite/Members merged into People modal)
  const [projectModalTab, setProjectModalTab] = useState<'CREATE' | 'JOIN'>('CREATE');
  const [participantsModalTab, setParticipantsModalTab] = useState<'STAKEHOLDERS' | 'COLLAB'>('STAKEHOLDERS');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [isInvitingMember, setIsInvitingMember] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoiningByCode, setIsJoiningByCode] = useState(false);

  const loadProjectSpaceLinks = useCallback(async (pid: number | null) => {
    if (!pid) {
      setProjectSpaceLinks([]);
      setIdeaSpaceLinks({});
      setEntrySpaceLinks({});
      return;
    }
    try {
      const res = await api.get<{
        projectLinks: CrossLinkBadge[];
        ideaLinksById: Record<number, CrossLinkBadge[]>;
        entryLinksById: Record<number, CrossLinkBadge[]>;
      }>(`/spaces/links/project/${pid}`);
      setProjectSpaceLinks(res.projectLinks || []);
      setIdeaSpaceLinks(res.ideaLinksById || {});
      setEntrySpaceLinks(res.entryLinksById || {});
    } catch {
      setProjectSpaceLinks([]);
      setIdeaSpaceLinks({});
      setEntrySpaceLinks({});
    }
  }, []);

  useEffect(() => {
    void loadProjectSpaceLinks(selectedProjectId);
    if (selectedProjectId && realtimeTick > 0) {
      api
        .get<{ project: JournalProject; entries: JournalEntry[]; ideas: JournalIdea[] }>(
          `/journal/projects/${selectedProjectId}`
        )
        .then((res) => {
          setDetailProject(res.project);
          setDetailEntries(res.entries || []);
          setDetailIdeas(res.ideas || []);
        })
        .catch(() => {});
    }
  }, [selectedProjectId, realtimeTick, loadProjectSpaceLinks]);

  const showSpaceBridgeToast = useCallback((msg: string) => {
    setSpaceBridgeToast(msg);
    window.setTimeout(() => {
      setSpaceBridgeToast((cur) => (cur === msg ? '' : cur));
    }, 3000);
  }, []);

  const fetchOverview = async (keepSelection = true) => {
    try {
      setIsLoading(true);
      const res = await api.get<{ projects: JournalProject[]; inbox: JournalInboxItem[]; todayJst: string }>('/journal/overview');
      const list = res?.projects || [];
      setProjects(list);
      setInbox(res?.inbox || []);
      if (res?.todayJst) setTodayJst(res.todayJst);
      if (keepSelection && selectedProjectId) {
        const stillExists = list.some(p => p.id === selectedProjectId);
        if (!stillExists) {
          navigateProjectSelection(null);
          setDetailProject(null);
        }
      }
    } catch (err) {
      console.error('Failed to load project journal overview:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProjectDetail = async (projectId: number) => {
    try {
      setIsDetailLoading(true);
      const res = await api.get<{ project: JournalProject; entries: JournalEntry[]; ideas: JournalIdea[] }>(
        `/journal/projects/${projectId}`
      );
      setDetailProject(res.project);
      setDetailEntries(res.entries || []);
      setDetailIdeas(res.ideas || []);
      setIntentDraft(res.project.intent_summary || '');
      setNextStepDraft(res.project.next_action || '');
      setNextStepDateDraft(res.project.next_action_date || '');
    } catch (err: any) {
      console.error('Failed to load project detail:', err);
      alert(err.message || t('common.error'));
    } finally {
      setIsDetailLoading(false);
    }
  };

  const navigateProjectSelection = useCallback((nextId: number | null) => {
    try {
      const currHistoryPid = Number(window.history.state?.journalProjectId || 0);
      if (nextId !== null) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('project', String(nextId));
        if (currHistoryPid > 0) {
          window.history.replaceState(
            { ...(window.history.state || {}), journalProjectId: nextId },
            '',
            nextUrl.pathname + nextUrl.search
          );
        } else {
          const listUrl = new URL(window.location.href);
          listUrl.searchParams.delete('project');
          window.history.replaceState(
            { ...(window.history.state || {}), journalProjectId: null },
            '',
            listUrl.pathname + listUrl.search
          );
          window.history.pushState(
            { ...(window.history.state || {}), journalProjectId: nextId },
            '',
            nextUrl.pathname + nextUrl.search
          );
        }
        setSelectedProjectId(nextId);
      } else {
        if (currHistoryPid > 0) {
          window.history.back();
          return;
        }
        const listUrl = new URL(window.location.href);
        listUrl.searchParams.delete('project');
        window.history.replaceState(
          { ...(window.history.state || {}), journalProjectId: null },
          '',
          listUrl.pathname + listUrl.search
        );
        setSelectedProjectId(null);
      }
    } catch {
      setSelectedProjectId(nextId);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const handlePopState = (ev: PopStateEvent) => {
      try {
        const statePid = Number(ev.state?.journalProjectId || 0);
        const urlPid = Number(new URLSearchParams(window.location.search).get('project') || 0);
        const pid = statePid > 0 ? statePid : urlPid;
        setSelectedProjectId(Number.isInteger(pid) && pid > 0 ? pid : null);
      } catch {
        setSelectedProjectId(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!initialProjectId || !user) return;
    navigateProjectSelection(initialProjectId);
    onConsumeInitialProjectId?.();
  }, [initialProjectId, user?.id, onConsumeInitialProjectId, navigateProjectSelection]);

  useEffect(() => {
    if (!pendingInviteToken || !user) return;
    const acceptInvite = async () => {
      try {
        const res = await api.post<{ project_id: number }>('/journal/invites/accept', {
          token: pendingInviteToken,
        });
        await fetchOverview();
        if (res?.project_id) {
          navigateProjectSelection(res.project_id);
        }
      } catch (err: any) {
        alert(err.message || t('common.error'));
      } finally {
        onConsumePendingInvite?.();
      }
    };
    void acceptInvite();
  }, [pendingInviteToken, user?.id]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectDetail(selectedProjectId);
      setIsEditingIntent(false);
      setShowInitialIntent(false);
      setIsEditingNextStep(false);
      setCompletedTarget('');
      setEditingEntryId(null);
      setEditingIdeaId(null);
      setIdeaTitle('');
      setIdeaNote('');
      setRevisionFormEntryId(null);
      setRevisionReason('');
      setSpeakerCustomInput(false);
      setEntrySpeaker('');
      setEntryContent('');
      setEntryDate(getJstTodayStr());
      setEntryTime('');
      setDueDate('');
      setDueTime('');
      setShowTheirTurnPanel(false);
      setPendingTurnTargetUserId(null);
      setPendingWaitDays('');
      setTimelineParentNodeKey(null);
      setFocusMindMapNodeKey(null);
    } else {
      setDetailProject(null);
      setDetailEntries([]);
      setDetailIdeas([]);
      setEditingEntryId(null);
      setEditingIdeaId(null);
      setIdeaTitle('');
      setIdeaNote('');
      setRevisionFormEntryId(null);
      setRevisionReason('');
      setFocusMindMapNodeKey(null);
    }
  }, [selectedProjectId]);

  const isCurrentFullWidth = selectedProjectId ? Boolean(fullWidthMap[String(selectedProjectId)]) : false;
  const handleToggleProjectFullWidth = () => {
    if (!selectedProjectId) return;
    setFullWidthMap(prev =>
      setDocFullWidthPref('nygc_journal_full_width_map', prev, selectedProjectId, !prev[String(selectedProjectId)])
    );
  };

  // Dashboard Counters
  const counters = useMemo(() => {
    return {
      myTurn: projects.filter(p => p.turn_state === 'MY_TURN').length,
      theirTurn: projects.filter(p => p.turn_state === 'THEIR_TURN').length,
      stale: projects.filter(p => p.is_stale).length,
      closed: projects.filter(p => p.turn_state === 'DONE' || p.turn_state === 'HOLD').length,
    };
  }, [projects]);

  // Filtered & Priority-Sorted Projects
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = projects.filter(p => {
      if (modeFilter !== 'ALL' && p.mode !== modeFilter) return false;
      if (turnFilter === 'MY_TURN' && p.turn_state !== 'MY_TURN') return false;
      if (turnFilter === 'THEIR_TURN' && p.turn_state !== 'THEIR_TURN') return false;
      if (turnFilter === 'STALE' && !p.is_stale) return false;
      if (turnFilter === 'CLOSED' && p.turn_state !== 'DONE' && p.turn_state !== 'HOLD') return false;
      if (q) {
        const hay = `${p.title} ${p.intent_summary || ''} ${p.next_action || ''} ${p.resolved_partner_name || ''} ${p.latest_entry_content || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      const aStale = a.is_stale ? 0 : 1;
      const bStale = b.is_stale ? 0 : 1;
      if (aStale !== bStale) return aStale - bStale;
      const aDone = a.turn_state === 'DONE' ? 1 : 0;
      const bDone = b.turn_state === 'DONE' ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return (b.days_since_update || 0) - (a.days_since_update || 0);
    });
  }, [projects, modeFilter, turnFilter, searchQuery]);

  // Quick Inbox Actions
  const handleAddInbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboxText.trim()) return;
    try {
      setIsSavingInbox(true);
      await api.post('/journal/inbox', { content: inboxText.trim() });
      setInboxText('');
      await fetchOverview();
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSavingInbox(false);
    }
  };

  const handleAssignInbox = async (inboxId: number) => {
    if (!assignProjectId) {
      alert(L('배치할 프로젝트를 선택해주세요.', '割り当てるプロジェクトを選択してください。', 'Please select a target project.'));
      return;
    }
    try {
      await api.post(`/journal/inbox/${inboxId}/assign`, {
        project_id: Number(assignProjectId),
        target_kind: assignTargetKind,
      });
      setAssigningInboxId(null);
      await fetchOverview();
      if (selectedProjectId === Number(assignProjectId)) {
        await fetchProjectDetail(selectedProjectId);
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleDeleteInbox = async (inboxId: number) => {
    try {
      await api.delete(`/journal/inbox/${inboxId}`);
      setInbox(prev => prev.filter(i => i.id !== inboxId));
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  // Project Modal Openers
  const handleOpenCreateModal = () => {
    setEditingProject(null);
    setProjectModalTab('CREATE');
    setJoinCodeInput('');
    setJoinError('');
    setFormTitle('');
    setFormMode('SOLO');
    setFormPartnerType('SHARED');
    setFormPartnerName('');
    setFormIntent('');
    setFormTurnState('MY_TURN');
    setFormNextAction('');
    setFormNextActionDate('');
    setFormThresholdDays(7);
    setFormColor('#1B4D3E');
    setIsProjectModalOpen(true);
  };

  const handleOpenEditModal = (proj: JournalProject) => {
    setEditingProject(proj);
    setFormTitle(proj.title);
    setFormMode(proj.mode);
    setFormPartnerType(proj.partner_type === 'EXTERNAL' ? 'EXTERNAL' : 'SHARED');
    setFormPartnerName(proj.partner_name || '');
    setFormIntent(proj.intent_summary || '');
    setFormTurnState(proj.turn_state);
    setFormNextAction(proj.next_action || '');
    setFormNextActionDate(proj.next_action_date || '');
    setFormThresholdDays(proj.stale_threshold_days || 7);
    setFormColor(proj.color || '#1B4D3E');
    setIsProjectModalOpen(true);
  };

  const handleSubmitProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;
    try {
      setIsSubmittingProject(true);
      const payload = {
        title: formTitle.trim(),
        mode: formMode,
        partner_type: formMode === 'SOLO' ? 'NONE' : formPartnerType,
        partner_name: formMode === 'COLLAB' && formPartnerType === 'EXTERNAL' ? formPartnerName.trim() : null,
        intent_summary: formIntent.trim() || null,
        turn_state: formTurnState,
        next_action: formNextAction.trim() || null,
        next_action_date: formNextActionDate || null,
        stale_threshold_days: formThresholdDays,
        color: formColor,
      };

      if (editingProject) {
        await api.patch(`/journal/projects/${editingProject.id}`, payload);
        await fetchOverview();
        if (selectedProjectId === editingProject.id) {
          await fetchProjectDetail(editingProject.id);
        }
      } else {
        const created = await api.post<JournalProject>('/journal/projects', payload);
        await fetchOverview();
        if (created?.id) navigateProjectSelection(created.id);
      }
      setIsProjectModalOpen(false);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSubmittingProject(false);
    }
  };

  // Generic Collaboration & Invite Actions
  const getInviteUrl = (token?: string | null) => {
    if (!token) return '';
    return `${window.location.origin}/?invite=${token}`;
  };

  const handleCopyInviteLink = async (token?: string | null) => {
    const url = getInviteUrl(token);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      prompt(L('아래 초대 링크를 복사해 주세요:', '招待リンクをコピー:', 'Copy invite link:'), url);
    }
  };

  const handleRegenerateInvite = async () => {
    if (!detailProject) return;
    try {
      await api.post(`/journal/projects/${detailProject.id}/invite/regenerate`);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleInviteMemberByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailProject || !inviteEmail.trim()) return;
    setInviteError('');
    try {
      setIsInvitingMember(true);
      await api.post(`/journal/projects/${detailProject.id}/members`, { email: inviteEmail.trim() });
      setInviteEmail('');
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      setInviteError(err.message || t('common.error'));
    } finally {
      setIsInvitingMember(false);
    }
  };

  const handleRemoveMember = async (memberUserId: number) => {
    if (!detailProject) return;
    try {
      await api.delete(`/journal/projects/${detailProject.id}/members/${memberUserId}`);
      await fetchOverview();
      if (memberUserId === Number(user?.id)) {
        setIsParticipantsModalOpen(false);
        navigateProjectSelection(null);
      } else {
        await fetchProjectDetail(detailProject.id);
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleJoinByInviteCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setJoinError('');
    try {
      setIsJoiningByCode(true);
      const res = await api.post<{ project_id: number }>('/journal/invites/accept', {
        token: joinCodeInput.trim(),
      });
      setIsProjectModalOpen(false);
      setJoinCodeInput('');
      await fetchOverview();
      if (res?.project_id) {
        navigateProjectSelection(res.project_id);
      }
    } catch (err: any) {
      setJoinError(err.message || t('common.error'));
    } finally {
      setIsJoiningByCode(false);
    }
  };

  const getOtherAppTurnTargets = (proj: JournalProject): Array<{ user_id: number; name: string }> => {
    if (proj.mode !== 'COLLAB') return [];
    const seen = new Set<number>();
    const list: Array<{ user_id: number; name: string }> = [];
    const myId = Number(user?.id || 0);
    const pushIfOther = (uid: number | undefined | null, name?: string | null) => {
      const n = Number(uid || 0);
      if (!n || n === myId || seen.has(n)) return;
      seen.add(n);
      list.push({ user_id: n, name: (name || '').trim() || `User #${n}` });
    };
    pushIfOther(proj.created_by, proj.creator_name);
    for (const m of proj.members || []) {
      pushIfOther(m.user_id, m.name);
    }
    return list;
  };

  const handleQuickTurnChange = async (
    projectId: number,
    nextTurn: TurnState,
    targetTurnUserId?: number | null,
    waitDays?: number | null
  ) => {
    if (nextTurn === 'THEIR_TURN' && waitDays === undefined && targetTurnUserId === undefined) {
      const proj = detailProject?.id === projectId ? detailProject : projects.find((p) => p.id === projectId);
      if (proj) {
        const targets = getOtherAppTurnTargets(proj);
        const currentTarget =
          targets.find((tg) => Number(proj.active_turn_user_id) === tg.user_id) || targets[0] || null;
        setPendingTurnTargetUserId(currentTarget ? currentTarget.user_id : null);
        setPendingWaitDays(proj.my_turn_wait ? String(proj.my_turn_wait.wait_days) : '');
        setShowTheirTurnPanel((prev) => !prev);
        return;
      }
    }
    try {
      setIsSavingTurnSwitch(true);
      await api.patch(`/journal/projects/${projectId}`, {
        turn_state: nextTurn,
        ...(targetTurnUserId ? { target_turn_user_id: targetTurnUserId } : {}),
        ...(waitDays !== undefined ? { turn_wait_days: waitDays } : {}),
      });
      setShowTheirTurnPanel(false);
      await fetchOverview();
      if (selectedProjectId === projectId) {
        await fetchProjectDetail(projectId);
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSavingTurnSwitch(false);
    }
  };

  const handleConfirmTheirTurn = async () => {
    if (!detailProject) return;
    const cleaned = pendingWaitDays.trim();
    const parsedNum = cleaned === '' ? null : Number(cleaned);
    if (parsedNum !== null && (!Number.isFinite(parsedNum) || parsedNum < 1 || parsedNum > 90)) {
      alert(
        L(
          '대기 기간은 1~90일 사이로 입력하거나 설정 안 함을 선택해 주세요.',
          '待機日数は1〜90日の間で入力してください。',
          'Wait duration must be between 1 and 90 days.'
        )
      );
      return;
    }
    const waitDaysPayload = parsedNum === null ? null : Math.round(parsedNum);
    await handleQuickTurnChange(
      detailProject.id,
      'THEIR_TURN',
      pendingTurnTargetUserId || undefined,
      waitDaysPayload
    );
  };

  const handleClearTurnWait = async (projectId: number) => {
    try {
      setIsSavingTurnSwitch(true);
      await api.patch(`/journal/projects/${projectId}`, {
        turn_wait_days: null,
      });
      await fetchOverview();
      if (selectedProjectId === projectId) {
        await fetchProjectDetail(projectId);
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSavingTurnSwitch(false);
    }
  };

  const handleSaveNextStep = async () => {
    if (!detailProject) return;
    try {
      await api.patch(`/journal/projects/${detailProject.id}`, {
        next_action: nextStepDraft.trim() || null,
        next_action_date: nextStepDateDraft || null,
      });
      setIsEditingNextStep(false);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleSaveIntent = async () => {
    if (!detailProject) return;
    try {
      setIsSavingIntent(true);
      await api.patch(`/journal/projects/${detailProject.id}`, {
        intent_summary: intentDraft.trim() || null,
      });
      setIsEditingIntent(false);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSavingIntent(false);
    }
  };

  const handleDeleteProject = async (proj: JournalProject) => {
    const msg = L(
      `'${proj.title}' 프로젝트와 모든 기록을 삭제하시겠습니까?`,
      `「${proj.title}」とすべての記録を削除しますか？`,
      `Delete '${proj.title}' and all its logs?`
    );
    if (!confirm(msg)) return;
    try {
      await api.delete(`/journal/projects/${proj.id}`);
      if (selectedProjectId === proj.id) {
        navigateProjectSelection(null);
      }
      await fetchOverview();
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  // Unified Timeline Submit (Entry OR Idea)
  const handleAddTimelineItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailProject) return;

    if (composerKind === 'IDEA') {
      if (!ideaTitle.trim()) return;
      try {
        setIsAddingIdea(true);
        if (editingIdeaId) {
          await api.patch(`/journal/ideas/${editingIdeaId}`, {
            title: ideaTitle.trim(),
            note: ideaNote.trim() || null,
          });
          setEditingIdeaId(null);
        } else {
          const parentIdeaId =
            timelineParentNodeKey && timelineParentNodeKey.startsWith('idea-')
              ? Number(timelineParentNodeKey.slice(5))
              : null;
          const created = await api.post<JournalIdea>(`/journal/projects/${detailProject.id}/ideas`, {
            title: ideaTitle.trim(),
            note: ideaNote.trim() || null,
            parent_idea_id: parentIdeaId,
            parent_node_key: parentIdeaId ? null : timelineParentNodeKey,
          });
          if (timelineParentNodeKey && created?.id) {
            setTimelineParentNodeKey(`idea-${created.id}`);
          }
        }
        setIdeaTitle('');
        setIdeaNote('');
        await fetchOverview();
        await fetchProjectDetail(detailProject.id);
      } catch (err: any) {
        alert(err.message || t('common.error'));
      } finally {
        setIsAddingIdea(false);
      }
      return;
    }

    if (!entryContent.trim()) return;

    let completed_target_type: 'ENTRY' | 'IDEA' | undefined;
    let completed_target_id: number | undefined;
    if (composerKind === 'PROGRESS' && completedTarget) {
      const [tType, tIdStr] = completedTarget.split(':');
      const tId = Number(tIdStr);
      if ((tType === 'ENTRY' || tType === 'IDEA') && Number.isInteger(tId) && tId > 0) {
        completed_target_type = tType;
        completed_target_id = tId;
      }
    }

    try {
      setIsAddingEntry(true);
      const payload = {
        entry_type: composerKind,
        speaker_name:
          composerKind === 'DIALOGUE_THEM'
            ? entrySpeaker.trim() || detailProject.resolved_partner_name || null
            : null,
        content: entryContent.trim(),
        entry_date: entryDate || '',
        entry_time: entryTime || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        completed_target_type: completed_target_type ?? null,
        completed_target_id: completed_target_id ?? null,
        parent_node_key: editingEntryId ? undefined : timelineParentNodeKey,
        ...(!editingEntryId && autoSwitchTurnOnSubmit && composerKind === 'DIALOGUE_ME'
          ? { next_turn_state: 'THEIR_TURN' as const }
          : !editingEntryId && autoSwitchTurnOnSubmit && composerKind === 'DIALOGUE_THEM'
          ? { next_turn_state: 'MY_TURN' as const }
          : {}),
      };
      if (editingEntryId) {
        await api.patch(`/journal/entries/${editingEntryId}`, payload);
      } else {
        const created = await api.post<JournalEntry>(`/journal/projects/${detailProject.id}/entries`, payload);
        if (timelineParentNodeKey && created?.id) {
          setTimelineParentNodeKey(`entry-${created.id}`);
        }
      }
      setEditingEntryId(null);
      setAutoSwitchTurnOnSubmit(false);
      setEntryContent('');
      setEntrySpeaker('');
      setCompletedTarget('');
      setEntryDate(getJstTodayStr());
      setEntryTime('');
      setDueDate('');
      setDueTime('');
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsAddingEntry(false);
    }
  };

  const handleStartEditEntry = (en: JournalEntry) => {
    setEditingIdeaId(null);
    setIdeaTitle('');
    setIdeaNote('');
    setEditingEntryId(en.id);
    setComposerKind(en.entry_type);
    setEntrySpeaker(en.speaker_name || '');
    setSpeakerCustomInput(Boolean(en.speaker_name));
    setEntryDate(en.entry_date || '');
    setEntryTime(en.entry_time || '');
    setDueDate(en.due_date || '');
    setDueTime(en.due_time || '');
    setEntryContent(en.content || '');
    setCompletedTarget(
      en.completed_target_type && en.completed_target_id
        ? `${en.completed_target_type}:${en.completed_target_id}`
        : ''
    );
    setDetailSubTab('TIMELINE');
    setTimeout(() => {
      composerFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      entryContentRef.current?.focus();
    }, 30);
  };

  const handleStartEditIdea = (idea: JournalIdea) => {
    setEditingEntryId(null);
    setEntryContent('');
    setEntrySpeaker('');
    setCompletedTarget('');
    setEditingIdeaId(idea.id);
    setComposerKind('IDEA');
    setIdeaTitle(idea.title || '');
    setIdeaNote(idea.note || '');
    setDetailSubTab('TIMELINE');
    setTimeout(() => {
      composerFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ideaTitleRef.current?.focus();
    }, 30);
  };

  const handleCancelEditEntry = () => {
    setEditingEntryId(null);
    setEditingIdeaId(null);
    setEntryContent('');
    setEntrySpeaker('');
    setCompletedTarget('');
    setEntryDate(getJstTodayStr());
    setEntryTime('');
    setDueDate('');
    setDueTime('');
    setIdeaTitle('');
    setIdeaNote('');
  };

  const handleSubmitRevisionRequest = async (entryId: number) => {
    if (!detailProject || !revisionReason.trim()) return;
    try {
      setIsSubmittingRevision(true);
      await api.post(`/journal/entries/${entryId}/revision-request`, {
        reason: revisionReason.trim(),
      });
      setRevisionFormEntryId(null);
      setRevisionReason('');
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSubmittingRevision(false);
    }
  };

  const handleResolveRevisionRequest = async (requestId: number) => {
    if (!detailProject) return;
    try {
      await api.patch(`/journal/revision-requests/${requestId}/resolve`, {});
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleCancelRevisionRequest = async (requestId: number) => {
    if (!detailProject) return;
    try {
      await api.delete(`/journal/revision-requests/${requestId}`);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleStartCompleteTarget = (targetKey: string) => {
    setComposerKind('PROGRESS');
    setCompletedTarget(targetKey);
    setEntryDate(getJstTodayStr());
    setEntryTime('');
    setDueDate('');
    setDueTime('');
    setTimeout(() => {
      composerFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      entryContentRef.current?.focus();
    }, 30);
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!detailProject) return;
    if (!confirm(L('이 기록을 삭제하시겠습니까?', 'この記録を削除しますか？', 'Delete this entry?'))) return;
    try {
      await api.delete(`/journal/entries/${entryId}`);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleDeleteIdea = async (ideaId: number) => {
    if (!detailProject) return;
    if (!confirm(L('이 아이디어를 삭제하시겠습니까?', 'このアイデアを削除しますか？', 'Delete this idea?'))) return;
    try {
      await api.delete(`/journal/ideas/${ideaId}`);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  // Mind Map Interactive Handlers (usable in both global MindMap & project detail MindMap)
  const refreshAfterIdeaChange = async (projectId: number) => {
    await fetchOverview();
    if (selectedProjectId === projectId) {
      await fetchProjectDetail(projectId);
    }
  };

  const handleMindMapAddIdea = async (payload: CreateJournalIdeaPayload): Promise<JournalIdea | null> => {
    try {
      const created = await api.post<JournalIdea>(`/journal/projects/${payload.projectId}/ideas`, {
        title: payload.title,
        note: payload.note,
        parent_idea_id: payload.parent_idea_id,
        parent_node_key: payload.parent_node_key ?? null,
      });
      await refreshAfterIdeaChange(payload.projectId);
      return created;
    } catch (err: any) {
      alert(err.message || t('common.error'));
      return null;
    }
  };

  const handleMindMapAddEntry = async (payload: CreateJournalEntryPayload): Promise<JournalEntry | null> => {
    try {
      const created = await api.post<JournalEntry>(`/journal/projects/${payload.projectId}/entries`, {
        entry_type: payload.entry_type,
        speaker_name: payload.speaker_name,
        content: payload.content,
        entry_date: payload.entry_date,
        entry_time: payload.entry_time,
        due_date: payload.due_date,
        due_time: payload.due_time,
        completed_target_type: payload.completed_target_type,
        completed_target_id: payload.completed_target_id,
        parent_node_key: payload.parent_node_key ?? null,
        ...(payload.next_turn_state ? { next_turn_state: payload.next_turn_state } : {}),
      });
      await refreshAfterIdeaChange(payload.projectId);
      return created;
    } catch (err: any) {
      alert(err.message || t('common.error'));
      return null;
    }
  };

  const handleMindMapEditEntry = async (
    en: JournalEntry,
    updates: { content: string; speaker_name?: string | null }
  ) => {
    try {
      await api.patch(`/journal/entries/${en.id}`, {
        entry_type: en.entry_type,
        speaker_name: updates.speaker_name !== undefined ? updates.speaker_name : en.speaker_name,
        content: updates.content,
        entry_date: en.entry_date,
        entry_time: en.entry_time,
        due_date: en.due_date ?? null,
        due_time: en.due_time ?? null,
        completed_target_type: en.completed_target_type ?? null,
        completed_target_id: en.completed_target_id ?? null,
      });
      await refreshAfterIdeaChange(en.project_id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapDeleteEntry = async (entryId: number) => {
    try {
      await api.delete(`/journal/entries/${entryId}`);
      await fetchOverview();
      if (selectedProjectId) {
        await fetchProjectDetail(selectedProjectId);
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapPromoteEntryToNextStep = async (en: JournalEntry) => {
    try {
      const nextActionText = cleanTopicMilestoneTitle(en.content).slice(0, 120);
      if (!nextActionText) return;
      await api.patch(`/journal/projects/${en.project_id}`, {
        next_action: nextActionText,
        ...(en.due_date ? { next_action_date: en.due_date } : {}),
      });
      await refreshAfterIdeaChange(en.project_id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapSetNextStep = async (
    projectId: number,
    nextAction: string,
    nextActionDate: string | null
  ) => {
    try {
      const nextActionText = nextAction.trim();
      if (!nextActionText) return;
      await api.patch(`/journal/projects/${projectId}`, {
        next_action: nextActionText,
        next_action_date: nextActionDate || null,
      });
      await refreshAfterIdeaChange(projectId);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleJumpFromTimelineToMindMap = (nodeKey: string) => {
    setDetailSubTab('MINDMAP');
    setLastMindMapTab('MINDMAP');
    setFocusMindMapNodeKey(nodeKey);
  };

  const handleJumpFromMindMapToTimeline = (nodeKey: string) => {
    setDetailSubTab('TIMELINE');
    setEntryFilter('ALL');
    setHighlightTimelineKey(nodeKey);
    setTimeout(() => {
      const el = document.getElementById(`tl-node-${nodeKey}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => {
      setHighlightTimelineKey((prev) => (prev === nodeKey ? null : prev));
    }, 2400);
  };

  const handleMindMapToggleLink = async (ideaId: number, targetIdeaId: number, projectId: number) => {
    try {
      await api.patch(`/journal/ideas/${ideaId}`, { toggle_related_idea_id: targetIdeaId });
      await refreshAfterIdeaChange(projectId);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapPromoteIdea = async (idea: JournalIdea) => {
    try {
      await api.patch(`/journal/ideas/${idea.id}`, { promoteToNextStep: true });
      await refreshAfterIdeaChange(idea.project_id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapUpdateIdeaStatus = async (idea: JournalIdea, status: IdeaStatus) => {
    try {
      await api.patch(`/journal/ideas/${idea.id}`, { status });
      await refreshAfterIdeaChange(idea.project_id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleMindMapDeleteIdea = async (idea: JournalIdea) => {
    try {
      await api.delete(`/journal/ideas/${idea.id}`);
      await refreshAfterIdeaChange(idea.project_id);
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  const handleSaveMindMapLayout = async (projectId: number, layout: MindMapLayoutData) => {
    try {
      const saved = await api.put<MindMapLayoutData>(`/journal/projects/${projectId}/mindmap-layout`, layout);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, mindmap_layout: saved } : p))
      );
      setDetailProject((prev) =>
        prev && prev.id === projectId ? { ...prev, mindmap_layout: saved } : prev
      );
    } catch (err: any) {
      alert(err.message || t('common.error'));
    }
  };

  // Stakeholders / Participants & Collab Modal Handlers
  const handleOpenParticipantsModal = (initialTab: 'STAKEHOLDERS' | 'COLLAB' = 'STAKEHOLDERS') => {
    if (!detailProject) return;
    const baseList = [...(detailProject.participants || [])];
    if (
      detailProject.resolved_partner_name &&
      !baseList.some((p) => p.name.toLowerCase() === detailProject.resolved_partner_name!.toLowerCase())
    ) {
      baseList.unshift({ name: detailProject.resolved_partner_name, role: L('협업 상대', '相手', 'Partner') });
    }
    setParticipantsDraft(baseList);
    setNewParticipantName('');
    setNewParticipantRole('');
    setInviteEmail('');
    setInviteError('');
    setParticipantsModalTab(initialTab);
    setIsParticipantsModalOpen(true);
  };

  const handleAddDraftParticipant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmedName = newParticipantName.trim();
    if (!trimmedName) return;
    if (participantsDraft.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      setNewParticipantName('');
      return;
    }
    const trimmedRole = newParticipantRole.trim();
    setParticipantsDraft((prev) => [
      ...prev,
      trimmedRole ? { name: trimmedName, role: trimmedRole } : { name: trimmedName },
    ]);
    setNewParticipantName('');
    setNewParticipantRole('');
  };

  const handleSaveParticipants = async () => {
    if (!detailProject) return;
    // Also flush pending input if user typed a name without clicking '+'
    let finalList = [...participantsDraft];
    const pendingName = newParticipantName.trim();
    if (pendingName && !finalList.some((p) => p.name.toLowerCase() === pendingName.toLowerCase())) {
      const pendingRole = newParticipantRole.trim();
      finalList.push(pendingRole ? { name: pendingName, role: pendingRole } : { name: pendingName });
    }

    try {
      setIsSavingParticipants(true);
      await api.patch(`/journal/projects/${detailProject.id}`, {
        participants: finalList,
      });
      setIsParticipantsModalOpen(false);
      await fetchOverview();
      await fetchProjectDetail(detailProject.id);
      if (finalList.length > 0) {
        setSpeakerCustomInput(false);
        if (!entrySpeaker.trim()) {
          setEntrySpeaker(finalList[0].name);
        }
      }
    } catch (err: any) {
      alert(err.message || t('common.error'));
    } finally {
      setIsSavingParticipants(false);
    }
  };

  const getTurnBadge = (turn: TurnState, partnerName?: string | null) => {
    switch (turn) {
      case 'MY_TURN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-900 border border-rose-300 whitespace-nowrap">
            <Flame className="w-3 h-3 text-rose-600" />
            <span>{L('내 턴', '自分のターン', 'My Turn')}</span>
          </span>
        );
      case 'THEIR_TURN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-sky-100 text-sky-900 border border-sky-300 whitespace-nowrap">
            <Hourglass className="w-3 h-3 text-sky-700" />
            <span>
              {partnerName
                ? L(`상대 턴(${partnerName})`, `相手ターン(${partnerName})`, `Their Turn (${partnerName})`)
                : L('상대 턴', '相手ターン', 'Their Turn')}
            </span>
          </span>
        );
      case 'HOLD':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-700 border border-stone-300 whitespace-nowrap">
            <PauseCircle className="w-3 h-3 text-stone-500" />
            <span>{L('보류/장기', '保留・長期', 'On Hold')}</span>
          </span>
        );
      case 'DONE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 whitespace-nowrap">
            <CheckCircle2 className="w-3 h-3 text-emerald-700" />
            <span>{L('완료', '完了', 'Done')}</span>
          </span>
        );
    }
  };

  const completedTargetsMap = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const en of detailEntries) {
      if (en.entry_type === 'PROGRESS' && en.completed_target_type && en.completed_target_id) {
        const key = `${en.completed_target_type}:${en.completed_target_id}`;
        const list = map.get(key) || [];
        list.push(en);
        map.set(key, list);
      }
    }
    return map;
  }, [detailEntries]);

  type UnifiedTimelineItem =
    | { kind: 'ENTRY'; id: number; sortKey: string; entry: JournalEntry }
    | { kind: 'IDEA'; id: number; dateKey: string; timeKey: string; sortKey: string; idea: JournalIdea };

  const allUnifiedItems = useMemo<UnifiedTimelineItem[]>(() => {
    const items: UnifiedTimelineItem[] = [];
    for (const en of detailEntries) {
      const sortDate = en.entry_date || getJstDateKey(en.created_at) || todayJst;
      const sortTime = en.entry_time || formatJstTime(en.created_at) || '00:00';
      items.push({
        kind: 'ENTRY',
        id: en.id,
        sortKey: `${sortDate} ${sortTime} E${String(en.id).padStart(8, '0')}`,
        entry: en,
      });
    }
    for (const idea of detailIdeas) {
      const dateKey = getJstDateKey(idea.created_at) || todayJst;
      const timeKey = formatJstTime(idea.created_at) || '00:00';
      items.push({
        kind: 'IDEA',
        id: idea.id,
        dateKey,
        timeKey,
        sortKey: `${dateKey} ${timeKey} I${String(idea.id).padStart(8, '0')}`,
        idea,
      });
    }
    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return items;
  }, [detailEntries, detailIdeas, todayJst]);

  const filteredDetailTimeline = useMemo(() => {
    const filtered = allUnifiedItems.filter((item) => {
      if (entryFilter === 'ALL') return true;
      if (entryFilter === 'IDEA') return item.kind === 'IDEA';
      if (item.kind !== 'ENTRY') return false;
      if (entryFilter === 'DIALOGUE') {
        return item.entry.entry_type === 'DIALOGUE_ME' || item.entry.entry_type === 'DIALOGUE_THEM';
      }
      if (entryFilter === 'INTENT') return item.entry.entry_type === 'INTENT';
      if (entryFilter === 'PROGRESS') return item.entry.entry_type === 'PROGRESS';
      return true;
    });
    return entrySortDesc ? [...filtered].reverse() : filtered;
  }, [allUnifiedItems, entryFilter, entrySortDesc]);

  // Recent 10 completable targets across [Me / Partner / Intent / Idea] (newest first)
  const progressTargetOptions = useMemo(() => {
    const candidates = allUnifiedItems
      .filter((item) => item.kind === 'IDEA' || item.entry.entry_type !== 'PROGRESS')
      .slice()
      .reverse()
      .map((item) => {
        if (item.kind === 'IDEA') {
          return {
            key: `IDEA:${item.idea.id}`,
            tag: L('💡 아이디어', '💡 アイデア', '💡 Idea'),
            date: item.dateKey.slice(5),
            text: item.idea.title,
          };
        }
        const en = item.entry;
        const tag =
          en.entry_type === 'DIALOGUE_ME'
            ? L('🗣️ 나', '🗣️ 自分', '🗣️ Me')
            : en.entry_type === 'DIALOGUE_THEM'
            ? `👤 ${en.speaker_name || L('상대', '相手', 'Partner')}`
            : L('🧭 의도·결정', '🧭 意図', '🧭 Intent');
        return {
          key: `ENTRY:${en.id}`,
          tag,
          date: en.entry_date ? en.entry_date.slice(5) : getJstDateKey(en.created_at).slice(5),
          text: en.content,
        };
      });

    const top10 = candidates.slice(0, 10);
    if (completedTarget && !top10.some((o) => o.key === completedTarget)) {
      const match = candidates.find((o) => o.key === completedTarget);
      if (match) return [match, ...top10];
    }
    return top10;
  }, [allUnifiedItems, completedTarget, L]);

  const focusedMindMapProject = useMemo(
    () =>
      mindMapProjectId === 'ALL'
        ? null
        : projects.find((p) => p.id === mindMapProjectId) || null,
    [projects, mindMapProjectId]
  );

  const renderProjectCard = (p: JournalProject) => {
    const isSelected = selectedProjectId === p.id;
    const isOwner = Number(p.created_by) === Number(user?.id);
    return (
      <div
        key={p.id}
        onClick={() => navigateProjectSelection(p.id)}
        className={`p-3 rounded-xl border transition cursor-pointer flex flex-col gap-2 ${
          isSelected
            ? 'bg-forest-50/70 border-forest-700 ring-2 ring-forest-700/30 shadow-xs'
            : p.is_stale
            ? 'bg-amber-50/40 border-amber-300 hover:border-amber-400 shadow-2xs'
            : 'bg-white border-ivory-300 hover:border-forest-400 shadow-2xs'
        }`}
      >
        {/* Top badges */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {p.mode === 'SOLO' || p.is_private === 1 ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-stone-100 text-stone-700 border border-stone-300">
                <Lock className="w-2.5 h-2.5" />
                <span>{p.mode === 'SOLO' ? L('개인 비공개', '個人非公開', 'Solo Private') : L('비공개 협업', '非公開協業', 'Private Collab')}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                <Users className="w-2.5 h-2.5" />
                <span>
                  {p.partner_type === 'EXTERNAL'
                    ? L('외부 협업', '外部協業', 'External Collab')
                    : L('협업', '協業', 'Collab')}
                </span>
              </span>
            )}
            {getTurnBadge(p.turn_state, p.active_turn_user_name || p.resolved_partner_name)}
            {p.turn_state === 'THEIR_TURN' && p.my_turn_wait && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
                  p.my_turn_wait.is_overdue
                    ? 'bg-rose-50 text-rose-700 border-rose-300'
                    : 'bg-sky-50 text-sky-800 border-sky-200'
                }`}
                title={L('본인에게만 보이는 개인 대기 알림', '本人のみに表示される個人待機アラート', 'Private wait reminder (only visible to you)')}
              >
                <Lock className="w-2.5 h-2.5 shrink-0" />
                {p.my_turn_wait.is_overdue
                  ? L(`대기초과 (${p.my_turn_wait.wait_days}일)`, `待機超過 (${p.my_turn_wait.wait_days}日)`, `Overdue (${p.my_turn_wait.wait_days}d)`)
                  : `~${p.my_turn_wait.target_date.slice(5)} (D-${p.my_turn_wait.days_remaining})`}
              </span>
            )}
          </div>

          <span
            className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
              p.is_stale
                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                : 'bg-ivory-100 text-charcoal-600'
            }`}
          >
            D+{p.days_since_update ?? 0}
          </span>
        </div>

        {/* Title & Intent */}
        <div className="flex items-start gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
            style={{ backgroundColor: p.color || '#1B4D3E' }}
          />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-charcoal-900 leading-snug break-words">
              {tr.getText(`jproj-${p.id}`, 'title', p.title)}
            </h3>
            {p.resolved_partner_name && (
              <div className="text-[11px] font-semibold text-sky-800 mt-0.5">
                {L('협업 상대:', '相手:', 'Partner:')} {p.resolved_partner_name}
                {!isOwner && p.creator_name ? ` (${L('작성:', '作成:', 'By:')} ${p.creator_name})` : ''}
              </div>
            )}
          </div>
          <TranslateButton
            size="xs"
            visible={tr.shouldShowButton(p.title, p.next_action)}
            translated={tr.isTranslated(`jproj-${p.id}`)}
            loading={tr.isTranslating(`jproj-${p.id}`)}
            error={tr.getError(`jproj-${p.id}`)}
            onClick={(e) => {
              e.stopPropagation();
              void tr.toggleTranslate(`jproj-${p.id}`, {
                title: p.title,
                next_action: p.next_action || '',
              }, 'journal');
            }}
          />
        </div>

        {/* Next Step or Missing Alert */}
        {p.next_action ? (
          <div className="px-2 py-1.5 rounded-lg bg-ivory-50 border border-ivory-200 text-xs flex items-start gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-forest-700 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-bold text-charcoal-900 break-words">
                {tr.getText(`jproj-${p.id}`, 'next_action', p.next_action)}
              </span>
              {p.next_action_date && (
                <span className={`ml-1.5 font-mono text-[11px] font-bold ${p.is_overdue_next_action ? 'text-rose-600' : 'text-charcoal-500'}`}>
                  ({p.next_action_date})
                </span>
              )}
            </div>
          </div>
        ) : p.turn_state !== 'DONE' && p.turn_state !== 'HOLD' ? (
          <div className="px-2 py-1 rounded-lg bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>{L('Next Step 미지정 (방치 위험)', 'Next Step未設定', 'Missing Next Step')}</span>
          </div>
        ) : null}

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[11px] text-charcoal-500 pt-1 border-t border-ivory-100">
          <div className="flex items-center gap-2 font-mono">
            <span>{L(`기록 ${p.entry_count || 0}`, `記録 ${p.entry_count || 0}`, `Logs ${p.entry_count || 0}`)}</span>
            <span>·</span>
            <span>{L(`아이디어 ${p.open_idea_count || 0}`, `アイデア ${p.open_idea_count || 0}`, `Ideas ${p.open_idea_count || 0}`)}</span>
          </div>
          {p.latest_entry_date && (
            <span className="font-mono">{p.latest_entry_date}</span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-full space-y-2.5 sm:space-y-3 overflow-x-hidden pb-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#E6E2D8]">
        <div>
          <div className="flex items-center gap-2">
            <BookMarked className="w-6 h-6 text-forest-700 shrink-0" />
            <h1 className="text-xl font-bold text-charcoal-900 break-keep">
              {L('프로젝트 마인드맵', 'プロジェクトマインドマップ', 'Project Mindmap')}
            </h1>
          </div>
          <p className="text-xs text-charcoal-500 mt-0.5 break-keep">
            {L(
              '개인 비공개 중장기 프로젝트의 의도·생각 보존 및 협업 상대와의 대화·턴·방치 관리',
              '個人非公開の中長期プロジェクトの意図保存と、協業相手との対話・ターン・放置管理',
              'Preserve intent & ideas on private solo projects and track dialogue turns with collaborators.'
            )}
          </p>
        </div>

        <div className="w-full sm:w-auto flex flex-col items-stretch sm:items-end gap-1.5 shrink-0">
          <div className="w-full sm:w-auto flex items-center flex-wrap gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchOverview()}
              className="flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{L('새로고침', '更新', 'Refresh')}</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenCreateModal}
              className="flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{L('새 프로젝트', '新規プロジェクト', 'New Project')}</span>
            </Button>
            {selectedProjectId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigateProjectSelection(null)}
                className="sm:hidden ml-auto flex items-center gap-1 font-bold whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{L('목록으로', '一覧へ戻る', 'Back to List')}</span>
              </Button>
            )}
          </div>

          {selectedProjectId && (
            <div className="hidden sm:flex lg:hidden justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigateProjectSelection(null)}
                className="flex items-center gap-1.5 font-bold whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{L('목록으로', '一覧へ戻る', 'Back to List')}</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 3-Second Quick Capture Inbox Bar */}
      <div className="space-y-2.5">
        <form onSubmit={handleAddInbox} className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Inbox className="w-4 h-4 text-forest-700 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={inboxInputRef}
              type="text"
              value={inboxText}
              onChange={(e) => setInboxText(e.target.value)}
              placeholder={L(
                '3초 빠른 메모: 떠오른 아이디어·상대방 한마디·할 일을 분류 없이 일단 던져두세요 (본인만 보임)',
                '3秒メモ：思いつきや相手の言葉をまずここに入力（本人のみ閲覧可）',
                '3-sec quick capture: jot down an idea or quote first (private to you)'
              )}
              className="w-full pl-9 pr-3 py-2 bg-ivory-50 border border-ivory-300 rounded-lg text-xs font-medium text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-forest-600/40"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" isLoading={isSavingInbox} className="shrink-0 whitespace-nowrap">
            <Send className="w-3.5 h-3.5" />
            <span>{L('던져두기', '保存', 'Capture')}</span>
          </Button>
        </form>

        {inbox.length > 0 && (
          <div className="pt-2 border-t border-ivory-200 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-charcoal-600">
              <span>{L(`미분류 인박스 (${inbox.length}건)`, `未分類インボックス (${inbox.length}件)`, `Unassigned Inbox (${inbox.length})`)}</span>
              <span className="text-charcoal-400 font-normal">
                {L('나중에 프로젝트에 연결하세요', '後からプロジェクトへ分類できます', 'Assign to a project anytime')}
              </span>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {inbox.map(item => (
                <div key={item.id} className="p-2 rounded-lg bg-amber-50/70 border border-amber-200 text-xs space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-charcoal-900 break-words flex-1">
                      {tr.getText(`jinbox-${item.id}`, 'content', item.content)}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <TranslateButton
                        size="xs"
                        visible={tr.shouldShowButton(item.content)}
                        translated={tr.isTranslated(`jinbox-${item.id}`)}
                        loading={tr.isTranslating(`jinbox-${item.id}`)}
                        error={tr.getError(`jinbox-${item.id}`)}
                        onClick={() => tr.toggleTranslate(`jinbox-${item.id}`, { content: item.content }, 'journal')}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setAssigningInboxId(assigningInboxId === item.id ? null : item.id);
                          setAssignProjectId(selectedProjectId ? String(selectedProjectId) : '');
                        }}
                        className="px-2 py-0.5 rounded bg-forest-800 text-white font-bold text-[11px] whitespace-nowrap"
                      >
                        {L('배치', '振分', 'Assign')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteInbox(item.id)}
                        className="p-1 text-charcoal-400 hover:text-rose-600 rounded"
                        title={L('삭제', '削除', 'Delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {assigningInboxId === item.id && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-amber-200/80">
                      <select
                        value={assignProjectId}
                        onChange={(e) => setAssignProjectId(e.target.value)}
                        className="p-1 bg-white border border-amber-300 rounded text-[11px] font-bold max-w-[180px]"
                      >
                        <option value="">{L('-- 프로젝트 선택 --', '-- プロジェクト選択 --', '-- Select Project --')}</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.title}</option>
                        ))}
                      </select>
                      <select
                        value={assignTargetKind}
                        onChange={(e) => setAssignTargetKind(e.target.value as any)}
                        className="p-1 bg-white border border-amber-300 rounded text-[11px] font-bold"
                      >
                        <option value="INTENT">{L('내 의도·메모', '自分の意図', 'My Intent')}</option>
                        <option value="DIALOGUE_ME">{L('대화: 나', '対話: 自分', 'Quote: Me')}</option>
                        <option value="DIALOGUE_THEM">{L('대화: 상대방', '対話: 相手', 'Quote: Partner')}</option>
                        <option value="PROGRESS">{L('진행 완료', '完了記録', 'Done')}</option>
                        <option value="IDEA">{L('아이디어 노트로', 'アイデアへ', 'To Ideas')}</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => handleAssignInbox(item.id)}
                        className="px-2 py-1 rounded bg-emerald-700 text-white font-bold text-[11px]"
                      >
                        {L('확정', '確定', 'Apply')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {!selectedProjectId && (
        <>
      {/* 4-Card Forget-Prevention Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setTurnFilter(prev => prev === 'MY_TURN' ? 'ALL' : 'MY_TURN')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
            turnFilter === 'MY_TURN'
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400/40'
              : 'bg-white border-ivory-300 hover:border-rose-300'
          }`}
        >
          <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{L('내 턴', '自分のターン', 'My Turn')}</span>
          </span>
          <span className="text-lg font-black font-mono text-rose-700">{counters.myTurn}</span>
        </button>

        <button
          type="button"
          onClick={() => setTurnFilter(prev => prev === 'THEIR_TURN' ? 'ALL' : 'THEIR_TURN')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
            turnFilter === 'THEIR_TURN'
              ? 'bg-sky-50 border-sky-400 ring-2 ring-sky-400/40'
              : 'bg-white border-ivory-300 hover:border-sky-300'
          }`}
        >
          <span className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
            <Hourglass className="w-4 h-4 text-sky-600 shrink-0" />
            <span>{L('상대 대기', '相手待ち', 'Waiting')}</span>
          </span>
          <span className="text-lg font-black font-mono text-sky-700">{counters.theirTurn}</span>
        </button>

        <button
          type="button"
          onClick={() => setTurnFilter(prev => prev === 'STALE' ? 'ALL' : 'STALE')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
            turnFilter === 'STALE'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/40'
              : counters.stale > 0
              ? 'bg-amber-50/60 border-amber-300 hover:border-amber-400'
              : 'bg-white border-ivory-300'
          }`}
        >
          <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{L('방치·미정', '放置・未定', 'Stale/Alert')}</span>
          </span>
          <span className={`text-lg font-black font-mono ${counters.stale > 0 ? 'text-amber-700' : 'text-charcoal-900'}`}>
            {counters.stale}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTurnFilter(prev => prev === 'CLOSED' ? 'ALL' : 'CLOSED')}
          className={`p-2.5 sm:p-3 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
            turnFilter === 'CLOSED'
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/40'
              : 'bg-white border-ivory-300 hover:border-emerald-300'
          }`}
        >
          <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{L('완료·보류', '完了・保留', 'Done/Hold')}</span>
          </span>
          <span className="text-lg font-black font-mono text-emerald-700">{counters.closed}</span>
        </button>
      </div>

      {/* Filter & View Toolbar */}
      <div className="bg-white p-2 sm:p-2.5 lg:p-3 rounded-xl border border-ivory-300 shadow-2xs flex flex-col sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between gap-1.5 sm:gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-nowrap w-full sm:flex-1 sm:min-w-0">
          {/* Mode Filter */}
          <div className="bg-ivory-100 p-0.5 rounded-lg border border-ivory-300 flex items-center font-bold shrink-0">
            {(
              [
                { id: 'ALL', emoji: '', label: L('전체', 'すべて', 'All') },
                { id: 'SOLO', emoji: '🔒', label: L('개인', '個人', 'Solo') },
                { id: 'COLLAB', emoji: '🤝', label: L('협업', '協業', 'Collab') },
              ] as const
            ).map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModeFilter(m.id)}
                className={`px-2 md:px-2.5 py-1 rounded-md transition whitespace-nowrap ${
                  modeFilter === m.id ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
                }`}
              >
                {m.emoji && <span className="hidden md:inline mr-1">{m.emoji}</span>}
                <span>{m.label}</span>
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-0 lg:max-w-sm">
            <Search className="w-3.5 h-3.5 text-charcoal-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={L('제목·의도·상대방 검색...', '検索...', 'Search...')}
              className="w-full pl-7 pr-2.5 py-1 bg-ivory-50 border border-ivory-300 rounded-lg text-xs font-medium"
            />
          </div>

          {turnFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setTurnFilter('ALL')}
              className="px-2 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold whitespace-nowrap shrink-0"
            >
              <span className="sm:hidden">{L('해제', '解除', 'Reset')}</span>
              <span className="hidden sm:inline">{L('필터 해제', '解除', 'Reset')}</span>
            </button>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="w-full sm:w-auto bg-ivory-100 p-0.5 rounded-lg border border-ivory-300 grid grid-cols-3 sm:flex items-center font-bold shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('BOARD')}
            className={`px-1.5 sm:px-2 md:px-2.5 py-1 rounded-md flex items-center justify-center gap-1 transition whitespace-nowrap ${
              viewMode === 'BOARD' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
            <span>{L('턴 보드', 'ボード', 'Board')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('PRIORITY')}
            className={`px-1.5 sm:px-2 md:px-2.5 py-1 rounded-md flex items-center justify-center gap-1 transition whitespace-nowrap ${
              viewMode === 'PRIORITY' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5 shrink-0" />
            <span>{L('방치·목록', '一覧', 'Priority')}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('VISUAL')}
            className={`px-1.5 sm:px-2 md:px-2.5 py-1 rounded-md flex items-center justify-center gap-1 transition whitespace-nowrap ${
              viewMode === 'VISUAL' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 shrink-0" />
            <span>{L('시각화', '可視化', 'Visual')}</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Visualization View (Horizontal Timeline + Mind Map) OR Full-Width Board/Priority */}
      {viewMode === 'VISUAL' ? (
        <div className="space-y-3">
          {/* Visualization Sub-Mode Switcher */}
          <div className="bg-white p-2.5 rounded-xl border border-ivory-300 shadow-2xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-ivory-100 p-1 rounded-lg border border-ivory-200 text-xs font-bold flex-wrap">
              <button
                type="button"
                onClick={() => setVisualSubTab('TIMELINE')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                  visualSubTab === 'TIMELINE' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{L('가로 날짜 타임라인', '横型日付タイムライン', 'Horizontal Timeline')}</span>
              </button>
              <button
                type="button"
                onClick={() => setVisualSubTab('MINDMAP')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                  visualSubTab === 'MINDMAP' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>{L('관계 · 아이디어 마인드맵', 'ツリーマインドマップ', 'Tree Mind Map')}</span>
              </button>
              <button
                type="button"
                onClick={() => setVisualSubTab('FREEMAP')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition ${
                  visualSubTab === 'FREEMAP' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>{L('자유 마인드맵', 'フリーマインドマップ', 'Free Mind Map')}</span>
              </button>
            </div>

            {(visualSubTab === 'MINDMAP' || visualSubTab === 'FREEMAP') && (
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                <button
                  type="button"
                  onClick={() => setMindMapProjectId('ALL')}
                  className={`px-2.5 py-1 rounded-full border font-bold transition ${
                    mindMapProjectId === 'ALL'
                      ? 'bg-forest-800 text-white border-forest-900'
                      : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
                  }`}
                >
                  {L(`전체 지도 (${filteredProjects.length})`, `全体マップ (${filteredProjects.length})`, `All (${filteredProjects.length})`)}
                </button>
                {filteredProjects.map((proj) => (
                  <button
                    key={`mm-pick-${proj.id}`}
                    type="button"
                    onClick={() => setMindMapProjectId(proj.id)}
                    className={`px-2.5 py-1 rounded-full border font-bold transition inline-flex items-center gap-1.5 max-w-[180px] ${
                      mindMapProjectId === proj.id
                        ? 'bg-forest-800 text-white border-forest-900'
                        : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: proj.color }} />
                    <span className="truncate">{proj.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {visualSubTab === 'TIMELINE' ? (
            <JournalHorizontalTimeline
              projects={filteredProjects}
              todayJst={todayJst}
              onSelectProject={(id) => {
                navigateProjectSelection(id);
                setViewMode('BOARD');
              }}
            />
          ) : visualSubTab === 'MINDMAP' ? (
            <JournalMindMap
              project={focusedMindMapProject}
              entries={focusedMindMapProject?.timeline_entries || []}
              ideas={focusedMindMapProject?.ideas || []}
              allProjects={filteredProjects}
              currentUserId={user?.id}
              onFocusProject={(id) => setMindMapProjectId(id ?? 'ALL')}
              onOpenProjectDetail={(id) => {
                navigateProjectSelection(id);
                setDetailSubTab('MINDMAP');
                setViewMode('BOARD');
              }}
              onSaveLayout={handleSaveMindMapLayout}
              onAddIdea={handleMindMapAddIdea}
              onAddEntry={handleMindMapAddEntry}
              onEditEntry={handleMindMapEditEntry}
              onDeleteEntry={handleMindMapDeleteEntry}
              onPromoteEntryToNextStep={handleMindMapPromoteEntryToNextStep}
              onSetNextStep={handleMindMapSetNextStep}
              onToggleRelatedIdea={handleMindMapToggleLink}
              onPromoteIdea={handleMindMapPromoteIdea}
              onUpdateIdeaStatus={handleMindMapUpdateIdeaStatus}
              onDeleteIdea={handleMindMapDeleteIdea}
              focusNodeKey={focusMindMapNodeKey}
              onSelectNodeKey={setFocusMindMapNodeKey}
            />
          ) : (
            <JournalFreeMindMap
              project={focusedMindMapProject}
              entries={focusedMindMapProject?.timeline_entries || []}
              ideas={focusedMindMapProject?.ideas || []}
              allProjects={filteredProjects}
              currentUserId={user?.id}
              onFocusProject={(id) => setMindMapProjectId(id ?? 'ALL')}
              onOpenProjectDetail={(id) => {
                navigateProjectSelection(id);
                setDetailSubTab('FREEMAP');
                setViewMode('BOARD');
              }}
              onSaveLayout={handleSaveMindMapLayout}
              onAddIdea={handleMindMapAddIdea}
              onAddEntry={handleMindMapAddEntry}
              onEditEntry={handleMindMapEditEntry}
              onDeleteEntry={handleMindMapDeleteEntry}
              onPromoteEntryToNextStep={handleMindMapPromoteEntryToNextStep}
              onSetNextStep={handleMindMapSetNextStep}
              onPromoteIdea={handleMindMapPromoteIdea}
              onUpdateIdeaStatus={handleMindMapUpdateIdeaStatus}
              onDeleteIdea={handleMindMapDeleteIdea}
              focusNodeKey={focusMindMapNodeKey}
              onSelectNodeKey={setFocusMindMapNodeKey}
            />
          )}
        </div>
      ) : (
        /* Full-width Board or Priority List (no left/right split waste) */
        <div className="space-y-3">
          {isLoading ? (
            <div className="bg-white p-10 rounded-xl border border-ivory-300 text-center text-xs text-charcoal-400">
              {t('common.loading')}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="bg-white p-10 rounded-xl border border-ivory-300 text-center space-y-2">
              <p className="text-xs text-charcoal-500">
                {L(
                  '등록된 프로젝트가 없습니다. 새 프로젝트를 만들어 기록을 시작해보세요!',
                  '登録されたプロジェクトがありません。新規プロジェクトを作成してみましょう。',
                  'No projects yet. Create one to start preserving context and turns!'
                )}
              </p>
              <Button variant="primary" size="sm" onClick={handleOpenCreateModal}>
                <Plus className="w-4 h-4 mr-1" />
                {L('첫 프로젝트 만들기', '最初のプロジェクト作成', 'Create First Project')}
              </Button>
            </div>
          ) : viewMode === 'BOARD' ? (
            /* 4-Column Turn Swimlanes across full width */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {(
                [
                  { state: 'MY_TURN' as TurnState, title: L('🔥 내 턴 (할 일)', '🔥 自分のターン', '🔥 My Turn'), headerCls: 'bg-rose-50 text-rose-900 border-rose-200' },
                  { state: 'THEIR_TURN' as TurnState, title: L('⏳ 상대방 대기 중', '⏳ 相手待ち', '⏳ Waiting For'), headerCls: 'bg-sky-50 text-sky-900 border-sky-200' },
                  { state: 'HOLD' as TurnState, title: L('⏸️ 보류 / 장기 숙성', '⏸️ 保留・長期', '⏸️ On Hold'), headerCls: 'bg-stone-100 text-stone-800 border-stone-300' },
                  { state: 'DONE' as TurnState, title: L('✅ 완료 아카이브', '✅ 完了アーカイブ', '✅ Completed'), headerCls: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
                ]
              ).map(col => {
                const colItems = filteredProjects.filter(p => p.turn_state === col.state);
                return (
                  <div key={col.state} className="bg-ivory-50/70 rounded-xl border border-ivory-300 p-2.5 space-y-2">
                    <div className={`px-2.5 py-1.5 rounded-lg border text-xs font-black flex items-center justify-between ${col.headerCls}`}>
                      <span>{col.title}</span>
                      <span className="font-mono">{colItems.length}</span>
                    </div>
                    {colItems.length === 0 ? (
                      <div className="py-6 text-center text-[11px] text-charcoal-400">
                        {L('항목 없음', 'なし', 'Empty')}
                      </div>
                    ) : (
                      <div className="space-y-2">{colItems.map(renderProjectCard)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Full-width Priority / Stale Card Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredProjects.map(renderProjectCard)}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Option 1 + Notion Width Toggle: Centered (896px) <-> Full Width */}
      {selectedProjectId && (
        <div
          className={`border-t border-ivory-200 lg:border-t-0 pt-3 lg:pt-0 space-y-3 sm:space-y-4 transition-all duration-200 ${
            isCurrentFullWidth ? 'w-full max-w-full' : 'w-full max-w-4xl mx-auto'
          }`}
        >
          {/* Top Detail Action Bar (on <1024px Back button lives in Page Header) */}
          <div className="hidden lg:flex items-center justify-between gap-2 pb-2 border-b border-ivory-200">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigateProjectSelection(null)}
              className="inline-flex items-center gap-1.5 font-bold"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{L('목록으로', '一覧へ戻る', 'Back to List')}</span>
            </Button>

            <button
              type="button"
              onClick={handleToggleProjectFullWidth}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-bold transition whitespace-nowrap ${
                isCurrentFullWidth
                  ? 'bg-forest-800 text-white border-forest-900 shadow-2xs'
                  : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
              }`}
              title={L('본문 너비 전환 (표준 896px ↔ 전체 너비)', '表示幅を切替 (標準 896px ↔ 全幅)', 'Toggle page width')}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>{L('전체 너비', '全幅', 'Full Width')}</span>
            </button>
          </div>

          {/* Project Header & Edit/Delete (Title spans full width below badges/actions on mobile) */}
          <div className="!mt-0 lg:!mt-3 pb-2.5 border-b border-ivory-200 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  {detailProject?.mode === 'SOLO' || detailProject?.is_private === 1 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-stone-100 text-stone-700 border border-stone-300 whitespace-nowrap">
                      <span>{L('🔒 개인', '🔒 個人', '🔒 Solo')}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200 whitespace-nowrap">
                      <Users className="w-3 h-3 shrink-0" />
                      <span>
                        {detailProject?.members && detailProject.members.length > 0
                          ? L(`공유 협업 (${detailProject.members.length + 1}명)`, `共有協業 (${detailProject.members.length + 1}名)`, `Shared (${detailProject.members.length + 1})`)
                          : L('협업 트래킹', '協業トラッキング', 'Collab')}
                      </span>
                    </span>
                  )}

                  {detailProject?.resolved_partner_name && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-50 text-sky-900 border border-sky-200 whitespace-nowrap">
                      {L('상대:', '相手:', 'With:')} {detailProject.resolved_partner_name}
                    </span>
                  )}
                </div>

                {detailProject && (
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto flex-wrap">
                    <TranslateButton
                      size="xs"
                      visible={tr.shouldShowButton(
                        detailProject.title,
                        detailProject.intent_summary,
                        detailProject.initial_intent_summary,
                        detailProject.next_action
                      )}
                      translated={tr.isTranslated(`jproj-${detailProject.id}`)}
                      loading={tr.isTranslating(`jproj-${detailProject.id}`)}
                      error={tr.getError(`jproj-${detailProject.id}`)}
                      onClick={() =>
                        tr.toggleTranslate(
                          `jproj-${detailProject.id}`,
                          {
                            title: detailProject.title,
                            intent_summary: detailProject.intent_summary || '',
                            initial_intent_summary: detailProject.initial_intent_summary || '',
                            next_action: detailProject.next_action || '',
                          },
                          'journal'
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => handleOpenParticipantsModal('STAKEHOLDERS')}
                      className="px-2.5 py-1.5 rounded-lg bg-sky-50 text-sky-900 border border-sky-200 hover:bg-sky-100 text-xs font-bold inline-flex items-center gap-1 transition whitespace-nowrap"
                      title={L('관계자 명단 및 협업 초대·멤버 관리', '関係者・招待・メンバー管理', 'Configure stakeholders & invite members')}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>
                        {L(
                          `관계자 (${detailProject.participants?.length || 0})`,
                          `関係者 (${detailProject.participants?.length || 0})`,
                          `People (${detailProject.participants?.length || 0})`
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(detailProject)}
                      className="p-1.5 rounded-lg text-charcoal-500 hover:text-forest-700 hover:bg-ivory-100 transition"
                      title={t('common.edit')}
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {Number(detailProject.created_by) === Number(user?.id) && (
                      <button
                        type="button"
                        onClick={() => handleDeleteProject(detailProject)}
                        className="p-1.5 rounded-lg text-charcoal-500 hover:text-rose-600 hover:bg-rose-50 transition"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <h2 className="w-full text-lg sm:text-xl font-bold text-charcoal-900 break-words leading-snug">
                {detailProject
                  ? tr.getText(`jproj-${detailProject.id}`, 'title', detailProject.title)
                  : '...'}
              </h2>
            </div>

            {/* Detail Body */}
            <div className="space-y-4">

                {isDetailLoading || !detailProject ? (
                  <div className="py-10 text-center text-xs text-charcoal-400">{t('common.loading')}</div>
                ) : (
                  <>
                    {/* Editable Current Focus / Preserved Initial Intent Box */}
                    {(() => {
                      const isModified = Boolean(
                        detailProject.intent_modified === 1 ||
                          (detailProject.initial_intent_summary &&
                            detailProject.initial_intent_summary !== detailProject.intent_summary)
                      );
                      const initialText = detailProject.initial_intent_summary || '';
                      return (
                        <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                              <Compass className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                              <span>
                                {isModified
                                  ? L('현재 방향 · 핵심 메모 (Current Focus)', '現在の方針・メモ (Current Focus)', 'Current Direction & Focus')
                                  : L('최초 의도 · 왜 시작했나 (Pinned Intent)', '当初の意図・目的 (Pinned Intent)', 'Initial Intent · Why Started')}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isModified && initialText && (
                                <button
                                  type="button"
                                  onClick={() => setShowInitialIntent((v) => !v)}
                                  className="px-2 py-0.5 rounded-md bg-white/90 border border-amber-300 text-amber-900 text-[11px] font-bold hover:bg-amber-100 inline-flex items-center gap-1"
                                >
                                  <History className="w-3 h-3" />
                                  <span>
                                    {showInitialIntent
                                      ? L('최초 의도 닫기', '当初の意図を閉じる', 'Hide Initial')
                                      : L('최초 의도·왜 시작했나 보기', '当初の意図を見る', 'View Initial Intent')}
                                  </span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setIntentDraft(detailProject.intent_summary || '');
                                  setIsEditingIntent((prev) => !prev);
                                }}
                                className="px-2.5 py-0.5 rounded-md bg-amber-100/90 border border-amber-300 text-amber-950 text-[11px] font-bold hover:bg-amber-200/80 inline-flex items-center gap-1 shadow-2xs transition whitespace-nowrap"
                              >
                                {!isEditingIntent && <Edit2 className="w-3 h-3 shrink-0" />}
                                <span>{isEditingIntent ? t('common.cancel') : t('common.edit')}</span>
                              </button>
                            </div>
                          </div>

                          {isEditingIntent ? (
                            <div className="space-y-2">
                              <textarea
                                rows={3}
                                value={intentDraft}
                                onChange={(e) => setIntentDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleSaveIntent();
                                  }
                                }}
                                placeholder={L(
                                  '현재 진행 상황과 핵심 방향성을 수정·업데이트하세요 (최초 의도는 별도 보존됩니다).',
                                  '現在の方針やメモを更新してください（当初の意図は別途保持されます）。',
                                  'Update current direction (initial intent remains preserved).'
                                )}
                                className="w-full p-2 bg-white border border-amber-300 rounded-lg text-xs text-charcoal-900"
                              />
                              <div className="flex justify-end gap-1.5">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setIsEditingIntent(false)}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  isLoading={isSavingIntent}
                                  onClick={handleSaveIntent}
                                >
                                  {t('common.save')}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs font-medium text-charcoal-900 whitespace-pre-wrap leading-relaxed">
                              {detailProject.intent_summary
                                ? tr.getText(`jproj-${detailProject.id}`, 'intent_summary', detailProject.intent_summary)
                                : L(
                                    '아직 의도 메모가 없습니다. 수정 버튼을 눌러 배경/목표를 남겨두세요.',
                                    'まだ意図メモがありません。編集から登録してください。',
                                    'No intent memo yet. Click Edit to add.'
                                  )}
                            </p>
                          )}

                          {showInitialIntent && isModified && initialText && (
                            <div className="p-2.5 rounded-lg bg-white/90 border border-amber-300/80 space-y-1 text-xs">
                              <div className="text-[11px] font-bold text-amber-800 flex items-center gap-1">
                                <History className="w-3 h-3" />
                                <span>{L('최초 의도 · 왜 시작했나 (수정 전 원본 보존)', '当初の意図・始めた理由（原本保存）', 'Original Initial Intent (Preserved)')}</span>
                              </div>
                              <p className="text-charcoal-800 whitespace-pre-wrap leading-relaxed">
                                {tr.getText(`jproj-${detailProject.id}`, 'initial_intent_summary', initialText)}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 1-Tap Turn Switcher */}
                    {(() => {
                      const otherTargets = getOtherAppTurnTargets(detailProject);
                      const activeTurnName =
                        detailProject.turn_state === 'THEIR_TURN'
                          ? detailProject.active_turn_user_name || detailProject.resolved_partner_name
                          : '';
                      const theirLabel = activeTurnName
                        ? L(`⏳ 상대 턴(${activeTurnName})`, `⏳ 相手(${activeTurnName})`, `⏳ Theirs (${activeTurnName})`)
                        : L('⏳ 상대 턴', '⏳ 相手', '⏳ Theirs');
                      return (
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-bold text-charcoal-500 block">
                            {L('현재 턴 상태 (원클릭 전환)', '現在のターン (ワンタップ切替)', 'Current Turn (1-tap)')}
                          </span>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-bold">
                            {(
                              [
                                { state: 'MY_TURN' as TurnState, label: L('🔥 내 턴', '🔥 自分', '🔥 Mine'), activeCls: 'bg-rose-600 text-white border-rose-700' },
                                { state: 'THEIR_TURN' as TurnState, label: theirLabel, activeCls: 'bg-sky-600 text-white border-sky-700' },
                                { state: 'HOLD' as TurnState, label: L('⏸️ 보류', '⏸️ 保留', '⏸️ Hold'), activeCls: 'bg-stone-700 text-white border-stone-800' },
                                { state: 'DONE' as TurnState, label: L('✅ 완료', '✅ 完了', '✅ Done'), activeCls: 'bg-emerald-700 text-white border-emerald-800' },
                              ]
                            ).map(btn => (
                              <button
                                key={btn.state}
                                type="button"
                                onClick={() => handleQuickTurnChange(detailProject.id, btn.state)}
                                className={`py-1.5 px-1.5 rounded-lg border text-center transition truncate ${
                                  detailProject.turn_state === btn.state
                                    ? `${btn.activeCls} shadow-2xs`
                                    : 'bg-ivory-50 text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
                                }`}
                              >
                                {btn.label}
                              </button>
                            ))}
                          </div>
                          {/* Private Turn Wait Status Banner (Only visible to the user who set the wait) */}
                          {detailProject.turn_state === 'THEIR_TURN' && detailProject.my_turn_wait && !showTheirTurnPanel && (
                            <div
                              className={`p-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs ${
                                detailProject.my_turn_wait.is_overdue
                                  ? 'bg-rose-50/90 border-rose-300 text-rose-900'
                                  : 'bg-sky-50/80 border-sky-200 text-sky-900'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 flex-wrap font-bold">
                                <Lock className="w-3.5 h-3.5 shrink-0 opacity-75" />
                                <span>
                                  {detailProject.my_turn_wait.is_overdue
                                    ? L(
                                        `대기 기간(${detailProject.my_turn_wait.wait_days}일) 초과 · 목표일 ${detailProject.my_turn_wait.target_date} 경과 (${detailProject.my_turn_wait.days_elapsed}일째)`,
                                        `待機期間(${detailProject.my_turn_wait.wait_days}日)超過 · 目標日 ${detailProject.my_turn_wait.target_date} 経過 (${detailProject.my_turn_wait.days_elapsed}日目)`,
                                        `Wait period (${detailProject.my_turn_wait.wait_days}d) elapsed since ${detailProject.my_turn_wait.target_date} (${detailProject.my_turn_wait.days_elapsed}d total)`
                                      )
                                    : L(
                                        `나만의 대기 알림: ${detailProject.my_turn_wait.target_date}까지 (${detailProject.my_turn_wait.wait_days}일 대기 · D-${detailProject.my_turn_wait.days_remaining})`,
                                        `個人待機アラート: ${detailProject.my_turn_wait.target_date}まで (${detailProject.my_turn_wait.wait_days}日待機 · D-${detailProject.my_turn_wait.days_remaining})`,
                                        `Private wait reminder: until ${detailProject.my_turn_wait.target_date} (${detailProject.my_turn_wait.wait_days}d · D-${detailProject.my_turn_wait.days_remaining})`
                                      )}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleQuickTurnChange(detailProject.id, 'THEIR_TURN')}
                                  className="px-2 py-0.5 rounded bg-white border border-ivory-300 text-[11px] font-bold text-charcoal-700 hover:bg-ivory-100"
                                >
                                  {L('기간 변경', '変更', 'Edit')}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingTurnSwitch}
                                  onClick={() => handleClearTurnWait(detailProject.id)}
                                  className="px-2 py-0.5 rounded bg-white border border-rose-200 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                                >
                                  {L('알림 해제', '解除', 'Clear')}
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Their-Turn Handoff & Private Wait Duration Panel */}
                          {showTheirTurnPanel && (
                            <div className="p-3 rounded-xl bg-sky-50/90 border border-sky-200 space-y-3">
                              {otherTargets.length >= 2 && (
                                <div className="space-y-1.5">
                                  <span className="text-[11px] font-bold text-sky-900 block">
                                    {L('누구에게 턴을 넘길까요?', '誰にターンを渡しますか？', 'Pass turn to whom?')}
                                  </span>
                                  <div className="flex flex-wrap gap-1.5">
                                    {otherTargets.map(target => {
                                      const isSelected = pendingTurnTargetUserId === target.user_id;
                                      return (
                                        <button
                                          key={`turn-target-${target.user_id}`}
                                          type="button"
                                          onClick={() => setPendingTurnTargetUserId(target.user_id)}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                                            isSelected
                                              ? 'bg-sky-700 text-white border-sky-800 shadow-2xs'
                                              : 'bg-white text-sky-900 border-sky-300 hover:bg-sky-100'
                                          }`}
                                        >
                                          👤 {target.name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              <div className="space-y-1.5">
                                <span className="text-[11px] font-bold text-sky-950 flex items-center gap-1">
                                  <Hourglass className="w-3.5 h-3.5 text-sky-700" />
                                  <span>
                                    {L('며칠간 기다릴까요? (초과 시 나에게만 푸시알림)', '何日間待ちますか？ (超過時は自分のみに通知)', 'Wait how many days? (Private push to you if exceeded)')}
                                  </span>
                                </span>

                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setPendingWaitDays('')}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition ${
                                      pendingWaitDays === ''
                                        ? 'bg-charcoal-800 text-white border-charcoal-900'
                                        : 'bg-white text-charcoal-700 border-sky-200 hover:bg-sky-100'
                                    }`}
                                  >
                                    {L('설정 안 함', '設定しない', 'None')}
                                  </button>
                                  {[1, 2, 3, 5, 7, 14].map((d) => (
                                    <button
                                      key={`wait-preset-${d}`}
                                      type="button"
                                      onClick={() => setPendingWaitDays(String(d))}
                                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition tabular-nums ${
                                        pendingWaitDays === String(d)
                                          ? 'bg-sky-700 text-white border-sky-800'
                                          : 'bg-white text-sky-900 border-sky-200 hover:bg-sky-100'
                                      }`}
                                    >
                                      {L(`${d}일`, `${d}日`, `${d}d`)}
                                    </button>
                                  ))}
                                  <div className="inline-flex items-center gap-1 bg-white border border-sky-300 rounded-lg px-2 py-0.5">
                                    <input
                                      type="number"
                                      min={1}
                                      max={90}
                                      value={pendingWaitDays}
                                      onChange={(e) => setPendingWaitDays(e.target.value)}
                                      placeholder={L('직접', '入力', 'Custom')}
                                      className="w-12 text-xs font-bold text-center tabular-nums bg-transparent focus:outline-none text-charcoal-900"
                                    />
                                    <span className="text-[11px] font-bold text-charcoal-500">{L('일', '日', 'd')}</span>
                                  </div>
                                </div>

                                {(() => {
                                  const num = pendingWaitDays.trim() ? Number(pendingWaitDays.trim()) : 0;
                                  const isValidDays = Number.isFinite(num) && num >= 1 && num <= 90;
                                  const roundedDays = isValidDays ? Math.round(num) : 0;
                                  const previewDate = isValidDays ? addDaysToYmd(todayJst, roundedDays) : '';
                                  return (
                                    <div className="space-y-1 text-[11px]">
                                      {isValidDays ? (
                                        <p className="font-bold text-sky-900 tabular-nums">
                                          ⏰ {L(
                                            `${previewDate} (${roundedDays}일 후)까지 응답이 없으면 나에게 푸시알림이 옵니다.`,
                                            `${previewDate} (${roundedDays}日後)までに反応がなければ自分にプッシュ通知が届きます。`,
                                            `You will receive a push reminder if there is no turn return by ${previewDate} (${roundedDays}d).`
                                          )}
                                        </p>
                                      ) : (
                                        <p className="text-charcoal-500">
                                          {L('대기 알림 없이 상대 턴으로 전환합니다.', '待機アラートなしで相手ターンに切り替えます。', 'Switch to their turn without a wait reminder.')}
                                        </p>
                                      )}
                                      {detailProject.mode === 'COLLAB' && (
                                        <p className="text-sky-800/80 flex items-center gap-1">
                                          <Lock className="w-3 h-3 shrink-0" />
                                          <span>
                                            {L(
                                              '협업 프로젝트에서도 이 대기 기간과 초과 알림은 상대방에게 노출되지 않습니다.',
                                              '協業プロジェクトでもこの待機期間と通知は相手には表示されません。',
                                              'Your wait limit and overdue reminder are private and never shown to collaborators.'
                                            )}
                                          </span>
                                        </p>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-1 border-t border-sky-200/80">
                                <button
                                  type="button"
                                  onClick={() => setShowTheirTurnPanel(false)}
                                  className="px-3 py-1 rounded-lg bg-white border border-ivory-300 text-xs font-bold text-charcoal-600 hover:bg-ivory-100"
                                >
                                  {t('common.cancel')}
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingTurnSwitch}
                                  onClick={handleConfirmTheirTurn}
                                  className="px-3 py-1 rounded-lg bg-sky-700 text-white text-xs font-bold hover:bg-sky-800 disabled:opacity-50"
                                >
                                  {detailProject.turn_state === 'THEIR_TURN'
                                    ? L('적용 / 저장', '適用・保存', 'Save')
                                    : L('상대 턴으로 넘기기', '相手ターンへ渡す', 'Pass Turn')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Next Step Card */}
                    <div className={`p-3 rounded-xl border space-y-2 ${
                      !detailProject.next_action && detailProject.turn_state !== 'DONE' && detailProject.turn_state !== 'HOLD'
                        ? 'bg-rose-50/70 border-rose-300'
                        : 'bg-forest-50/60 border-forest-200'
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-black text-charcoal-900 flex items-center gap-1.5">
                          <ArrowRight className="w-4 h-4 text-forest-700" />
                          <span>{L('다음 할 일 (Next Step)', '次のアクション (Next Step)', 'Next Step')}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsEditingNextStep(prev => !prev)}
                          className="text-[11px] font-bold text-forest-800 hover:underline"
                        >
                          {isEditingNextStep ? t('common.cancel') : t('common.edit')}
                        </button>
                      </div>

                      {isEditingNextStep ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={nextStepDraft}
                            onChange={(e) => setNextStepDraft(e.target.value)}
                            placeholder={L('다음에 해야 할 구체적 행동 1줄', '次に行う具体的アクション', 'Specific next action')}
                            className="w-full p-2 bg-white border border-forest-300 rounded-lg text-xs font-bold"
                          />
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={nextStepDateDraft}
                              onChange={(e) => setNextStepDateDraft(e.target.value)}
                              className="p-1.5 bg-white border border-forest-300 rounded-lg text-xs font-mono font-bold"
                            />
                            <Button type="button" variant="primary" size="sm" onClick={handleSaveNextStep}>
                              {t('common.save')}
                            </Button>
                          </div>
                        </div>
                      ) : detailProject.next_action ? (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                          <span className="font-bold text-charcoal-900 break-words leading-snug">
                            {tr.getText(`jproj-${detailProject.id}`, 'next_action', detailProject.next_action)}
                          </span>
                          {detailProject.next_action_date && (
                            <span className="font-mono font-bold text-forest-800 bg-white px-2 py-0.5 rounded border border-forest-200 whitespace-nowrap shrink-0 self-start sm:self-auto">
                              <Calendar className="w-3 h-3 inline mr-1" />
                              {detailProject.next_action_date}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs font-bold text-rose-700">
                          {L('Next Step이 비어 있습니다. 수정 버튼으로 다음 할 일을 지정하세요!', 'Next Stepが未設定です。編集から登録してください。', 'No Next Step set — add one to prevent forgetting!')}
                        </p>
                      )}
                    </div>

                    {/* Mini Relay Flow Visualization (Mobile & Desktop: newest on left with ←) */}
                    {detailEntries.length > 0 && (() => {
                      const relayEntries = allUnifiedItems
                        .filter((item): item is Extract<UnifiedTimelineItem, { kind: 'ENTRY' }> => item.kind === 'ENTRY')
                        .map((item) => item.entry);
                      return (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold text-charcoal-500 block">
                          {L('진행 릴레이 흐름 (최근 기록)', '進行リレーの流れ', 'Relay Flow')}
                        </span>
                        {/* Latest first on the left, flowing leftward */}
                        <div className="flex items-center gap-1 overflow-x-auto pb-1">
                          {[...relayEntries].reverse().map((en, idx, arr) => {
                            const isTopic = isTopicMilestoneEntry(en);
                            const isFocus = isCurrentFocusIntentEntry(en);
                            const pillCls = isTopic
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-400'
                              : isFocus
                              ? 'bg-amber-100 text-amber-900 border border-amber-400'
                              : en.entry_type === 'DIALOGUE_ME'
                              ? 'bg-forest-700 text-white'
                              : en.entry_type === 'DIALOGUE_THEM'
                              ? 'bg-sky-100 text-sky-900 border border-sky-300'
                              : en.entry_type === 'PROGRESS'
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                              : 'bg-amber-100 text-amber-900 border border-amber-300';
                            const shortLbl = isTopic
                              ? L('🎯 토픽', '🎯 トピック', '🎯 Topic')
                              : isFocus
                              ? L('🧭 방향', '🧭 方向', '🧭 Focus')
                              : en.entry_type === 'DIALOGUE_ME'
                              ? L('나', '自分', 'Me')
                              : en.entry_type === 'DIALOGUE_THEM'
                              ? (en.speaker_name || L('상대', '相手', 'Them'))
                              : en.entry_type === 'PROGRESS'
                              ? L('완료', '完了', 'Done')
                              : L('의도', '意図', 'Intent');
                            return (
                              <React.Fragment key={`relay-${en.id}`}>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap shrink-0 ${pillCls}`}
                                  title={`${en.entry_date ? `${en.entry_date} ` : ''}${en.content}`}
                                >
                                  {shortLbl}{en.entry_date ? ` (${en.entry_date.slice(5)})` : ''}
                                </span>
                                {idx < arr.length - 1 && (
                                  <ArrowLeft className="w-3 h-3 text-charcoal-400 shrink-0" />
                                )}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })()}

                    {/* 3-Way Space Bridge Bar (Shared Thought Pad & Shared Calendar) */}
                    {spaces.length > 0 && (
                      <div className="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="font-bold text-indigo-950 text-[11px] shrink-0">
                            {L('공유 스페이스 연동', '共有スペース連携', 'Space Sync')}:
                          </span>
                          {projectSpaceLinks.length === 0 ? (
                            <span className="text-[11px] text-indigo-800/75">
                              {L(
                                '필요할 때 공유 메모장이나 공유 캘린더로 보내 실시간 동기화하세요',
                                '共有メモや共有カレンダーへ送って双方向同期できます',
                                'Send to Shared Thought Pad or Calendar for live two-way sync'
                              )}
                            </span>
                          ) : (
                            projectSpaceLinks.map((lnk) => (
                              <button
                                key={`${lnk.entity_type}-${lnk.entity_id}`}
                                type="button"
                                onClick={() => {
                                  if (!lnk.space_id) return;
                                  if (lnk.entity_type === 'THOUGHT') {
                                    onJumpToSpaceThought?.(lnk.space_id, lnk.entity_id);
                                  } else if (lnk.entity_type === 'EVENT') {
                                    onJumpToSpaceEvent?.(lnk.space_id, lnk.entity_id, lnk.start_date);
                                  }
                                }}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${
                                  lnk.entity_type === 'THOUGHT'
                                    ? 'bg-amber-50 hover:bg-amber-100 text-amber-950 border-amber-300'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border-emerald-300'
                                }`}
                              >
                                {lnk.entity_type === 'THOUGHT' ? (
                                  <Lightbulb className="w-3 h-3 text-amber-700 shrink-0" />
                                ) : (
                                  <Calendar className="w-3 h-3 text-emerald-700 shrink-0" />
                                )}
                                <span className="truncate max-w-[160px]">
                                  {lnk.entity_type === 'EVENT' && lnk.start_date ? `${lnk.start_date.slice(5)} ` : ''}
                                  {lnk.title}
                                </span>
                              </button>
                            ))
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setSpaceBridgeSource({
                                sourceType: 'PROJECT',
                                sourceId: detailProject.id,
                                projectId: detailProject.id,
                                defaultTitle: '',
                                defaultContent: '',
                                defaultDate: null,
                                initialDestination: 'thought',
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-bold transition"
                          >
                            <Lightbulb className="w-3 h-3 text-amber-800" />
                            <span>{L('공유 메모로 보내기', '共有メモへ', 'To Thought Pad')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setSpaceBridgeSource({
                                sourceType: 'PROJECT',
                                sourceId: detailProject.id,
                                projectId: detailProject.id,
                                defaultTitle: '',
                                defaultContent: '',
                                defaultDate: null,
                                initialDestination: 'calendar',
                              })
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition"
                          >
                            <Calendar className="w-3 h-3" />
                            <span>{L('공유 캘린더 등록', 'カレンダーへ', 'To Calendar')}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Detail Subtabs: Timeline (incl. Ideas) vs Tree Mind Map vs Free Mind Map */}
                    <div className="grid grid-cols-3 gap-1 bg-ivory-100 p-1 rounded-xl border border-ivory-300 text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setDetailSubTab('TIMELINE')}
                        className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition truncate ${
                          detailSubTab === 'TIMELINE' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">
                          {L(
                            `타임라인 (${detailEntries.length + detailIdeas.length})`,
                            `タイムライン (${detailEntries.length + detailIdeas.length})`,
                            `Timeline (${detailEntries.length + detailIdeas.length})`
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailSubTab('MINDMAP');
                          setLastMindMapTab('MINDMAP');
                        }}
                        className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition truncate ${
                          detailSubTab === 'MINDMAP' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
                        }`}
                      >
                        <GitBranch className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{L('마인드맵', 'マインドマップ', 'Mind Map')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDetailSubTab('FREEMAP');
                          setLastMindMapTab('FREEMAP');
                        }}
                        className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition truncate ${
                          detailSubTab === 'FREEMAP' ? 'bg-forest-800 text-white shadow-2xs' : 'text-charcoal-700'
                        }`}
                      >
                        <Move className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{L('자유 마인드맵', 'フリーマップ', 'Free Map')}</span>
                      </button>
                    </div>

                    {/* SUBTAB 1: UNIFIED TIMELINE (Me / Them / Intent / Idea / Progress) */}
                    {detailSubTab === 'TIMELINE' && (
                      <div className="space-y-3">
                        {/* Quick Unified Composer */}
                        <form
                          ref={composerFormRef}
                          onSubmit={handleAddTimelineItem}
                          className={`p-3 rounded-xl border shadow-2xs space-y-2 text-xs ${
                            editingEntryId || editingIdeaId
                              ? 'bg-amber-50/50 border-amber-400 ring-2 ring-amber-300/40'
                              : 'bg-white border-ivory-300'
                          }`}
                        >
                          {(editingEntryId || editingIdeaId) && (
                            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-amber-100/90 border border-amber-300 text-amber-950">
                              <span className="font-bold text-[11px] flex items-center gap-1.5">
                                <Edit2 className="w-3.5 h-3.5 text-amber-700" />
                                <span>
                                  {editingIdeaId
                                    ? L('기존 아이디어 수정 중 · 아래 내용을 수정하고 저장하세요', '既存アイデアを編集中', 'Editing idea · update below and save')
                                    : L('기존 타임라인 기록 수정 중 · 아래 내용을 수정하고 저장하세요', 'タイムライン記録を編集中', 'Editing entry · update below and save')}
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={handleCancelEditEntry}
                                className="px-2 py-0.5 rounded bg-white border border-amber-300 text-[11px] font-bold text-charcoal-700 hover:bg-amber-50 shrink-0"
                              >
                                {L('수정 취소', 'キャンセル', 'Cancel')}
                              </button>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5">
                            {(
                              [
                                { id: 'DIALOGUE_ME' as EntryType | 'IDEA', label: L('🗣️ 나', '🗣️ 自分', '🗣️ Me'), cls: 'bg-forest-700 text-white border-forest-800' },
                                { id: 'DIALOGUE_THEM' as EntryType | 'IDEA', label: L('👤 상대방', '👤 相手', '👤 Partner'), cls: 'bg-sky-600 text-white border-sky-700' },
                                { id: 'IDEA' as EntryType | 'IDEA', label: L('💡 아이디어', '💡 アイデア', '💡 Idea'), cls: 'bg-yellow-500 text-stone-950 border-yellow-600' },
                                { id: 'INTENT' as EntryType | 'IDEA', label: L('🧭 내 의도·결정', '🧭 意図・決定', '🧭 Intent'), cls: 'bg-amber-500 text-white border-amber-600' },
                                { id: 'PROGRESS' as EntryType | 'IDEA', label: L('✅ 완료 기록', '✅ 完了記録', '✅ Done'), cls: 'bg-emerald-600 text-white border-emerald-700' },
                              ]
                            ).map(tBtn => (
                              <button
                                key={tBtn.id}
                                type="button"
                                onClick={() => {
                                  if ((tBtn.id === 'IDEA' && editingEntryId) || (tBtn.id !== 'IDEA' && editingIdeaId)) {
                                    handleCancelEditEntry();
                                  }
                                  setComposerKind(tBtn.id);
                                }}
                                className={`px-2.5 py-1 rounded-lg border font-bold transition whitespace-nowrap ${
                                  composerKind === tBtn.id ? tBtn.cls : 'bg-white text-charcoal-700 border-ivory-300'
                                }`}
                              >
                                {tBtn.label}
                              </button>
                            ))}
                          </div>

                          {!editingEntryId && !editingIdeaId && (
                            <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-ivory-50 border border-ivory-200 text-[11px]">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-charcoal-600 inline-flex items-center gap-1">
                                  <GitBranch className="w-3.5 h-3.5 text-forest-700" />
                                  <span>{L('마인드맵 연결:', 'マップ接続先:', 'Mind Map Branch:')}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setTimelineParentNodeKey(null)}
                                  className={`px-2 py-0.5 rounded-full border font-bold transition ${
                                    timelineParentNodeKey === null
                                      ? 'bg-emerald-700 text-white border-emerald-800'
                                      : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
                                  }`}
                                >
                                  {L('🎯 현재 토픽(할 일) 꼬리에 자동 연결', '🎯 現在トピック末尾に自動接続', '🎯 Auto-chain to Current Topic')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTimelineParentNodeKey(ROOT_SUBTOPIC_KEY)}
                                  className={`px-2 py-0.5 rounded-full border font-bold transition ${
                                    timelineParentNodeKey === ROOT_SUBTOPIC_KEY
                                      ? 'bg-purple-700 text-white border-purple-800'
                                      : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
                                  }`}
                                >
                                  {L('🌿 루트에서 새 서브토픽(독립 가지) 시작', '🌿 ルートから新規サブトピック開始', '🌿 Start New Root Subtopic')}
                                </button>
                              </div>

                              {timelineParentNodeKey && timelineParentNodeKey !== ROOT_SUBTOPIC_KEY && (() => {
                                let labelText = timelineParentNodeKey;
                                if (timelineParentNodeKey.startsWith('entry-')) {
                                  const eid = Number(timelineParentNodeKey.slice(6));
                                  const found = detailEntries.find((x) => x.id === eid);
                                  if (found) {
                                    labelText = isTopicMilestoneEntry(found)
                                      ? `🎯 ${cleanTopicMilestoneTitle(found.content)}`
                                      : found.content.slice(0, 32);
                                  }
                                } else if (timelineParentNodeKey.startsWith('idea-')) {
                                  const iid = Number(timelineParentNodeKey.slice(5));
                                  const found = detailIdeas.find((x) => x.id === iid);
                                  if (found) labelText = `💡 ${found.title}`;
                                }
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-950 border border-emerald-300 font-bold">
                                    <CornerDownRight className="w-3 h-3 text-emerald-700" />
                                    <span className="truncate max-w-[220px]">
                                      {L(`이어쓰기 대상: ${labelText}`, `接続先: ${labelText}`, `Branching from: ${labelText}`)}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => setTimelineParentNodeKey(null)}
                                      className="hover:text-rose-700"
                                      title={L('기본 토픽 연결로 복귀', '基本トピック接続へ戻す', 'Reset to default topic')}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </span>
                                );
                              })()}
                            </div>
                          )}

                          {composerKind === 'IDEA' ? (
                            <div className="space-y-2">
                              <input
                                ref={ideaTitleRef}
                                type="text"
                                value={ideaTitle}
                                onChange={(e) => setIdeaTitle(e.target.value)}
                                placeholder={L('이 프로젝트와 관련해 떠오른 아이디어 제목...', 'このプロジェクトのアイデア...', 'New idea title for this project...')}
                                className="w-full p-2 bg-white border border-ivory-300 rounded-lg font-bold text-charcoal-900"
                              />
                              <textarea
                                rows={2}
                                value={ideaNote}
                                onChange={(e) => setIdeaNote(e.target.value)}
                                placeholder={L('세부 메모 / 기대 효과 (선택)', 'メモ・詳細 (任意)', 'Details / notes (optional)')}
                                className="w-full p-2 bg-white border border-ivory-300 rounded-lg text-charcoal-900"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                {editingIdeaId && (
                                  <Button type="button" variant="secondary" size="sm" onClick={handleCancelEditEntry}>
                                    {t('common.cancel')}
                                  </Button>
                                )}
                                <Button type="submit" variant="primary" size="sm" isLoading={isAddingIdea}>
                                  <Lightbulb className="w-3.5 h-3.5" />
                                  <span>
                                    {editingIdeaId
                                      ? L('수정 저장', '変更を保存', 'Save Changes')
                                      : L('아이디어 저장', 'アイデア保存', 'Save Idea')}
                                  </span>
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {/* Occurrence Date & Time (Default: Today, Time Empty; Clearable) */}
                                <div className="p-2 rounded-lg bg-ivory-50 border border-ivory-200 space-y-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] font-bold text-charcoal-700">
                                      📅 {L('발생 일시 (선택)', '発生日時 (任意)', 'Occurred (optional)')}
                                    </span>
                                    {(entryDate || entryTime) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEntryDate('');
                                          setEntryTime('');
                                        }}
                                        className="text-[10px] font-bold text-charcoal-500 hover:text-rose-600 px-1"
                                      >
                                        {L('비우기', 'クリア', 'Clear')}
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="date"
                                      value={entryDate}
                                      onChange={(e) => setEntryDate(e.target.value)}
                                      className="flex-1 min-w-0 p-1.5 bg-white border border-ivory-300 rounded-lg font-mono font-bold text-xs"
                                    />
                                    <input
                                      type="time"
                                      value={entryTime}
                                      onChange={(e) => setEntryTime(e.target.value)}
                                      className="w-[105px] shrink-0 p-1.5 bg-white border border-ivory-300 rounded-lg font-mono font-bold text-xs"
                                    />
                                  </div>
                                </div>

                                {/* Deadline Date & Time (Default: Always Empty; Clearable) */}
                                <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-200/80 space-y-1">
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] font-bold text-amber-900">
                                      ⏰ {L('마감 일시 (선택)', '期限日時 (任意)', 'Deadline (optional)')}
                                    </span>
                                    {(dueDate || dueTime) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDueDate('');
                                          setDueTime('');
                                        }}
                                        className="text-[10px] font-bold text-amber-700 hover:text-rose-600 px-1"
                                      >
                                        {L('비우기', 'クリア', 'Clear')}
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="date"
                                      value={dueDate}
                                      onChange={(e) => setDueDate(e.target.value)}
                                      className="flex-1 min-w-0 p-1.5 bg-white border border-amber-300 rounded-lg font-mono font-bold text-xs"
                                    />
                                    <input
                                      type="time"
                                      value={dueTime}
                                      onChange={(e) => setDueTime(e.target.value)}
                                      className="w-[105px] shrink-0 p-1.5 bg-white border border-amber-300 rounded-lg font-mono font-bold text-xs"
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                {composerKind === 'DIALOGUE_THEM' && (() => {
                                  const presetList: JournalParticipant[] = [...(detailProject.participants || [])];
                                  if (
                                    detailProject.resolved_partner_name &&
                                    !presetList.some(
                                      (p) => p.name.toLowerCase() === detailProject.resolved_partner_name!.toLowerCase()
                                    )
                                  ) {
                                    presetList.unshift({ name: detailProject.resolved_partner_name });
                                  }

                                  if (presetList.length > 0 && !speakerCustomInput) {
                                    return (
                                      <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-[200px]">
                                        {presetList.map((person) => {
                                          const isActive = entrySpeaker === person.name;
                                          return (
                                            <button
                                              key={`spk-${person.name}`}
                                              type="button"
                                              onClick={() => setEntrySpeaker(isActive ? '' : person.name)}
                                              className={`px-2.5 py-1 rounded-full border text-xs font-bold transition inline-flex items-center gap-1 ${
                                                isActive
                                                  ? 'bg-sky-600 text-white border-sky-700 shadow-2xs'
                                                  : 'bg-white text-charcoal-800 border-ivory-300 hover:border-sky-400'
                                              }`}
                                            >
                                              <span>👤 {person.name}</span>
                                              {person.role && (
                                                <span className={`text-[10px] ${isActive ? 'opacity-90' : 'text-charcoal-500'}`}>
                                                  ({person.role})
                                                </span>
                                              )}
                                            </button>
                                          );
                                        })}
                                        <button
                                          type="button"
                                          onClick={() => setSpeakerCustomInput(true)}
                                          className="px-2 py-1 rounded-full bg-ivory-100 text-charcoal-600 border border-ivory-300 text-[11px] font-bold hover:bg-white"
                                        >
                                          {L('+ 직접 입력', '+ 直接入力', '+ Custom')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleOpenParticipantsModal('STAKEHOLDERS')}
                                          className="px-2 py-1 rounded-full bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-bold hover:bg-sky-100 inline-flex items-center gap-1"
                                        >
                                          <Settings className="w-3 h-3" />
                                          <span>{L('관계자 설정', '関係者設定', 'Manage')}</span>
                                        </button>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-[200px]">
                                      <input
                                        type="text"
                                        value={entrySpeaker}
                                        onChange={(e) => setEntrySpeaker(e.target.value)}
                                        placeholder={detailProject.resolved_partner_name || L('상대방 이름 입력...', '相手名...', 'Speaker name...')}
                                        className="p-1.5 bg-white border border-ivory-300 rounded-lg font-bold text-xs flex-1 min-w-[120px]"
                                      />
                                      {presetList.length > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => setSpeakerCustomInput(false)}
                                          className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 text-[11px] font-bold hover:bg-ivory-100"
                                        >
                                          {L('명단 선택', 'リスト選択', 'Presets')}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleOpenParticipantsModal('STAKEHOLDERS')}
                                        className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-900 border border-sky-200 text-[11px] font-bold hover:bg-sky-100 inline-flex items-center gap-1 shrink-0"
                                      >
                                        <Settings className="w-3 h-3" />
                                        <span>{L('관계자 사전설정', '関係者設定', 'Setup People')}</span>
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>

                              {/* Target Picker for Completion Log (PROGRESS) */}
                              {composerKind === 'PROGRESS' && (
                                <div className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 space-y-1.5">
                                  <label className="block text-[11px] font-bold text-emerald-900">
                                    {L(
                                      '어떤 항목을 완료했나요? (최근 10개 기록·아이디어 중 선택)',
                                      'どの項目を完了しましたか？（直近10件から選択）',
                                      'Which item was completed? (Recent 10 items)'
                                    )}
                                  </label>
                                  <div className="flex items-center gap-1.5">
                                    <select
                                      value={completedTarget}
                                      onChange={(e) => setCompletedTarget(e.target.value)}
                                      className="flex-1 min-w-0 p-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-charcoal-900"
                                    >
                                      <option value="">
                                        {L('── 대상 미지정 (일반 완료 기록) ──', '── 指定なし（一般完了記録） ──', '── None (General Completion Log) ──')}
                                      </option>
                                      {progressTargetOptions.map((opt) => (
                                        <option key={opt.key} value={opt.key}>
                                          {`[${opt.tag}] ${opt.date} · ${opt.text.length > 48 ? opt.text.slice(0, 48) + '...' : opt.text}`}
                                        </option>
                                      ))}
                                    </select>
                                    {completedTarget && (
                                      <button
                                        type="button"
                                        onClick={() => setCompletedTarget('')}
                                        className="px-2 py-1.5 rounded-lg bg-white border border-emerald-300 text-charcoal-600 font-bold text-[11px] hover:bg-emerald-100 shrink-0"
                                      >
                                        {L('해제', '解除', 'Clear')}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}

                              <textarea
                                ref={entryContentRef}
                                rows={2}
                                value={entryContent}
                                onChange={(e) => setEntryContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleAddTimelineItem(e as unknown as React.FormEvent);
                                  }
                                }}
                                placeholder={
                                  composerKind === 'DIALOGUE_ME'
                                    ? L('내가 상대에게 보낸 말·제안·요청 내용을 남기세요...', '自分が伝えた内容・提案を記録...', 'What did you say or propose?')
                                    : composerKind === 'DIALOGUE_THEM'
                                    ? L('상대방이 말한 내용·약속·회신을 남기세요 (카톡/메일 복붙 가능)...', '相手が言った内容・約束を記録...', 'What did they say or promise?')
                                    : composerKind === 'PROGRESS'
                                    ? L('완료 결과나 진행 요약을 남기세요...', '完了結果や進捗を記録...', 'Summarize what was completed...')
                                    : L('지금 이렇게 하려는 이유·가설·결정 사항을 남기세요...', '今の考え・判断理由・決定事項を記録...', 'Why are you taking this direction?')
                                }
                                className="w-full p-2.5 bg-white border border-ivory-300 rounded-lg text-xs text-charcoal-900"
                              />

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                {!editingEntryId &&
                                (composerKind === 'DIALOGUE_ME' || composerKind === 'DIALOGUE_THEM') ? (
                                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-charcoal-700 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={autoSwitchTurnOnSubmit}
                                      onChange={(e) => setAutoSwitchTurnOnSubmit(e.target.checked)}
                                      className="rounded border-ivory-400 text-forest-700 focus:ring-forest-600"
                                    />
                                    <span>
                                      {composerKind === 'DIALOGUE_ME'
                                        ? L("저장 후 '⏳ 상대 턴'으로 전환", "保存後「⏳ 相手ターン」へ切替", "Switch to '⏳ Their Turn' on save")
                                        : L("저장 후 '🔥 내 턴'으로 전환", "保存後「🔥 自分ターン」へ切替", "Switch to '🔥 My Turn' on save")}
                                    </span>
                                  </label>
                                ) : (
                                  <span className="text-[10px] text-charcoal-400 hidden sm:inline">
                                    Ctrl+Enter {L('빠른 저장', 'で保存', 'to save')}
                                  </span>
                                )}
                                <div className="flex justify-end gap-2 ml-auto">
                                  {editingEntryId && (
                                    <Button type="button" variant="secondary" size="sm" onClick={handleCancelEditEntry}>
                                      <span>{t('common.cancel')}</span>
                                    </Button>
                                  )}
                                  <Button type="submit" variant="primary" size="sm" isLoading={isAddingEntry}>
                                    {editingEntryId ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                                    <span>
                                      {editingEntryId
                                        ? L('수정 저장', '変更を保存', 'Save Changes')
                                        : L('기록 남기기', '記録する', 'Add Log')}
                                    </span>
                                  </Button>
                                </div>
                              </div>
                            </>
                          )}
                        </form>

                        {/* Entry Filter & Sort Bar */}
                        <div className="flex items-center justify-between gap-2 flex-wrap text-[11px]">
                          <div className="flex items-center gap-1 flex-wrap">
                            {(
                              [
                                { id: 'ALL', label: L('전체', 'すべて', 'All') },
                                { id: 'DIALOGUE', label: L('대화만', '対話のみ', 'Dialogue') },
                                { id: 'INTENT', label: L('내 의도', '意図', 'Intent') },
                                { id: 'IDEA', label: L('아이디어', 'アイデア', 'Ideas') },
                                { id: 'PROGRESS', label: L('완료', '完了', 'Done') },
                              ] as const
                            ).map(f => (
                              <button
                                key={f.id}
                                type="button"
                                onClick={() => setEntryFilter(f.id)}
                                className={`px-2 py-0.5 rounded-full border font-bold ${
                                  entryFilter === f.id
                                    ? 'bg-forest-800 text-white border-forest-900'
                                    : 'bg-white text-charcoal-600 border-ivory-300'
                                }`}
                              >
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => setEntrySortDesc(prev => !prev)}
                            className="text-charcoal-600 font-bold hover:text-forest-800"
                          >
                            {entrySortDesc ? L('최신순 ▾', '新しい順 ▾', 'Newest ▾') : L('시간순 ▴', '古い順 ▴', 'Chronological ▴')}
                          </button>
                        </div>

                        {/* Unified Timeline Entries & Ideas */}
                        {filteredDetailTimeline.length === 0 ? (
                          <div className="py-8 text-center text-xs text-charcoal-400">
                            {L('아직 기록이 없습니다.', 'まだ記録がありません。', 'No entries yet.')}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {filteredDetailTimeline.map(item => {
                              if (item.kind === 'IDEA') {
                                const idea = item.idea;
                                const targetKey = `IDEA:${idea.id}`;
                                const completedLogs = completedTargetsMap.get(targetKey) || [];
                                const isCompleted = completedLogs.length > 0;
                                const latestComp = completedLogs[completedLogs.length - 1];

                                return (
                                  <div
                                    key={`tl-idea-${idea.id}`}
                                    id={`tl-node-idea-${idea.id}`}
                                    className={`p-2.5 sm:p-3 rounded-xl border space-y-2 text-xs transition ${
                                      idea.status === 'PROMOTED'
                                        ? 'bg-emerald-50/70 border-emerald-300'
                                        : idea.status === 'ARCHIVED'
                                        ? 'bg-stone-50 border-stone-200 opacity-75'
                                        : 'bg-yellow-50/50 border-amber-300'
                                    } ${highlightTimelineKey === `idea-${idea.id}` ? 'ring-2 ring-inset ring-amber-500 border-amber-500 shadow-md' : ''}`}
                                  >
                                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                                      <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                                        <span className="font-bold text-charcoal-900 truncate whitespace-nowrap">
                                          {L('💡 아이디어', '💡 アイデア', '💡 Idea')}
                                        </span>
                                        {(() => {
                                          const { compact, full } = formatCompactTimelineDateTime(item.dateKey, item.timeKey);
                                          return compact ? (
                                            <span
                                              className="font-mono text-[10.5px] text-charcoal-500 whitespace-nowrap shrink-0"
                                              title={full}
                                            >
                                              {compact}
                                            </span>
                                          ) : null;
                                        })()}
                                      </div>

                                      <div className="flex items-center gap-0.5 shrink-0 flex-wrap justify-end">
                                        <TranslateButton
                                          size="xs"
                                          visible={tr.shouldShowButton(idea.title, idea.note)}
                                          translated={tr.isTranslated(`jidea-${idea.id}`)}
                                          loading={tr.isTranslating(`jidea-${idea.id}`)}
                                          error={tr.getError(`jidea-${idea.id}`)}
                                          onClick={() =>
                                            tr.toggleTranslate(
                                              `jidea-${idea.id}`,
                                              {
                                                title: idea.title,
                                                note: idea.note || '',
                                              },
                                              'journal'
                                            )
                                          }
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleJumpFromTimelineToMindMap(`idea-${idea.id}`)}
                                          className="px-1.5 py-1 rounded-lg border bg-white border-ivory-300 text-charcoal-700 hover:bg-sky-50 hover:border-sky-300 text-[11px] font-bold inline-flex items-center gap-0.5 transition"
                                          title={L('마인드맵에서 이 아이디어 위치 보기', 'マインドマップで位置を見る', 'Locate on Mind Map')}
                                        >
                                          <GitBranch className="w-3.5 h-3.5 text-forest-700" />
                                          <span className="hidden sm:inline">{L('맵', 'マップ', 'Map')}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setTimelineParentNodeKey(`idea-${idea.id}`);
                                            composerFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                          }}
                                          className={`px-1.5 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-0.5 transition ${
                                            timelineParentNodeKey === `idea-${idea.id}`
                                              ? 'bg-emerald-700 text-white border-emerald-800'
                                              : 'bg-white border-ivory-300 text-charcoal-700 hover:bg-emerald-50 hover:border-emerald-300'
                                          }`}
                                          title={L('이 아이디어 노드에 이어서 새 가지 작성', 'このアイデアの先に続けて記録', 'Branch next entry from this idea')}
                                        >
                                          <CornerDownRight className="w-3.5 h-3.5" />
                                          <span className="hidden sm:inline">{L('이어쓰기', '続けて記録', 'Branch')}</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleStartCompleteTarget(targetKey)}
                                          className="p-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center justify-center transition"
                                          title={L('완료 기록 작성', '完了記録を作成', 'Mark as done')}
                                          aria-label={L('완료 기록 작성', '完了記録を作成', 'Mark as done')}
                                        >
                                          <CheckCircle2 className="w-4 h-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditIdea(idea)}
                                          className="p-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 hover:bg-ivory-100 inline-flex items-center justify-center transition"
                                          title={L('아이디어 수정', 'アイデアを編集', 'Edit idea')}
                                          aria-label={L('아이디어 수정', 'アイデアを編集', 'Edit idea')}
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                        {spaces.length > 0 && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSpaceBridgeSource({
                                                  sourceType: 'IDEA',
                                                  sourceId: idea.id,
                                                  projectId: detailProject.id,
                                                  defaultTitle: idea.title,
                                                  defaultContent: idea.note || idea.title,
                                                  initialDestination: 'thought',
                                                })
                                              }
                                              className="p-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 inline-flex items-center justify-center transition"
                                              title={L('공유 메모장으로 보내기', '共有メモ帳へ送る', 'Send to Shared Thought Pad')}
                                            >
                                              <Lightbulb className="w-4 h-4" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSpaceBridgeSource({
                                                  sourceType: 'IDEA',
                                                  sourceId: idea.id,
                                                  projectId: detailProject.id,
                                                  defaultTitle: idea.title,
                                                  defaultContent: idea.note || '',
                                                  initialDestination: 'calendar',
                                                })
                                              }
                                              className="p-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 inline-flex items-center justify-center transition"
                                              title={L('공유 캘린더에 등록', '共有カレンダーへ登録', 'Send to Shared Calendar')}
                                            >
                                              <Calendar className="w-4 h-4" />
                                            </button>
                                          </>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteIdea(idea.id)}
                                          className="p-1 rounded-lg text-charcoal-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center transition"
                                          title={t('common.delete')}
                                          aria-label={t('common.delete')}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>

                                    {(idea.status === 'PROMOTED' || idea.status === 'ARCHIVED' || (isCompleted && latestComp) || (ideaSpaceLinks[idea.id]?.length || 0) > 0) && (
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {(ideaSpaceLinks[idea.id] || []).map((lnk) => (
                                          <button
                                            key={`idea-lnk-${lnk.entity_type}-${lnk.entity_id}`}
                                            type="button"
                                            onClick={() => {
                                              if (!lnk.space_id) return;
                                              if (lnk.entity_type === 'THOUGHT') onJumpToSpaceThought?.(lnk.space_id, lnk.entity_id);
                                              else if (lnk.entity_type === 'EVENT') onJumpToSpaceEvent?.(lnk.space_id, lnk.entity_id, lnk.start_date);
                                            }}
                                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                                              lnk.entity_type === 'THOUGHT'
                                                ? 'bg-amber-50 text-amber-950 border-amber-300'
                                                : 'bg-emerald-50 text-emerald-950 border-emerald-300'
                                            }`}
                                          >
                                            {lnk.entity_type === 'THOUGHT' ? '💡' : '📅'} {lnk.entity_type === 'EVENT' && lnk.start_date ? `${lnk.start_date.slice(5)} ` : ''}{lnk.title}
                                          </button>
                                        ))}
                                        {idea.status === 'PROMOTED' && (
                                          <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                                            {L('Next Step 반영됨', 'Next Step反映済', 'Promoted')}
                                          </span>
                                        )}
                                        {idea.status === 'ARCHIVED' && (
                                          <span className="px-1.5 py-0.5 rounded bg-stone-200 text-stone-700 text-[10px] font-bold">
                                            {L('보관됨', '保管', 'Archived')}
                                          </span>
                                        )}
                                        {isCompleted && latestComp && (
                                          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold">
                                            {L(`✅ 완료됨 (${latestComp.entry_date.slice(5)})`, `✅ 完了済 (${latestComp.entry_date.slice(5)})`, `✅ Done (${latestComp.entry_date.slice(5)})`)}
                                          </span>
                                        )}
                                      </div>
                                    )}

                                    <div className="space-y-0.5">
                                      <p className="font-bold text-charcoal-900">
                                        {tr.getText(`jidea-${idea.id}`, 'title', idea.title)}
                                      </p>
                                      {idea.note && (
                                        <p className="text-charcoal-700 whitespace-pre-wrap leading-relaxed">
                                          {tr.getText(`jidea-${idea.id}`, 'note', idea.note)}
                                        </p>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-amber-200/60">
                                      {idea.status === 'OPEN' && (
                                        <button
                                          type="button"
                                          onClick={() => handleMindMapPromoteIdea(idea)}
                                          className="px-2 py-0.5 rounded-lg bg-forest-800 text-white font-bold text-[11px] inline-flex items-center gap-1"
                                        >
                                          <Sparkles className="w-3 h-3" />
                                          <span>{L('Next Step으로 승격', 'Next Stepに昇格', 'Promote to Next Step')}</span>
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleMindMapUpdateIdeaStatus(idea, idea.status === 'ARCHIVED' ? 'OPEN' : 'ARCHIVED')
                                        }
                                        className="px-2 py-0.5 rounded-lg bg-white text-charcoal-700 border border-ivory-300 font-bold text-[11px]"
                                      >
                                        {idea.status === 'ARCHIVED' ? L('다시 꺼내기', '復元', 'Restore') : L('보관', '保管', 'Archive')}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }

                              const en = item.entry;
                              const isTopicMilestone = isTopicMilestoneEntry(en);
                              const isCurrentFocusIntent = isCurrentFocusIntentEntry(en);
                              const isMe = en.entry_type === 'DIALOGUE_ME';
                              const isThem = en.entry_type === 'DIALOGUE_THEM';
                              const isProgress = en.entry_type === 'PROGRESS';
                              const targetKey = `ENTRY:${en.id}`;
                              const completedLogs = !isProgress ? completedTargetsMap.get(targetKey) || [] : [];
                              const isCompleted = completedLogs.length > 0;
                              const latestComp = completedLogs[completedLogs.length - 1];

                              const wrapperStyle = isMe
                                ? 'flex justify-end'
                                : isThem
                                ? 'flex justify-start'
                                : '';

                              const cardStyle = isTopicMilestone
                                ? 'w-full bg-emerald-50/85 border-emerald-400 rounded-xl'
                                : isCurrentFocusIntent
                                ? 'w-full bg-amber-50/90 border-amber-400 rounded-xl'
                                : isMe
                                ? 'w-[92%] sm:w-[60%] bg-forest-50/75 border-forest-300 rounded-xl'
                                : isThem
                                ? 'w-[92%] sm:w-[60%] bg-sky-50/85 border-sky-300 rounded-xl'
                                : isProgress
                                ? 'w-full bg-emerald-50/70 border-emerald-300 rounded-xl'
                                : 'w-full bg-amber-50/60 border-amber-300 rounded-xl';

                              const badgeLabel = isTopicMilestone
                                ? L('🎯 토픽 전환 (다음 할 일)', '🎯 トピック (次の行動)', '🎯 Topic (Next Step)')
                                : isCurrentFocusIntent
                                ? L('🧭 현재 방향 · 핵심 메모', '🧭 現在の方向・核心メモ', '🧭 Current Focus · Memo')
                                : isMe
                                ? L('🗣️ 나', '🗣️ 自分', '🗣️ Me')
                                : isThem
                                ? `👤 ${en.speaker_name || detailProject.resolved_partner_name || L('상대방', '相手', 'Partner')}`
                                : isProgress
                                ? L('✅ 완료 기록', '✅ 完了', '✅ Done')
                                : L('🧭 내 의도·결정', '🧭 意図・決定', '🧭 Intent');

                              const targetKindLabel =
                                en.completed_target_kind === 'IDEA'
                                  ? L('💡 아이디어', '💡 アイデア', '💡 Idea')
                                  : en.completed_target_kind === 'DIALOGUE_ME'
                                  ? L('🗣️ 나', '🗣️ 自分', '🗣️ Me')
                                  : en.completed_target_kind === 'DIALOGUE_THEM'
                                  ? L('👤 상대방', '👤 相手', '👤 Partner')
                                  : L('🧭 의도·결정', '🧭 意図', '🧭 Intent');

                              return (
                                <div key={`tl-entry-${en.id}`} id={`tl-node-entry-${en.id}`} className={wrapperStyle}>
                                  <div
                                    className={`p-2.5 sm:p-3 border space-y-1.5 text-xs transition ${cardStyle} ${
                                      highlightTimelineKey === `entry-${en.id}` ? 'ring-2 ring-inset ring-amber-500 border-amber-500 shadow-md' : ''
                                    }`}
                                  >
                                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-nowrap">
                                      <span className="font-bold text-charcoal-900 truncate whitespace-nowrap">{badgeLabel}</span>
                                      {(() => {
                                        const displayDate = en.entry_date || (en.created_at ? getJstDateKey(en.created_at) : '');
                                        const displayTime = en.entry_time || (en.created_at ? formatJstTime(en.created_at) : '');
                                        const { compact, full } = formatCompactTimelineDateTime(displayDate, displayTime);
                                        return compact ? (
                                          <span
                                            className="font-mono text-[10.5px] text-charcoal-500 whitespace-nowrap shrink-0"
                                            title={full}
                                          >
                                            {compact}
                                          </span>
                                        ) : null;
                                      })()}
                                    </div>

                                    <div className="flex items-center gap-0.5 shrink-0 flex-wrap justify-end">
                                      <TranslateButton
                                        size="xs"
                                        visible={tr.shouldShowButton(
                                          en.content,
                                          en.completed_target_summary,
                                          ...(en.revision_requests || []).map((rr) => rr.reason)
                                        )}
                                        translated={tr.isTranslated(`jentry-${en.id}`)}
                                        loading={tr.isTranslating(`jentry-${en.id}`)}
                                        error={tr.getError(`jentry-${en.id}`)}
                                        onClick={() => {
                                          const fields: Record<string, string> = {
                                            content: en.content,
                                            completed_target_summary: en.completed_target_summary || '',
                                          };
                                          (en.revision_requests || []).forEach((rr) => {
                                            fields[`rev_${rr.id}`] = rr.reason;
                                          });
                                          void tr.toggleTranslate(`jentry-${en.id}`, fields, 'journal');
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleJumpFromTimelineToMindMap(`entry-${en.id}`)}
                                        className="px-1.5 py-1 rounded-lg border bg-white border-ivory-300 text-charcoal-700 hover:bg-sky-50 hover:border-sky-300 text-[11px] font-bold inline-flex items-center gap-0.5 transition"
                                        title={L('마인드맵에서 이 기록 위치 보기', 'マインドマップで位置を見る', 'Locate on Mind Map')}
                                      >
                                        <GitBranch className="w-3.5 h-3.5 text-forest-700" />
                                        <span className="hidden sm:inline">{L('맵', 'マップ', 'Map')}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setTimelineParentNodeKey(`entry-${en.id}`);
                                          composerFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                        }}
                                        className={`px-1.5 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-0.5 transition ${
                                          timelineParentNodeKey === `entry-${en.id}`
                                            ? 'bg-emerald-700 text-white border-emerald-800'
                                            : 'bg-white border-ivory-300 text-charcoal-700 hover:bg-emerald-50 hover:border-emerald-300'
                                        }`}
                                        title={L('이 노드에 이어서 새 가지 작성', 'このノードの先に続けて記録', 'Branch next entry from this node')}
                                      >
                                        <CornerDownRight className="w-3.5 h-3.5" />
                                        <span className="hidden sm:inline">{L('이어쓰기', '続けて記録', 'Branch')}</span>
                                      </button>
                                      {!isProgress && (
                                        <button
                                          type="button"
                                          onClick={() => handleStartCompleteTarget(targetKey)}
                                          className="p-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center justify-center transition"
                                          title={L('이 기록을 완료 대상으로 완료 기록 작성', 'この記録の完了記録を作成', 'Log completion for this entry')}
                                          aria-label={L('완료 기록 작성', '完了記録を作成', 'Log completion for this entry')}
                                        >
                                          <CheckCircle2 className="w-4 h-4" />
                                        </button>
                                      )}
                                      {Number(en.author_id) === Number(user?.id) ? (
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditEntry(en)}
                                          className="p-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 hover:bg-ivory-100 inline-flex items-center justify-center transition"
                                          title={L('이 기록 수정', 'この記録を編集', 'Edit this entry')}
                                          aria-label={t('common.edit')}
                                        >
                                          <Edit2 className="w-4 h-4" />
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRevisionFormEntryId(revisionFormEntryId === en.id ? null : en.id);
                                            setRevisionReason('');
                                          }}
                                          className="px-1.5 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 font-bold text-[11px] hover:bg-amber-100 inline-flex items-center gap-1 whitespace-nowrap"
                                          title={L('작성자에게 내용 수정 요청 보내기', '作成者に修正を依頼', 'Request revision from author')}
                                        >
                                          <AlertTriangle className="w-3 h-3" />
                                          <span>{L('수정 요청', '修正依頼', 'Request Edit')}</span>
                                        </button>
                                      )}
                                      {spaces.length > 0 && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSpaceBridgeSource({
                                                sourceType: 'ENTRY',
                                                sourceId: en.id,
                                                projectId: detailProject.id,
                                                defaultTitle: en.content.slice(0, 42),
                                                defaultContent: en.content,
                                                defaultDate: en.due_date || en.entry_date,
                                                initialDestination: 'thought',
                                              })
                                            }
                                            className="p-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 hover:bg-amber-100 inline-flex items-center justify-center transition"
                                            title={L('공유 메모장으로 보내기', '共有メモ帳へ送る', 'Send to Shared Thought Pad')}
                                          >
                                            <Lightbulb className="w-4 h-4" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setSpaceBridgeSource({
                                                sourceType: 'ENTRY',
                                                sourceId: en.id,
                                                projectId: detailProject.id,
                                                defaultTitle: en.content.slice(0, 42),
                                                defaultContent: en.content,
                                                defaultDate: en.due_date || en.entry_date,
                                                initialDestination: 'calendar',
                                              })
                                            }
                                            className="p-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 inline-flex items-center justify-center transition"
                                            title={L('공유 캘린더에 등록', '共有カレンダーへ登録', 'Send to Shared Calendar')}
                                          >
                                            <Calendar className="w-4 h-4" />
                                          </button>
                                        </>
                                      )}
                                      {(Number(en.author_id) === Number(user?.id) || Number(detailProject.created_by) === Number(user?.id)) && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteEntry(en.id)}
                                          className="p-1 rounded-lg text-charcoal-400 hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center transition"
                                          title={t('common.delete')}
                                          aria-label={t('common.delete')}
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {(en.due_date || en.due_time || (isCompleted && latestComp)) && (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {(en.due_date || en.due_time) && (
                                        <span
                                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold border ${
                                            !isCompleted && !isProgress && en.due_date && en.due_date <= todayJst
                                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                                              : 'bg-amber-50 text-amber-900 border-amber-200'
                                          }`}
                                        >
                                          ⏰ {L('마감', '期限', 'Due')} {en.due_date || ''}{en.due_time ? `${en.due_date ? ' ' : ''}${en.due_time}` : ''}
                                        </span>
                                      )}
                                      {isCompleted && latestComp && (
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 text-[10px] font-bold">
                                          {L(
                                            `✅ 완료됨${latestComp.entry_date ? ` (${latestComp.entry_date.slice(5)})` : ''}`,
                                            `✅ 完了済${latestComp.entry_date ? ` (${latestComp.entry_date.slice(5)})` : ''}`,
                                            `✅ Done${latestComp.entry_date ? ` (${latestComp.entry_date.slice(5)})` : ''}`
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {isProgress && en.completed_target_summary && (
                                    <div className="px-2.5 py-1.5 rounded-lg bg-white/80 border border-emerald-200 flex items-center gap-1.5 text-[11px]">
                                      <span className="font-bold text-emerald-800 shrink-0">
                                        {L('↳ 완료 대상', '↳ 完了対象', '↳ Completed')} [{targetKindLabel}]:
                                      </span>
                                      <span
                                        className={`text-charcoal-700 font-medium ${
                                          tr.isTranslated(`jentry-${en.id}`) ? 'whitespace-normal break-words' : 'truncate'
                                        }`}
                                      >
                                        {tr.getText(`jentry-${en.id}`, 'completed_target_summary', en.completed_target_summary)}
                                      </span>
                                    </div>
                                  )}

                                  <p className="text-charcoal-900 whitespace-pre-wrap leading-relaxed font-medium">
                                    {tr.getText(`jentry-${en.id}`, 'content', en.content)}
                                  </p>

                                  {revisionFormEntryId === en.id && (
                                    <div className="p-2 rounded-lg bg-amber-50 border border-amber-300 space-y-1.5">
                                      <div className="text-[11px] font-bold text-amber-950">
                                        {L('작성자에게 수정 요청 남기기', '作成者へ修正依頼を送る', 'Send revision request')}
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <input
                                          type="text"
                                          value={revisionReason}
                                          onChange={(e) => setRevisionReason(e.target.value)}
                                          placeholder={L('수정이 필요한 부분이나 사유를 입력하세요...', '修正が必要な理由や内容...', 'What needs correction?')}
                                          className="flex-1 min-w-0 p-1.5 bg-white border border-amber-300 rounded text-[11px] text-charcoal-900"
                                        />
                                        <button
                                          type="button"
                                          disabled={!revisionReason.trim() || isSubmittingRevision}
                                          onClick={() => handleSubmitRevisionRequest(en.id)}
                                          className="px-2.5 py-1.5 rounded bg-amber-600 text-white font-bold text-[11px] hover:bg-amber-700 disabled:opacity-50 shrink-0"
                                        >
                                          {L('요청 전송', '送信', 'Send')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRevisionFormEntryId(null);
                                            setRevisionReason('');
                                          }}
                                          className="px-2 py-1.5 rounded bg-white border border-ivory-300 text-charcoal-600 font-bold text-[11px] shrink-0"
                                        >
                                          {t('common.cancel')}
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {en.revision_requests && en.revision_requests.length > 0 && (
                                    <div className="space-y-1 pt-1">
                                      {en.revision_requests.map((rr) => (
                                        <div
                                          key={`rev-req-${rr.id}`}
                                          className="p-2 rounded-lg bg-amber-50/90 border border-amber-300 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                                        >
                                          <div className="text-amber-950 font-medium break-words">
                                            <span className="font-bold">
                                              📝 {rr.requester_name || L('참여자', 'メンバー', 'Member')} {L('수정 요청', '修正依頼', 'Revision Request')}:
                                            </span>{' '}
                                            {tr.getText(`jentry-${en.id}`, `rev_${rr.id}`, rr.reason)}
                                          </div>
                                          <div className="flex items-center gap-1 shrink-0">
                                            {Number(en.author_id) === Number(user?.id) && (
                                              <>
                                                <button
                                                  type="button"
                                                  onClick={() => handleStartEditEntry(en)}
                                                  className="px-2 py-0.5 rounded bg-forest-700 text-white font-bold hover:bg-forest-800"
                                                >
                                                  {L('수정하기', '修正する', 'Edit Now')}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => handleResolveRevisionRequest(rr.id)}
                                                  className="px-2 py-0.5 rounded bg-white border border-emerald-400 text-emerald-800 font-bold hover:bg-emerald-50"
                                                >
                                                  {L('확인 완료', '確認済', 'Resolve')}
                                                </button>
                                              </>
                                            )}
                                            {Number(rr.requester_id) === Number(user?.id) && (
                                              <button
                                                type="button"
                                                onClick={() => handleCancelRevisionRequest(rr.id)}
                                                className="px-2 py-0.5 rounded bg-white border border-ivory-300 text-charcoal-600 font-bold hover:bg-ivory-100"
                                              >
                                                {L('요청 취소', '取消', 'Withdraw')}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                    {(entrySpaceLinks[en.id]?.length || 0) > 0 && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        {(entrySpaceLinks[en.id] || []).map((lnk) => (
                                          <button
                                            key={`en-lnk-${lnk.entity_type}-${lnk.entity_id}`}
                                            type="button"
                                            onClick={() => {
                                              if (!lnk.space_id) return;
                                              if (lnk.entity_type === 'THOUGHT') onJumpToSpaceThought?.(lnk.space_id, lnk.entity_id);
                                              else if (lnk.entity_type === 'EVENT') onJumpToSpaceEvent?.(lnk.space_id, lnk.entity_id, lnk.start_date);
                                            }}
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${
                                              lnk.entity_type === 'THOUGHT'
                                                ? 'bg-amber-50 text-amber-950 border-amber-300'
                                                : 'bg-emerald-50 text-emerald-950 border-emerald-300'
                                            }`}
                                          >
                                            {lnk.entity_type === 'THOUGHT' ? '💡' : '📅'} {lnk.entity_type === 'EVENT' && lnk.start_date ? `${lnk.start_date.slice(5)} ` : ''}{lnk.title}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* SUBTAB 3: PROJECT MIND MAP */}
                    {detailSubTab === 'MINDMAP' && detailProject && (
                      <JournalMindMap
                        project={detailProject}
                        entries={detailEntries}
                        ideas={detailIdeas}
                        currentUserId={user?.id}
                        onSaveLayout={handleSaveMindMapLayout}
                        onAddIdea={handleMindMapAddIdea}
                        onAddEntry={handleMindMapAddEntry}
                        onEditEntry={handleMindMapEditEntry}
                        onDeleteEntry={handleMindMapDeleteEntry}
                        onPromoteEntryToNextStep={handleMindMapPromoteEntryToNextStep}
              onSetNextStep={handleMindMapSetNextStep}
                        onToggleRelatedIdea={handleMindMapToggleLink}
                        onPromoteIdea={handleMindMapPromoteIdea}
                        onUpdateIdeaStatus={handleMindMapUpdateIdeaStatus}
                        onDeleteIdea={handleMindMapDeleteIdea}
                        onJumpToTimeline={handleJumpFromMindMapToTimeline}
                        focusNodeKey={focusMindMapNodeKey}
                        onSelectNodeKey={setFocusMindMapNodeKey}
                      />
                    )}

                    {/* SUBTAB 4: PROJECT FREE MIND MAP */}
                    {detailSubTab === 'FREEMAP' && detailProject && (
                      <JournalFreeMindMap
                        project={detailProject}
                        entries={detailEntries}
                        ideas={detailIdeas}
                        currentUserId={user?.id}
                        onSaveLayout={handleSaveMindMapLayout}
                        onAddIdea={handleMindMapAddIdea}
                        onAddEntry={handleMindMapAddEntry}
                        onEditEntry={handleMindMapEditEntry}
                        onDeleteEntry={handleMindMapDeleteEntry}
                        onPromoteEntryToNextStep={handleMindMapPromoteEntryToNextStep}
              onSetNextStep={handleMindMapSetNextStep}
                        onPromoteIdea={handleMindMapPromoteIdea}
                        onUpdateIdeaStatus={handleMindMapUpdateIdeaStatus}
                        onDeleteIdea={handleMindMapDeleteIdea}
                        onJumpToTimeline={handleJumpFromMindMapToTimeline}
                        focusNodeKey={focusMindMapNodeKey}
                        onSelectNodeKey={setFocusMindMapNodeKey}
                      />
                    )}
                  </>
                )}
            </div>
        </div>
      )}

      {/* CREATE / EDIT PROJECT MODAL (includes Join by Invite tab on Create) */}
      {isProjectModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsProjectModalOpen(false)}
          title={
            editingProject
              ? L('프로젝트 설정 수정', 'プロジェクト編集', 'Edit Project')
              : projectModalTab === 'JOIN'
              ? L('초대 코드 · 링크로 프로젝트 참여', '招待コード・リンクで参加', 'Join Project via Invite')
              : L('새 프로젝트 만들기', '新規プロジェクト作成', 'New Project')
          }
          maxWidth={projectModalTab === 'JOIN' && !editingProject ? 'sm' : 'xl'}
        >
          {!editingProject && (
            <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-xl bg-ivory-100 border border-ivory-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => setProjectModalTab('CREATE')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  projectModalTab === 'CREATE'
                    ? 'bg-forest-800 text-white shadow-2xs'
                    : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{L('새 프로젝트 만들기', '新規作成', 'Create New')}</span>
              </button>
              <button
                type="button"
                onClick={() => setProjectModalTab('JOIN')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  projectModalTab === 'JOIN'
                    ? 'bg-forest-800 text-white shadow-2xs'
                    : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{L('초대코드로 참여', '招待コード参加', 'Join Invite')}</span>
              </button>
            </div>
          )}

          {!editingProject && projectModalTab === 'JOIN' ? (
            <form onSubmit={handleJoinByInviteCode} className="space-y-3 text-xs">
              <p className="text-charcoal-600 leading-relaxed">
                {L(
                  '전달받은 초대 링크 전체 또는 초대 코드를 붙여넣으면 협업 프로젝트에 바로 참여할 수 있습니다.',
                  '受け取った招待リンクまたは招待コードを貼り付けるとプロジェクトに参加できます。',
                  'Paste the full invite URL or code shared with you to join the project.'
                )}
              </p>
              <input
                type="text"
                autoFocus
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                placeholder={L('초대 링크 또는 코드를 입력하세요', '招待URLまたはコードを入力', 'Paste invite URL or token...')}
                className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-mono text-charcoal-900"
              />
              {joinError && <p className="text-rose-600 font-bold">{joinError}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t border-ivory-200">
                <Button type="button" variant="secondary" onClick={() => setIsProjectModalOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" variant="primary" isLoading={isJoiningByCode}>
                  {L('참여하기', '参加する', 'Join')}
                </Button>
              </div>
            </form>
          ) : (
          <form onSubmit={handleSubmitProject} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-charcoal-800 mb-1">{L('프로젝트 이름', 'プロジェクト名', 'Project Title')} *</label>
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                required
                placeholder={L('프로젝트 이름을 입력하세요', 'プロジェクト名を入力してください', 'Enter project name')}
                className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-bold text-charcoal-900"
              />
            </div>

            {/* Mode: SOLO vs COLLAB */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormMode('SOLO')}
                className={`p-3 rounded-xl border text-left transition ${
                  formMode === 'SOLO'
                    ? 'bg-forest-50 border-forest-700 ring-2 ring-forest-600/30'
                    : 'bg-ivory-50 border-ivory-300'
                }`}
              >
                <div className="font-black text-charcoal-900 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-forest-700" />
                  <span>{L('개인 프로젝트 (비공개)', '個人プロジェクト (非公開)', 'Solo (Private)')}</span>
                </div>
                <p className="text-[11px] text-charcoal-500 mt-0.5">
                  {L('작성자 본인만 열람 가능. 내 생각·의도·할 일 정리', '本人のみ閲覧可能。思考・意図を整理', 'Only visible to you.')}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setFormMode('COLLAB')}
                className={`p-3 rounded-xl border text-left transition ${
                  formMode === 'COLLAB'
                    ? 'bg-sky-50 border-sky-600 ring-2 ring-sky-500/30'
                    : 'bg-ivory-50 border-ivory-300'
                }`}
              >
                <div className="font-black text-charcoal-900 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-700" />
                  <span>{L('협업 프로젝트', '協業プロジェクト', 'Collaboration')}</span>
                </div>
                <p className="text-[11px] text-charcoal-500 mt-0.5">
                  {L('초대 링크로 공동 작업하거나 외부 상대와의 대화를 추적', '招待リンク共有や外部相手との対話・ターンを追跡', 'Collaborate via invite link or track external partners.')}
                </p>
              </button>
            </div>

            {formMode === 'COLLAB' && (
              <div className="p-3 rounded-xl bg-sky-50/60 border border-sky-200 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFormPartnerType('SHARED')}
                    className={`py-1.5 px-2 rounded-lg border font-bold ${
                      formPartnerType === 'SHARED' ? 'bg-sky-700 text-white border-sky-800' : 'bg-white text-charcoal-700 border-sky-200'
                    }`}
                  >
                    {L('초대 링크·이메일 공동 작업', '招待リンク・メール共有', 'Invite Link / Shared')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormPartnerType('EXTERNAL')}
                    className={`py-1.5 px-2 rounded-lg border font-bold ${
                      formPartnerType === 'EXTERNAL' ? 'bg-sky-700 text-white border-sky-800' : 'bg-white text-charcoal-700 border-sky-200'
                    }`}
                  >
                    {L('앱 미가입 외부 상대 기록', 'アプリ未登録の外部相手', 'External Partner')}
                  </button>
                </div>

                {formPartnerType === 'EXTERNAL' ? (
                  <input
                    type="text"
                    value={formPartnerName}
                    onChange={(e) => setFormPartnerName(e.target.value)}
                    placeholder={L('상대방 이름 또는 업체명', '相手名・会社名', 'Partner name or company')}
                    className="w-full p-2 bg-white border border-sky-300 rounded-lg font-bold"
                  />
                ) : (
                  <p className="text-[11px] text-sky-900 bg-white/80 border border-sky-200 rounded-lg p-2 font-medium">
                    {L(
                      '생성 후 상단의 [관계자] 버튼 안 [초대·멤버] 탭에서 초대 링크를 복사하거나 이메일로 바로 초대할 수 있습니다.',
                      '作成後、上部の[関係者]ボタン内の[招待・メンバー]タブから招待リンクやメール招待を行えます。',
                      'After creation, open [People] → [Invite & Members] to share an invite link or invite by email.'
                    )}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="block font-bold text-charcoal-800 mb-1">
                {L('최초 의도 · 왜 시작했나 (Why & Goal)', '当初の意図・目的', 'Initial Intent (Why & Goal)')}
              </label>
              <textarea
                rows={3}
                value={formIntent}
                onChange={(e) => setFormIntent(e.target.value)}
                placeholder={L('나중에 잊어버리지 않도록, 내가 이 프로젝트를 시작한 이유와 방향성을 적어두세요.', '後から思い出せるよう、始めた理由や方針を残しておきましょう。', 'Write down why you started this and what direction you intended.')}
                className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg text-charcoal-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-charcoal-800 mb-1">{L('다음 할 일 (Next Step)', '次のアクション', 'Next Step')}</label>
                <input
                  type="text"
                  value={formNextAction}
                  onChange={(e) => setFormNextAction(e.target.value)}
                  placeholder={L('다음에 해야 할 일을 입력하세요', '次に行うアクションを入力してください', 'Enter next step')}
                  className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-charcoal-800 mb-1">{L('목표일 (선택)', '目標日 (任意)', 'Target Date')}</label>
                <input
                  type="date"
                  value={formNextActionDate}
                  onChange={(e) => setFormNextActionDate(e.target.value)}
                  className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-charcoal-800 mb-1">{L('방치 경보 기준', '放置アラート基準', 'Stale Alert')}</label>
                <select
                  value={formThresholdDays}
                  onChange={(e) => setFormThresholdDays(Number(e.target.value))}
                  className="w-full p-2.5 bg-ivory-50 border border-ivory-300 rounded-lg font-bold"
                >
                  <option value={3}>{L('3일 미업데이트 시 경고', '3日未更新で警告', '3 days')}</option>
                  <option value={7}>{L('7일 미업데이트 시 경고', '7日未更新で警告', '7 days')}</option>
                  <option value={14}>{L('14일 미업데이트 시 경고', '14日未更新で警告', '14 days')}</option>
                  <option value={30}>{L('30일 미업데이트 시 경고', '30日未更新で警告', '30 days')}</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-charcoal-800 mb-1">{L('구분 색상', 'ラベル色', 'Color')}</label>
                <div className="flex items-center gap-1.5 pt-1.5">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition ${
                        formColor === c ? 'border-charcoal-900 scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-ivory-200">
              <Button type="button" variant="secondary" onClick={() => setIsProjectModalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmittingProject}>
                {editingProject ? t('common.save') : L('생성하기', '作成', 'Create')}
              </Button>
            </div>
          </form>
          )}
        </Modal>
      )}

      {/* UNIFIED STAKEHOLDERS & COLLABORATION INVITE / MEMBERS MODAL */}
      {isParticipantsModalOpen && detailProject && (
        <Modal
          isOpen={true}
          onClose={() => setIsParticipantsModalOpen(false)}
          title={L('관계자 · 멤버 초대 관리', '関係者・招待・メンバー管理', 'People & Collaboration')}
          maxWidth="md"
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-ivory-100 border border-ivory-200 font-bold">
              <button
                type="button"
                onClick={() => setParticipantsModalTab('STAKEHOLDERS')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  participantsModalTab === 'STAKEHOLDERS'
                    ? 'bg-forest-800 text-white shadow-2xs'
                    : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>{L(`관계자 (${participantsDraft.length})`, `関係者 (${participantsDraft.length})`, `People (${participantsDraft.length})`)}</span>
              </button>
              <button
                type="button"
                onClick={() => setParticipantsModalTab('COLLAB')}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1.5 transition ${
                  participantsModalTab === 'COLLAB'
                    ? 'bg-forest-800 text-white shadow-2xs'
                    : 'text-charcoal-700 hover:bg-white'
                }`}
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>
                  {L(
                    `초대 · 멤버 (${(detailProject.members?.length || 0) + 1})`,
                    `招待・メンバー (${(detailProject.members?.length || 0) + 1})`,
                    `Invite (${(detailProject.members?.length || 0) + 1})`
                  )}
                </span>
              </button>
            </div>

            {participantsModalTab === 'STAKEHOLDERS' ? (
              <>
                <p className="text-charcoal-600 leading-relaxed">
                  {L(
                    '이 프로젝트에 참여하는 관계자(가족, 변호사, 거래처, 담당자 등)를 등록해 두면 타임라인에서 [상대방] 작성 시 매번 타이핑하지 않고 클릭만으로 바로 선택할 수 있습니다.',
                    'このプロジェクトに関わる関係者を登録しておくと、タイムラインで[相手]を記録する際に入力なしでワンクリック選択できます。',
                    'Register people involved in this project so you can pick them in one click when logging [Partner] entries.'
                  )}
                </p>

                {/* Quick Add Stakeholder Form */}
                <form
                  onSubmit={handleAddDraftParticipant}
                  className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newParticipantName}
                      onChange={(e) => setNewParticipantName(e.target.value)}
                      placeholder={L('이름 / 호칭 *', '氏名・呼称 *', 'Name / Label *')}
                      className="p-2 bg-white border border-ivory-300 rounded-lg font-bold text-charcoal-900"
                    />
                    <input
                      type="text"
                      value={newParticipantRole}
                      onChange={(e) => setNewParticipantRole(e.target.value)}
                      placeholder={L('역할 / 관계 (선택)', '役割・関係 (任意)', 'Role (optional)')}
                      className="p-2 bg-white border border-ivory-300 rounded-lg text-charcoal-800"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" variant="secondary" size="sm" disabled={!newParticipantName.trim()}>
                      <UserPlus className="w-3.5 h-3.5 mr-1" />
                      <span>{L('명단에 추가', 'リストに追加', 'Add Person')}</span>
                    </Button>
                  </div>
                </form>

                {/* Registered Stakeholders List */}
                {participantsDraft.length === 0 ? (
                  <div className="py-6 text-center text-charcoal-400 border border-dashed border-ivory-300 rounded-xl">
                    {L('등록된 관계자가 없습니다. 위에서 추가해 주세요.', '登録された関係者がいません。上から追加してください。', 'No stakeholders added yet.')}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {participantsDraft.map((p, idx) => (
                      <div
                        key={`draft-p-${p.name}-${idx}`}
                        className="px-3 py-2 rounded-lg bg-white border border-ivory-300 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-charcoal-900 truncate">👤 {p.name}</span>
                          {p.role && (
                            <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-900 border border-sky-200 text-[11px] font-bold shrink-0">
                              {p.role}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setParticipantsDraft((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="p-1 rounded hover:bg-rose-50 text-charcoal-400 hover:text-rose-600 shrink-0"
                          title={t('common.delete')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-ivory-200">
                  <Button type="button" variant="secondary" onClick={() => setIsParticipantsModalOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button type="button" variant="primary" isLoading={isSavingParticipants} onClick={handleSaveParticipants}>
                    {t('common.save')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Shareable Invite Link */}
                <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2">
                  <div className="font-bold text-indigo-950 flex items-center justify-between gap-2">
                    <span>{L('초대 링크로 참여시키기', '招待リンクで招待', 'Shareable Invite Link')}</span>
                    {Number(detailProject.created_by) === Number(user?.id) && (
                      <button
                        type="button"
                        onClick={handleRegenerateInvite}
                        className="text-[11px] font-bold text-indigo-700 hover:underline"
                      >
                        {detailProject.invite_token
                          ? L('링크 재발급', '再発行', 'Regenerate')
                          : L('링크 생성', 'リンク作成', 'Generate Link')}
                      </button>
                    )}
                  </div>

                  {detailProject.invite_token ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={getInviteUrl(detailProject.invite_token)}
                        className="flex-1 p-2 bg-white border border-indigo-200 rounded-lg font-mono text-[11px] text-charcoal-800"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => handleCopyInviteLink(detailProject.invite_token)}
                      >
                        {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedInvite ? L('복사됨', 'コピー済', 'Copied') : L('복사', 'コピー', 'Copy')}</span>
                      </Button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-indigo-800">
                      {L(
                        '현재 개인 비공개 프로젝트입니다. [링크 생성]을 누르면 초대 링크를 받아 협업 프로젝트로 전환됩니다.',
                        '現在非公開プロジェクトです。[リンク作成]で招待リンクを発行し協業に切替えられます。',
                        'Currently solo private. Click Generate Link to create an invite URL.'
                      )}
                    </p>
                  )}
                </div>

                {/* Invite by exact ID or email */}
                {Number(detailProject.created_by) === Number(user?.id) && (
                  <form onSubmit={handleInviteMemberByEmail} className="space-y-1.5">
                    <label className="block font-bold text-charcoal-800">
                      {L('가입된 상대 아이디(또는 이메일)로 바로 초대', '登録済みID（またはメール）で直接招待', 'Invite Registered User by ID or Email')}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder={L('상대 아이디 또는 이메일', '相手のIDまたはメール', 'Partner ID or email')}
                        className="flex-1 p-2 bg-ivory-50 border border-ivory-300 rounded-lg text-charcoal-900"
                      />
                      <Button type="submit" variant="secondary" size="sm" isLoading={isInvitingMember}>
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{L('초대', '招待', 'Invite')}</span>
                      </Button>
                    </div>
                    {inviteError && <p className="text-rose-600 font-bold">{inviteError}</p>}
                  </form>
                )}

                {/* Members list */}
                <div className="space-y-1.5">
                  <div className="font-bold text-charcoal-800">
                    {L('현재 참여 멤버', '参加メンバー', 'Current Members')}
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-ivory-50 border border-ivory-200 flex items-center justify-between">
                    <span className="font-bold text-charcoal-900">
                      👑 {detailProject.creator_name || user?.name}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-forest-100 text-forest-900">
                      {L('소유자', 'オーナー', 'Owner')}
                    </span>
                  </div>
                  {(detailProject.members || []).map((m) => (
                    <div
                      key={`mem-${m.user_id}`}
                      className="px-3 py-2 rounded-lg bg-white border border-ivory-300 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-charcoal-900 truncate">{m.name}</div>
                        <div className="text-[11px] text-charcoal-500 truncate">{m.email}</div>
                      </div>
                      {(Number(detailProject.created_by) === Number(user?.id) || Number(m.user_id) === Number(user?.id)) && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.user_id)}
                          className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-bold hover:bg-rose-100 shrink-0"
                        >
                          {Number(m.user_id) === Number(user?.id)
                            ? L('나가기', '退出', 'Leave')
                            : L('제외', '削除', 'Remove')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {spaceBridgeToast && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:max-w-sm z-50 px-4 py-2.5 rounded-xl bg-charcoal-900 text-white text-xs font-bold shadow-xl break-words">
          {spaceBridgeToast}
        </div>
      )}

      <SendFromMindmapModal
        isOpen={Boolean(spaceBridgeSource)}
        onClose={() => setSpaceBridgeSource(null)}
        source={spaceBridgeSource}
        spaces={spaces}
        activeSpaceId={activeSpaceId}
        onSentThought={() => {
          void loadProjectSpaceLinks(selectedProjectId);
          onSpacesNeedRefresh?.();
          showSpaceBridgeToast(
            L('공유 메모장으로 보냈습니다! (실시간 양방향 동기화 연결됨)', '共有メモ帳へ送りました！（双方向同期）', 'Sent to Shared Thought Pad (live sync)!')
          );
        }}
        onSentEvent={(_sid, ev) => {
          void loadProjectSpaceLinks(selectedProjectId);
          onSpacesNeedRefresh?.();
          showSpaceBridgeToast(
            L(`공유 캘린더(${ev.start_date})에 등록했습니다! (실시간 양방향 동기화 연결됨)`, `共有カレンダー(${ev.start_date})に登録しました！`, `Added to Shared Calendar (${ev.start_date})!`)
          );
        }}
      />
    </div>
  );
};
