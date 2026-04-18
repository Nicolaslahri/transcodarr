import type { HardwareProfile, LangPrefs, Recipe } from './types.js';
export declare const BUILT_IN_RECIPES: Recipe[];
export declare function buildFfmpegArgs(recipe: Recipe, hw: HardwareProfile, langs?: LangPrefs): string[];
/**
 * Returns hardware decode args for ffmpeg.
 *
 * @param hw         - Worker hardware profile
 * @param recipeId   - Recipe ID; used to detect CPU-filter recipes that can't
 *                     use zero-copy CUDA surface output.
 * @param customArgs - Community recipe args to scan for CPU-incompatible filters
 */
export declare function getHwDecodeArgs(hw: HardwareProfile, recipeId?: string, customArgs?: string[]): string[];
/**
 * Determines if a file should be skipped for a given recipe.
 *
 * For codec-targeting recipes (space-saver, plex-ready, quality-archive…),
 * skip if the file is already in the target codec — no point re-encoding
 * H.265 → H.265, or re-encoding a file that would only get larger.
 *
 * For intent-driven recipes (anime-cleaner, audio-normalizer, hdr-to-sdr,
 * remux-to-mkv) skip logic is disabled — the recipe's value is in the
 * stream selection or audio processing, not just the codec output.
 */
export declare function shouldSkipFile(currentCodec: string, recipe: Recipe): boolean;
//# sourceMappingURL=recipes.d.ts.map