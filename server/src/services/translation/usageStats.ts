import { db } from '../../db/database.js';
import { scheduleCloudBackup } from '../../db/cloudSync.js';
import { getJstDateTimeStr } from '../../utils/jstTime.js';

export const GEMINI_INPUT_COST_PER_MILLION_USD = 0.25;
export const GEMINI_OUTPUT_COST_PER_MILLION_USD = 1.5;
export const USD_TO_JPY_FIXED_RATE = 155;

export interface TranslationUsageSummary {
  apiCallCount: number;
  cacheHitCount: number;
  totalRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputCostJpy: number;
  outputCostJpy: number;
  totalCostJpy: number;
  pricing: {
    inputPerMillionUsd: number;
    outputPerMillionUsd: number;
    usdToJpyRate: number;
  };
  activeProvider: string;
  activeModel: string;
  lastModel: string | null;
  lastUsedAt: string | null;
  resetAt: string | null;
}

interface UsageRow {
  api_call_count: number;
  cache_hit_count: number;
  input_tokens: number;
  output_tokens: number;
  last_model: string | null;
  last_used_at: string | null;
  reset_at: string | null;
}

function ensureUsageRow(): void {
  try {
    db.prepare('INSERT OR IGNORE INTO translation_usage_stats (id) VALUES (1)').run();
  } catch {
    // Table may not be initialized yet
  }
}

export function recordGeminiApiUsage(
  inputTokens: number,
  outputTokens: number,
  model: string
): void {
  const safeInput = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.floor(inputTokens) : 0;
  const safeOutput = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.floor(outputTokens) : 0;
  const now = getJstDateTimeStr();

  try {
    ensureUsageRow();
    db.prepare(
      `UPDATE translation_usage_stats
       SET api_call_count = api_call_count + 1,
           input_tokens = input_tokens + ?,
           output_tokens = output_tokens + ?,
           last_model = ?,
           last_used_at = ?
       WHERE id = 1`
    ).run(safeInput, safeOutput, model || null, now);
    scheduleCloudBackup('translation_usage', 30000);
  } catch (err) {
    console.warn('[TranslationUsage] Failed to record Gemini usage:', err);
  }
}

export function recordTranslationCacheHit(): void {
  try {
    ensureUsageRow();
    db.prepare(
      `UPDATE translation_usage_stats
       SET cache_hit_count = cache_hit_count + 1
       WHERE id = 1`
    ).run();
    scheduleCloudBackup('translation_usage', 30000);
  } catch {
    // non-fatal
  }
}

export function getTranslationUsageStats(
  activeProvider: string,
  activeModel: string
): TranslationUsageSummary {
  ensureUsageRow();
  let row: UsageRow | undefined;
  try {
    row = db
      .prepare(
        `SELECT api_call_count, cache_hit_count, input_tokens, output_tokens,
                last_model, last_used_at, reset_at
         FROM translation_usage_stats
         WHERE id = 1`
      )
      .get() as UsageRow | undefined;
  } catch {
    row = undefined;
  }

  const apiCallCount = Number(row?.api_call_count || 0);
  const cacheHitCount = Number(row?.cache_hit_count || 0);
  const inputTokens = Number(row?.input_tokens || 0);
  const outputTokens = Number(row?.output_tokens || 0);
  const totalTokens = inputTokens + outputTokens;

  const inputCostUsd = (inputTokens / 1_000_000) * GEMINI_INPUT_COST_PER_MILLION_USD;
  const outputCostUsd = (outputTokens / 1_000_000) * GEMINI_OUTPUT_COST_PER_MILLION_USD;
  const totalCostUsd = inputCostUsd + outputCostUsd;

  const inputCostJpy = inputCostUsd * USD_TO_JPY_FIXED_RATE;
  const outputCostJpy = outputCostUsd * USD_TO_JPY_FIXED_RATE;
  const totalCostJpy = totalCostUsd * USD_TO_JPY_FIXED_RATE;

  return {
    apiCallCount,
    cacheHitCount,
    totalRequestCount: apiCallCount + cacheHitCount,
    inputTokens,
    outputTokens,
    totalTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    inputCostJpy,
    outputCostJpy,
    totalCostJpy,
    pricing: {
      inputPerMillionUsd: GEMINI_INPUT_COST_PER_MILLION_USD,
      outputPerMillionUsd: GEMINI_OUTPUT_COST_PER_MILLION_USD,
      usdToJpyRate: USD_TO_JPY_FIXED_RATE,
    },
    activeProvider,
    activeModel,
    lastModel: row?.last_model || null,
    lastUsedAt: row?.last_used_at || null,
    resetAt: row?.reset_at || null,
  };
}

export function resetTranslationUsageStats(
  activeProvider: string,
  activeModel: string
): TranslationUsageSummary {
  const now = getJstDateTimeStr();
  ensureUsageRow();
  db.prepare(
    `UPDATE translation_usage_stats
     SET api_call_count = 0,
         cache_hit_count = 0,
         input_tokens = 0,
         output_tokens = 0,
         reset_at = ?
     WHERE id = 1`
  ).run(now);
  scheduleCloudBackup('translation_usage_reset', 1200);
  return getTranslationUsageStats(activeProvider, activeModel);
}
