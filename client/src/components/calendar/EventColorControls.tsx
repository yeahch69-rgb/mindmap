import React, { useEffect, useRef, useState } from 'react';
import { Palette, RotateCcw, Tag, Type } from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { SpaceLabelPreset } from '../../types/spaces';

export const EVENT_LABEL_COLOR_PRESETS = [
  '#1B4D3E', // Forest Green
  '#0369A1', // Ocean Blue
  '#BE123C', // Crimson Rose
  '#B45309', // Warm Amber
  '#6D28D9', // Royal Violet
  '#0F766E', // Deep Teal
  '#334155', // Charcoal Slate
  '#EC4899', // Vivid Pink
  '#FACC15', // Bright Yellow
  '#BAE6FD', // Soft Sky Pastel
];

export const EVENT_TEXT_COLOR_PRESETS = [
  '#FFFFFF', // White
  '#111827', // Black / Dark Charcoal
  '#FEF08A', // Soft Yellow
  '#1E3A8A', // Deep Navy
  '#7F1D1D', // Deep Wine
];

const PALETTE_STORAGE_KEY = 'pj_calendar_custom_palette_v1';

interface SavedPalette {
  labelColors: string[];
  textColors: string[];
}

function normalizePalette(raw: unknown, defaults: string[]): string[] {
  if (!Array.isArray(raw) || raw.length !== defaults.length) return [...defaults];
  return raw.map((c, idx) => {
    const s = String(c || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : defaults[idx];
  });
}

function readLocalPalette(): SavedPalette {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        labelColors: normalizePalette(parsed?.labelColors, EVENT_LABEL_COLOR_PRESETS),
        textColors: normalizePalette(parsed?.textColors, EVENT_TEXT_COLOR_PRESETS),
      };
    }
  } catch {}
  return {
    labelColors: [...EVENT_LABEL_COLOR_PRESETS],
    textColors: [...EVENT_TEXT_COLOR_PRESETS],
  };
}

function writeLocalPalette(palette: SavedPalette) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palette));
  } catch {}
}

interface EventColorControlsProps {
  categories: SpaceLabelPreset[];
  categoryKey: string;
  onSelectCategory: (cat: SpaceLabelPreset) => void;
  bgColor: string;
  onChangeBgColor: (hex: string) => void;
  textColor: string;
  onChangeTextColor: (hex: string) => void;
  previewTitle?: string;
}

export const EventColorControls: React.FC<EventColorControlsProps> = ({
  categories,
  categoryKey,
  onSelectCategory,
  bgColor,
  onChangeBgColor,
  textColor,
  onChangeTextColor,
  previewTitle,
}) => {
  const { L } = useLanguage();

  const [labelSlots, setLabelSlots] = useState<string[]>(() => readLocalPalette().labelColors);
  const [textSlots, setTextSlots] = useState<string[]>(() => readLocalPalette().textColors);
  const [activeLabelSlot, setActiveLabelSlot] = useState<number>(() => {
    const idx = readLocalPalette().labelColors.findIndex((c) => c.toLowerCase() === bgColor.toLowerCase());
    return idx >= 0 ? idx : 0;
  });
  const [activeTextSlot, setActiveTextSlot] = useState<number>(() => {
    const idx = readLocalPalette().textColors.findIndex((c) => c.toLowerCase() === textColor.toLowerCase());
    return idx >= 0 ? idx : 0;
  });

  const saveTimerRef = useRef<number | null>(null);

  // Sync saved palette from server on mount (so custom slots persist across PC/mobile/tablet)
  useEffect(() => {
    let mounted = true;
    api
      .get<SavedPalette>('/spaces/palette')
      .then((res) => {
        if (!mounted) return;
        const next: SavedPalette = {
          labelColors: normalizePalette(res.labelColors, EVENT_LABEL_COLOR_PRESETS),
          textColors: normalizePalette(res.textColors, EVENT_TEXT_COLOR_PRESETS),
        };
        setLabelSlots(next.labelColors);
        setTextSlots(next.textColors);
        writeLocalPalette(next);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Keep active slot synced when parent changes bgColor/textColor (e.g., category click or modal open)
  useEffect(() => {
    const idx = labelSlots.findIndex((c) => c.toLowerCase() === bgColor.toLowerCase());
    if (idx >= 0) setActiveLabelSlot(idx);
  }, [bgColor, labelSlots]);

  useEffect(() => {
    const idx = textSlots.findIndex((c) => c.toLowerCase() === textColor.toLowerCase());
    if (idx >= 0) setActiveTextSlot(idx);
  }, [textColor, textSlots]);

  const persistPalette = (nextLabelColors: string[], nextTextColors: string[]) => {
    const next = { labelColors: nextLabelColors, textColors: nextTextColors };
    writeLocalPalette(next);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      api.put('/spaces/palette', next).catch(() => {});
    }, 350);
  };

  const handleLabelRgbChange = (rawHex: string) => {
    const hex = rawHex.toUpperCase();
    onChangeBgColor(hex);
    setLabelSlots((prev) => {
      const next = prev.map((c, idx) => (idx === activeLabelSlot ? hex : c));
      persistPalette(next, textSlots);
      return next;
    });
  };

  const handleTextRgbChange = (rawHex: string) => {
    const hex = rawHex.toUpperCase();
    onChangeTextColor(hex);
    setTextSlots((prev) => {
      const next = prev.map((c, idx) => (idx === activeTextSlot ? hex : c));
      persistPalette(labelSlots, next);
      return next;
    });
  };

  const handleResetLabelDefaults = () => {
    const defaultLabels = [...EVENT_LABEL_COLOR_PRESETS];
    setLabelSlots(defaultLabels);
    onChangeBgColor(defaultLabels[activeLabelSlot] || defaultLabels[0]);
    persistPalette(defaultLabels, textSlots);
  };

  const handleResetTextDefaults = () => {
    const defaultTexts = [...EVENT_TEXT_COLOR_PRESETS];
    setTextSlots(defaultTexts);
    onChangeTextColor(defaultTexts[activeTextSlot] || defaultTexts[0]);
    persistPalette(labelSlots, defaultTexts);
  };

  const isLabelCustomized = labelSlots.some(
    (c, i) => c.toUpperCase() !== EVENT_LABEL_COLOR_PRESETS[i].toUpperCase()
  );
  const isTextCustomized = textSlots.some(
    (c, i) => c.toUpperCase() !== EVENT_TEXT_COLOR_PRESETS[i].toUpperCase()
  );

  return (
    <div className="space-y-3">
      {/* 1. Category Pills */}
      <div className="space-y-1.5">
        <div className="text-xs font-bold text-charcoal-700 flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-forest-700" />
          <span>{L('카테고리', 'カテゴリー', 'Category')}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const active = cat.key === categoryKey;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => onSelectCategory(cat)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold border transition ${
                  active
                    ? 'bg-forest-800 text-white border-forest-900 shadow-xs'
                    : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Customizable Label Color Slots (10 + RGB) & Text Color Slots (5 + RGB) + Live Preview */}
      <div className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Label Background Color Slots */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-charcoal-700 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1">
                <Palette className="w-3.5 h-3.5 text-forest-700" />
                {L('라벨 색상', 'ラベル色', 'Label Color')}
              </span>
              <span className="font-mono text-[10px] text-charcoal-500 uppercase">
                #{activeLabelSlot + 1} · {bgColor}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {labelSlots.map((hex, idx) => {
                const selected = idx === activeLabelSlot && bgColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveLabelSlot(idx);
                      onChangeBgColor(hex);
                    }}
                    title={L(
                      `슬롯 ${idx + 1} (${hex}) — 선택 후 RGB로 변경 저장`,
                      `スロット ${idx + 1} (${hex}) — RGBで変更保存`,
                      `Slot ${idx + 1} (${hex}) — adjust RGB to customize`
                    )}
                    className={`w-6 h-6 rounded-full border border-black/15 transition transform ${
                      selected ? 'ring-2 ring-offset-2 ring-charcoal-900 scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
            {/* Always-below action row: RGB Picker + Reset Default */}
            <div className="flex items-center gap-1.5">
              <label
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-ivory-300 hover:border-forest-500 text-[11px] font-bold text-charcoal-700 cursor-pointer transition"
                title={L(
                  `선택한 라벨 슬롯 #${activeLabelSlot + 1}의 색상을 RGB로 변경하여 저장`,
                  `選択中スロット #${activeLabelSlot + 1} の色をRGBで変更保存`,
                  `Edit & save Slot #${activeLabelSlot + 1} via RGB`
                )}
              >
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : '#1B4D3E'}
                  onChange={(e) => handleLabelRgbChange(e.target.value)}
                  className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                />
                <span>RGB</span>
              </label>
              <button
                type="button"
                disabled={!isLabelCustomized}
                onClick={handleResetLabelDefaults}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold transition ${
                  isLabelCustomized
                    ? 'bg-white hover:bg-ivory-100 border-ivory-300 text-charcoal-700'
                    : 'bg-ivory-100/70 border-ivory-200 text-charcoal-400 cursor-not-allowed'
                }`}
                title={L('라벨 색상 기본값으로 초기화', 'ラベル色をデフォルトに戻す', 'Reset label colors')}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{L('기본색', '初期化', 'Reset')}</span>
              </button>
            </div>
          </div>

          {/* Text Color Slots */}
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-charcoal-700 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1">
                <Type className="w-3.5 h-3.5 text-forest-700" />
                {L('텍스트 색상', '文字色', 'Text Color')}
              </span>
              <span className="font-mono text-[10px] text-charcoal-500 uppercase">
                #{activeTextSlot + 1} · {textColor}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {textSlots.map((hex, idx) => {
                const selected = idx === activeTextSlot && textColor.toLowerCase() === hex.toLowerCase();
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setActiveTextSlot(idx);
                      onChangeTextColor(hex);
                    }}
                    title={L(
                      `슬롯 ${idx + 1} (${hex}) — 선택 후 RGB로 변경 저장`,
                      `スロット ${idx + 1} (${hex}) — RGBで変更保存`,
                      `Slot ${idx + 1} (${hex}) — adjust RGB to customize`
                    )}
                    className={`w-6 h-6 rounded-full border border-charcoal-300 transition transform ${
                      selected ? 'ring-2 ring-offset-2 ring-charcoal-900 scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                );
              })}
            </div>
            {/* Always-below action row: RGB Picker + Reset Default */}
            <div className="flex items-center gap-1.5">
              <label
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white border border-ivory-300 hover:border-forest-500 text-[11px] font-bold text-charcoal-700 cursor-pointer transition"
                title={L(
                  `선택한 텍스트 슬롯 #${activeTextSlot + 1}의 색상을 RGB로 변경하여 저장`,
                  `選択中スロット #${activeTextSlot + 1} の文字色をRGBで変更保存`,
                  `Edit & save Text Slot #${activeTextSlot + 1} via RGB`
                )}
              >
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(textColor) ? textColor : '#FFFFFF'}
                  onChange={(e) => handleTextRgbChange(e.target.value)}
                  className="w-4 h-4 p-0 border-0 bg-transparent cursor-pointer"
                />
                <span>RGB</span>
              </label>
              <button
                type="button"
                disabled={!isTextCustomized}
                onClick={handleResetTextDefaults}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-bold transition ${
                  isTextCustomized
                    ? 'bg-white hover:bg-ivory-100 border-ivory-300 text-charcoal-700'
                    : 'bg-ivory-100/70 border-ivory-200 text-charcoal-400 cursor-not-allowed'
                }`}
                title={L('텍스트 색상 기본값으로 초기화', '文字色をデフォルトに戻す', 'Reset text colors')}
              >
                <RotateCcw className="w-3 h-3" />
                <span>{L('기본색', '初期化', 'Reset')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Calendar Pill Preview + Hint */}
        <div className="pt-2 border-t border-ivory-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[11px] font-bold text-charcoal-500 shrink-0">
              {L('미리보기', 'プレビュー', 'Preview')}
            </span>
            <div
              style={{ backgroundColor: bgColor, color: textColor }}
              className="px-2.5 py-1 rounded-md text-xs font-bold shadow-2xs truncate max-w-[260px]"
            >
              {previewTitle?.trim() || L('일정 표시 미리보기', '予定表示プレビュー', 'Event preview')}
            </div>
          </div>

          <span className="text-[10px] text-charcoal-400 hidden sm:inline">
            {L('프리셋 선택 후 RGB 조정 시 자동 저장', 'スロット選択後にRGB調整で自動保存', 'Select a slot + adjust RGB to save')}
          </span>
        </div>
      </div>
    </div>
  );
};
