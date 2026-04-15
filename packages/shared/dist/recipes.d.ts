import type { HardwareProfile, LangPrefs, Recipe } from './types.js';
export declare const BUILT_IN_RECIPES: Recipe[];
export declare function buildFfmpegArgs(recipe: Recipe, hw: HardwareProfile, langs?: LangPrefs): string[];
/**
 * Returns hardware decode args for ffmpeg.
 *
 * @param hw        - Worker hardware profile
 * @param recipeId  - Optional recipe ID; if the recipe or its ffmpegArgs contain CPU-only
 *                    filters, zero-copy CUDA output is suppressed to avoid surface format errors.
 * @param customArgs - Optional community recipe args to scan for CPU-incompatible filters
 */
export declare function getHwDecodeArgs(hw: HardwareProfile, recipeId?: string, customArgs?: string[]): string[];
/**
 * Determines if a file should be skipped for a given recipe.
 *
 * For codec-only recipes (space-saver, universal-player, downscale),
 * skip if the file is already in the target codec.
 *
 * For intent-driven recipes (anime-cleaner, audio-normalizer),
 * never skip — the recipe's value is in audio/subtitle processing,
 * not just codec conversion.
 */
export declare function shouldSkipFile(currentCodec: string, recipe: Recipe): boolean;
//# sourceMappingURL=recipes.d.ts.map