import React from 'react';
import { Cake } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { CollabSpace } from '../../types/spaces';
import { Modal } from '../common/Modal';
import { SpaceAnniversariesSection } from '../spaces/SpaceAnniversariesSection';

interface AnniversaryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace | null;
  onChanged: () => Promise<void> | void;
}

export const AnniversaryManagerModal: React.FC<AnniversaryManagerModalProps> = ({
  isOpen,
  onClose,
  space,
  onChanged,
}) => {
  const { L } = useLanguage();

  if (!space) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <Cake className="w-4 h-4" />
          </span>
          <span className="truncate">
            {space.name} · {L('기념일 · D-Day 관리', '記念日・D-Day管理', 'Manage Anniversaries & D-Day')}
          </span>
        </div>
      }
    >
      <SpaceAnniversariesSection
        spaceId={space.id}
        isOpen={isOpen}
        onChanged={onChanged}
      />
    </Modal>
  );
};
