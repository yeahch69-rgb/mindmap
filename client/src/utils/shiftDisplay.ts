export interface SyncedShiftRow {
  work_date: string;
  shift_type: string;
  secondary_shift_type?: string | null;
}

export interface CompactShiftBadge {
  label: string;
  title: string;
  className: string;
  secondaryLabel?: string;
  secondaryClassName?: string;
}

type LocalizeFn = (ko: string, ja: string, en: string) => string;

function getSecondaryCompactMeta(
  secType: string | null | undefined,
  L: LocalizeFn
): { label: string; title: string; className: string } | null {
  switch (secType) {
    case 'HALF_OFF_AM':
      return {
        label: L('전공', '前公', 'AM½'),
        title: L('오전반공휴(0.5)', '午前半公休(0.5)', 'AM Off(0.5)'),
        className: 'bg-teal-100 text-teal-800 border-teal-300',
      };
    case 'HALF_OFF_PM':
      return {
        label: L('후공', '後公', 'PM½'),
        title: L('오후반공휴(0.5)', '午後半公休(0.5)', 'PM Off(0.5)'),
        className: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      };
    case 'HALF_LEAVE_AM':
      return {
        label: L('전', '前', 'AL½'),
        title: L('오전반차(0.5)', '前半休(0.5)', 'AM AL(0.5)'),
        className: 'bg-orange-100 text-orange-800 border-orange-300',
      };
    case 'HALF_LEAVE_PM':
      return {
        label: L('후', '後', 'AL½'),
        title: L('오후반차(0.5)', '後半休(0.5)', 'PM AL(0.5)'),
        className: 'bg-amber-100 text-amber-800 border-amber-300',
      };
    default:
      return null;
  }
}

/**
 * Returns the 1-2 character compact shift badge matching NYGC Shared Calendar's legend.
 * Start times are intentionally excluded from NYGC -> Mindmap sync.
 */
export function getCompactShiftBadge(
  type: string | null | undefined,
  secondaryType: string | null | undefined,
  L: LocalizeFn
): CompactShiftBadge | null {
  if (!type || type === 'UNSET') return null;

  let base: CompactShiftBadge | null = null;
  switch (type) {
    case 'WORK':
      base = {
        label: L('출', '出', 'In'),
        title: L('출근', '出勤', 'Work'),
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      };
      break;
    case 'BUSINESS_TRIP':
      base = {
        label: L('장', '張', 'Tr'),
        title: L('출장', '出張', 'Trip'),
        className: 'bg-blue-100 text-blue-800 border-blue-300',
      };
      break;
    case 'SHUTTLE':
      base = {
        label: L('송', '送', 'Sh'),
        title: L('송영', '送迎', 'Shuttle'),
        className: 'bg-violet-100 text-violet-800 border-violet-300',
      };
      break;
    case 'EARLY_MORNING':
    case 'EARLY':
    case 'MORNING':
      base = {
        label: L('조', '早', 'Ear'),
        title: L('조조', '早朝', 'Early'),
        className: 'bg-sky-100 text-sky-800 border-sky-300',
      };
      break;
    case 'HALF_OFF_AM':
    case 'HALF_DAY_PM':
      base = {
        label: L('전공', '前公', 'AM½'),
        title: L('오전반공휴(0.5)', '午前半公休(0.5)', 'AM Off(0.5)'),
        className: 'bg-teal-100 text-teal-800 border-teal-300',
      };
      break;
    case 'HALF_OFF_PM':
    case 'HALF_DAY_AM':
      base = {
        label: L('후공', '後公', 'PM½'),
        title: L('오후반공휴(0.5)', '午後半公休(0.5)', 'PM Off(0.5)'),
        className: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      };
      break;
    case 'REGULAR':
    case 'DAY':
    case 'AFTERNOON':
      base = {
        label: L('정', '遅', 'Reg'),
        title: L('정출', '遅番', 'Reg'),
        className: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      };
      break;
    case 'FULL_DAY':
      base = {
        label: L('종', '終', 'All'),
        title: L('종일', '終日', 'Full'),
        className: 'bg-amber-100 text-amber-800 border-amber-300',
      };
      break;
    case 'NIGHT':
      base = {
        label: L('야', '夜', 'Ngt'),
        title: L('야간', '夜勤', 'Night'),
        className: 'bg-purple-100 text-purple-800 border-purple-300',
      };
      break;
    case 'ANNUAL_LEAVE':
      base = {
        label: L('연', '有', 'AL'),
        title: L('연차(1일)', '有休(1日)', 'AL (1d)'),
        className: 'bg-rose-100 text-rose-800 border-rose-300',
      };
      break;
    case 'HALF_LEAVE_AM':
      base = {
        label: L('전', '前', 'AL½'),
        title: L('오전반차(0.5)', '前半休(0.5)', 'AM AL(0.5)'),
        className: 'bg-orange-100 text-orange-800 border-orange-300',
      };
      break;
    case 'HALF_LEAVE_PM':
      base = {
        label: L('후', '後', 'AL½'),
        title: L('오후반차(0.5)', '後半休(0.5)', 'PM AL(0.5)'),
        className: 'bg-amber-100 text-amber-800 border-amber-300',
      };
      break;
    case 'OFF':
      base = {
        label: L('휴', '休', 'Off'),
        title: L('휴무(공휴)', '公休', 'Day Off'),
        className: 'bg-rose-100 text-rose-800 border-rose-300',
      };
      break;
    default:
      return null;
  }

  if (type === 'BUSINESS_TRIP' && secondaryType) {
    const sec = getSecondaryCompactMeta(secondaryType, L);
    if (sec) {
      base.secondaryLabel = sec.label;
      base.secondaryClassName = sec.className;
      base.title = `${base.title} + ${sec.title}`;
    }
  }

  return base;
}
