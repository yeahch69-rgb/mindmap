import React, { useEffect, useRef, useState } from 'react';
import { BookMarked, ChevronDown, ExternalLink } from 'lucide-react';
import { CollabSpace } from '../../types/spaces';
import { useLanguage } from '../../context/LanguageContext';

interface LinkedProjectsHeaderControlProps {
  space: CollabSpace;
  onJumpToMindmapProject: (projectId: number) => void;
}

export const LinkedProjectsHeaderControl: React.FC<LinkedProjectsHeaderControlProps> = ({
  space,
  onJumpToMindmapProject,
}) => {
  const { L } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const accessibleProjects =
    space.linked_projects && space.linked_projects.length > 0
      ? space.linked_projects
      : space.linked_project
        ? [space.linked_project]
        : [];

  useEffect(() => {
    setOpen(false);
  }, [space.id]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  if (accessibleProjects.length === 0) return null;

  if (accessibleProjects.length === 1) {
    const proj = accessibleProjects[0];
    return (
      <button
        type="button"
        onClick={() => onJumpToMindmapProject(proj.id)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold transition max-w-[200px]"
        title={L(
          `연동 프로젝트 열기: ${proj.title}`,
          `連携プロジェクトを開く: ${proj.title}`,
          `Open linked project: ${proj.title}`
        )}
      >
        <BookMarked className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
        <span className="truncate hidden sm:inline">{proj.title}</span>
        <ExternalLink className="w-3 h-3 text-indigo-500 shrink-0" />
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold transition"
        title={L(
          `참여 중인 연동 프로젝트 ${accessibleProjects.length}개`,
          `参加中の連携プロジェクト ${accessibleProjects.length}件`,
          `${accessibleProjects.length} joined linked projects`
        )}
      >
        <BookMarked className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
        <span className="hidden sm:inline">
          {L(
            `연동 프로젝트 (${accessibleProjects.length})`,
            `連携プロジェクト (${accessibleProjects.length})`,
            `Projects (${accessibleProjects.length})`
          )}
        </span>
        <span className="sm:hidden">{accessibleProjects.length}</span>
        <ChevronDown className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white border border-ivory-300 shadow-lg py-1.5 z-40">
          <div className="px-3 py-1 text-[10px] font-bold text-charcoal-400 uppercase tracking-wider border-b border-ivory-100">
            {L('참여 중인 연동 프로젝트', '参加中の連携プロジェクト', 'Joined Linked Projects')}
          </div>
          <div className="max-h-60 overflow-y-auto divide-y divide-ivory-100">
            {accessibleProjects.map((proj) => (
              <button
                key={proj.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onJumpToMindmapProject(proj.id);
                }}
                className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs hover:bg-indigo-50/70 transition"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: proj.color || '#1B4D3E' }}
                  />
                  <span className="font-bold text-charcoal-900 truncate">{proj.title}</span>
                </div>
                <ExternalLink className="w-3 h-3 text-indigo-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
