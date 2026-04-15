import type { GpuVendor, HardwareProfile, LangPrefs, Recipe } from './types.js';

// ─── Built-in Recipes ─────────────────────────────────────────────────────────

export const BUILT_IN_RECIPES: Recipe[] = [
  // ── Media server ──────────────────────────────────────────────────────────
  {
    id: 'plex-ready',
    name: 'Plex / Jellyfin Ready',
    description: 'Ensure direct play in Plex and Jellyfin without server-side transcoding. H.264 High L4.1 + AAC + MP4 faststart.',
    targetCodec: 'h264',
    targetContainer: 'mp4',
    icon: '🎬',
    color: '#e5a00d',
    estimatedReduction: 15,
  },
  // ── Core compression ───────────────────────────────────────────────────────
  {
    id: 'space-saver',
    name: 'Space Saver',
    description: 'Shrink your library by ~40% with no perceptible quality loss. H.265 (HEVC) encode, copy all audio tracks.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🗜️',
    color: '#00d9ff',
    estimatedReduction: 40,
  },
  {
    id: 'universal-player',
    name: 'Universal Player',
    description: 'Play on any device, TV, or browser without format issues. H.264 + AAC — the most broadly supported format.',
    targetCodec: 'h264',
    targetContainer: 'mp4',
    icon: '▶️',
    color: '#00ff88',
    estimatedReduction: 20,
  },
  {
    id: 'av1-balanced',
    name: 'AV1 Balanced',
    description: 'Maximum storage efficiency for long-term archiving. AV1 at quality 32 — 40–60% smaller than H.264. Slow to encode.',
    targetCodec: 'av1',
    targetContainer: 'mkv',
    icon: '⚡',
    color: '#a78bfa',
    estimatedReduction: 55,
  },
  {
    id: 'remux-to-mkv',
    name: 'Remux to MKV',
    description: 'Repackage into MKV with zero re-encoding and zero quality loss. Use to consolidate container formats.',
    targetCodec: 'copy',
    targetContainer: 'mkv',
    icon: '📦',
    color: '#6b7280',
    estimatedReduction: 0,
  },
  {
    id: 'web-optimized',
    name: 'Web Optimised',
    description: 'Stream in a browser tab or embed on a website. H.264 + AAC, capped at 1080p, MP4 with instant-play faststart.',
    targetCodec: 'h264',
    targetContainer: 'mp4',
    icon: '🌐',
    color: '#38bdf8',
    estimatedReduction: 25,
  },
  // ── Downscaling ───────────────────────────────────────────────────────────
  {
    id: 'downscale-1080p',
    name: '4K → 1080p',
    description: 'Reclaim storage and support 4K-limited devices. Downscales to 1080p H.265 while preserving HDR tone.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '📐',
    color: '#ffb300',
    estimatedReduction: 60,
  },
  {
    id: 'downscale-720p',
    name: '4K/1080p → 720p',
    description: 'Optimise for mobile and tablet viewing. Downscales to 720p H.265 — large size reduction, still great on small screens.',
    targetCodec: 'hevc',
    targetContainer: 'mp4',
    icon: '📱',
    color: '#fb923c',
    estimatedReduction: 70,
  },
  // ── Specialty ─────────────────────────────────────────────────────────────
  {
    id: 'anime-cleaner',
    name: 'Anime Cleaner',
    description: 'Clean up bloated fansub releases — keeps Japanese + English audio, preserves all subtitles, re-encodes to H.265.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🌸',
    color: '#ff6eb4',
    estimatedReduction: 45,
  },
  {
    id: 'audio-normalizer',
    name: 'Audio Normalizer',
    description: 'Fix wildly inconsistent volume levels across your library. Applies EBU R128 loudness normalization.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🔊',
    color: '#a78bfa',
    estimatedReduction: 35,
  },
  {
    id: 'hdr-to-sdr',
    name: 'HDR → SDR Tonemap',
    description: 'Fix washed-out HDR on non-HDR screens. Tonemaps HDR10 to SDR BT.709 using zscale.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🌅',
    color: '#f59e0b',
    estimatedReduction: 30,
  },
];

// ─── Hardware-Aware Encoder Selection ────────────────────────────────────────

function getVideoEncoder(hw: HardwareProfile, codec: 'h265' | 'h264' | 'av1'): string {
  if (codec === 'h265') {
    if (hw.gpu === 'nvidia' && hw.encoders.includes('hevc_nvenc')) return 'hevc_nvenc';
    if (hw.gpu === 'amd'    && hw.encoders.includes('hevc_amf'))   return 'hevc_amf';
    if (hw.gpu === 'intel'  && hw.encoders.includes('hevc_qsv'))   return 'hevc_qsv';
    return 'libx265';
  }
  if (codec === 'h264') {
    if (hw.gpu === 'nvidia' && hw.encoders.includes('h264_nvenc')) return 'h264_nvenc';
    if (hw.gpu === 'amd'    && hw.encoders.includes('h264_amf'))   return 'h264_amf';
    if (hw.gpu === 'intel'  && hw.encoders.includes('h264_qsv'))   return 'h264_qsv';
    return 'libx264';
  }
  if (codec === 'av1') {
    if (hw.gpu === 'nvidia' && hw.encoders.includes('av1_nvenc')) return 'av1_nvenc';
    if (hw.gpu === 'amd'    && hw.encoders.includes('av1_amf'))   return 'av1_amf';
    if (hw.gpu === 'intel'  && hw.encoders.includes('av1_qsv'))   return 'av1_qsv';
    return 'libsvtav1';
  }
  return 'libx264';
}

// ─── Language Map Helper ──────────────────────────────────────────────────────

/**
 * Returns explicit -map args for selecting preferred audio/subtitle tracks.
 * When no langs are specified, returns [] and ffmpeg's default stream selection applies.
 */
function buildLangMaps(langs: LangPrefs | undefined): string[] {
  if (!langs?.audioLang && !langs?.subtitleLang) return [];
  const m: string[] = ['-map', '0:v'];
  if (langs.audioLang) {
    m.push('-map', `0:a:m:language:${langs.audioLang}?`);
  } else {
    m.push('-map', '0:a');
  }
  if (langs.subtitleLang) {
    m.push('-map', `0:s:m:language:${langs.subtitleLang}?`);
  } else {
    m.push('-map', '0:s?');
  }
  return m;
}

// ─── FFmpeg Args Builder ──────────────────────────────────────────────────────

// CPU-only video filter patterns that are incompatible with zero-copy CUDA surface output.
// Community recipes containing these patterns must not use -hwaccel_output_format cuda.
const CUDA_INCOMPATIBLE_FILTER_PATTERNS = ['zscale=', 'zscale,', 'yadif', 'drawtext=', 'scale=', 'scale,'];

export function buildFfmpegArgs(recipe: Recipe, hw: HardwareProfile, langs?: LangPrefs): string[] {
  // Community/custom recipes supply their own args — return them directly.
  // For NVIDIA CUDA builds: detect CPU-only filters that can't run on CUDA surfaces
  // and suppress zero-copy mode (handled in getHwDecodeArgs via recipeId check).
  if (recipe.ffmpegArgs && recipe.ffmpegArgs.length > 0) {
    return recipe.ffmpegArgs;
  }

  const args: string[] = [];

  switch (recipe.id) {
    case 'plex-ready': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h264');
      args.push('-c:v', enc);
      // Level 5.1 supports up to 4K (4096×2304); 4.1 only allows up to 1080p and causes
      // nvenc to reject 4K input with "Nothing was written into output file"
      if (enc === 'libx264') args.push('-crf', '20', '-preset', 'fast', '-profile:v', 'high', '-level:v', '5.1');
      else args.push('-qp', '20', '-preset', 'p2', '-profile:v', 'high', '-level:v', '5.1');
      args.push('-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text', '-movflags', '+faststart');
      break;
    }
    case 'space-saver': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '28', '-preset', 'slow');
      else args.push('-qp', '24', '-preset', 'p4');
      args.push('-c:a', 'copy');
      break;
    }
    case 'universal-player': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h264');
      args.push('-c:v', enc);
      if (enc === 'libx264') args.push('-crf', '23', '-preset', 'fast');
      else args.push('-qp', '23', '-preset', 'p2');
      args.push('-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text');
      break;
    }
    case 'av1-balanced': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'av1');
      args.push('-c:v', enc);
      if (enc === 'libsvtav1') args.push('-crf', '32', '-preset', '6');
      else if (enc === 'av1_nvenc') args.push('-qp', '32', '-preset', 'p4');
      else args.push('-qp', '32');
      args.push('-c:a', 'copy');
      break;
    }
    case 'remux-to-mkv': {
      args.push(...buildLangMaps(langs));
      args.push('-c:v', 'copy', '-c:a', 'copy', '-c:s', 'copy');
      break;
    }
    case 'web-optimized': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h264');
      args.push('-vf', 'scale=\'min(1920,iw)\':\'min(1080,ih)\':force_original_aspect_ratio=decrease');
      args.push('-c:v', enc);
      if (enc === 'libx264') args.push('-crf', '23', '-preset', 'fast', '-movflags', '+faststart');
      else args.push('-qp', '23', '-preset', 'p2', '-movflags', '+faststart');
      args.push('-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text');
      break;
    }
    case 'anime-cleaner': {
      // anime-cleaner has its own explicit mapping — lang prefs are ignored
      const enc = getVideoEncoder(hw, 'h265');
      args.push(
        '-map', '0:v',
        '-map', '0:a:m:language:jpn?',
        '-map', '0:a:m:language:eng?',
        '-map', '0:s?',
        '-c:v', enc,
      );
      if (enc === 'libx265') args.push('-crf', '20', '-preset', 'slow');
      else args.push('-qp', '20', '-preset', 'p4');
      args.push('-c:a', 'copy', '-c:s', 'copy');
      break;
    }
    case 'downscale-1080p': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-vf', 'scale=1920:1080:flags=lanczos', '-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '22', '-preset', 'slow');
      else args.push('-qp', '22', '-preset', 'p4');
      args.push('-c:a', 'copy');
      break;
    }
    case 'downscale-720p': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-vf', 'scale=1280:720:flags=lanczos', '-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '24', '-preset', 'fast');
      else args.push('-qp', '24', '-preset', 'p3');
      args.push('-c:a', 'aac', '-b:a', '128k', '-c:s', 'mov_text');
      break;
    }
    case 'audio-normalizer': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '20', '-preset', 'slow');
      else args.push('-qp', '20', '-preset', 'p4');
      args.push('-af', 'loudnorm=I=-23:LRA=7:TP=-2', '-c:a', 'aac', '-b:a', '256k');
      break;
    }
    case 'hdr-to-sdr': {
      args.push(...buildLangMaps(langs));
      const enc = getVideoEncoder(hw, 'h265');
      args.push(
        '-vf', 'zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709,format=yuv420p',
        '-c:v', enc,
      );
      if (enc === 'libx265') args.push('-crf', '22', '-preset', 'slow');
      else args.push('-qp', '22', '-preset', 'p4');
      args.push('-c:a', 'copy');
      break;
    }
    default:
      throw new Error(`Unknown recipe: ${recipe.id}`);
  }

  return args;
}

// ─── Hardware Decode Args ─────────────────────────────────────────────────────

// Recipes that use CPU-only video filters — cannot use zero-copy CUDA surface output.
const CUDA_INCOMPATIBLE_RECIPES = new Set(['hdr-to-sdr', 'web-optimized', 'remux-to-mkv']);

/**
 * Returns hardware decode args for ffmpeg.
 *
 * @param hw        - Worker hardware profile
 * @param recipeId  - Optional recipe ID; if the recipe or its ffmpegArgs contain CPU-only
 *                    filters, zero-copy CUDA output is suppressed to avoid surface format errors.
 * @param customArgs - Optional community recipe args to scan for CPU-incompatible filters
 */
export function getHwDecodeArgs(hw: HardwareProfile, recipeId?: string, customArgs?: string[]): string[] {
  if (hw.gpu === 'nvidia' && hw.hwaccels.includes('cuda')) {
    // Check if the recipe requires CPU-only filters (can't use zero-copy surface output)
    const isCudaIncompat = (recipeId && CUDA_INCOMPATIBLE_RECIPES.has(recipeId))
      || (customArgs && customArgs.some(a => CUDA_INCOMPATIBLE_FILTER_PATTERNS.some(p => a.includes(p))));

    if (isCudaIncompat) {
      // GPU decode only — frames will be copied to CPU before filtering
      return ['-hwaccel', 'cuda'];
    }
    // Zero-copy: decode on GPU, keep frames as CUDA surfaces for NVENC
    return ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'];
  }
  if (hw.gpu === 'intel' && hw.hwaccels.includes('qsv')) {
    return ['-hwaccel', 'qsv'];
  }
  return [];
}

// ─── Smart-filter: should we skip this file? ─────────────────────────────────

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
export function shouldSkipFile(currentCodec: string, recipe: Recipe): boolean {
  // These recipes do more than just transcode video — always run them
  const noSkipRecipes = ['anime-cleaner', 'audio-normalizer', 'hdr-to-sdr', 'remux-to-mkv'];
  if (noSkipRecipes.includes(recipe.id)) return false;

  const normalized = currentCodec.toLowerCase();
  const target      = recipe.targetCodec.toLowerCase();

  // Custom recipes with ffmpegArgs — never auto-skip
  if (target === 'copy') return false;

  const hevcAliases = ['hevc', 'h265', 'h.265'];
  const h264Aliases = ['h264', 'h.264', 'avc'];
  const av1Aliases  = ['av1'];

  if (target === 'hevc') return hevcAliases.some(a => normalized.includes(a));
  if (target === 'h264') return h264Aliases.some(a => normalized.includes(a));
  if (target === 'av1')  return av1Aliases.some(a => normalized.includes(a));
  return normalized.includes(target);
}
