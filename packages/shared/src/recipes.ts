import type { GpuVendor, HardwareProfile, Recipe } from './types.js';

// ─── Built-in Recipes ─────────────────────────────────────────────────────────

export const BUILT_IN_RECIPES: Recipe[] = [
  // ── Core compression ───────────────────────────────────────────────────────
  {
    id: 'space-saver',
    name: 'Space Saver',
    description: 'Convert to H.265 (HEVC), keep original resolution, copy all audio. Best general-purpose compression.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🗜️',
    color: '#00d9ff',
    estimatedReduction: 40,
  },
  {
    id: 'universal-player',
    name: 'Universal Player',
    description: 'Convert to H.264 with AAC audio. Maximum compatibility — plays everywhere.',
    targetCodec: 'h264',
    targetContainer: 'mp4',
    icon: '▶️',
    color: '#00ff88',
    estimatedReduction: 20,
  },
  {
    id: 'av1-balanced',
    name: 'AV1 Balanced',
    description: 'AV1 encode at quality 32. 40–60% smaller than H.264 at similar quality. Slower to encode.',
    targetCodec: 'av1',
    targetContainer: 'mkv',
    icon: '⚡',
    color: '#a78bfa',
    estimatedReduction: 55,
  },
  {
    id: 'remux-to-mkv',
    name: 'Remux to MKV',
    description: 'Copy all streams into an MKV container with no re-encoding. Fastest possible — zero quality loss.',
    targetCodec: 'copy',
    targetContainer: 'mkv',
    icon: '📦',
    color: '#6b7280',
    estimatedReduction: 0,
  },
  {
    id: 'web-optimized',
    name: 'Web Optimised',
    description: 'H.264 + AAC, capped at 1080p, with faststart flag for instant browser playback.',
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
    description: 'Downscale 4K HDR content to 1080p H.265. Perfect for devices that cannot handle 4K.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '📐',
    color: '#ffb300',
    estimatedReduction: 60,
  },
  {
    id: 'downscale-720p',
    name: '4K/1080p → 720p',
    description: 'Downscale to 720p H.265. Good for mobile and tablet viewing with minimal storage.',
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
    description: 'Strip all audio except Japanese and English tracks. Remove bloat from standard anime releases.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🌸',
    color: '#ff6eb4',
    estimatedReduction: 45,
  },
  {
    id: 'audio-normalizer',
    name: 'Audio Normalizer',
    description: 'Apply EBU R128 loudness normalization. Fix movies that are too quiet or brutally loud.',
    targetCodec: 'hevc',
    targetContainer: 'mkv',
    icon: '🔊',
    color: '#a78bfa',
    estimatedReduction: 35,
  },
  {
    id: 'hdr-to-sdr',
    name: 'HDR → SDR Tonemap',
    description: 'Tonemap HDR10 content to SDR with zscale. Fixes washed-out HDR on non-HDR screens.',
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

// ─── FFmpeg Args Builder ──────────────────────────────────────────────────────

export function buildFfmpegArgs(recipe: Recipe, hw: HardwareProfile): string[] {
  // Community/custom recipes supply their own args
  if (recipe.ffmpegArgs && recipe.ffmpegArgs.length > 0) {
    return recipe.ffmpegArgs;
  }

  const args: string[] = [];

  switch (recipe.id) {
    case 'space-saver': {
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '28', '-preset', 'slow');
      else args.push('-qp', '24', '-preset', 'p4');
      args.push('-c:a', 'copy');
      break;
    }
    case 'universal-player': {
      const enc = getVideoEncoder(hw, 'h264');
      args.push('-c:v', enc);
      if (enc === 'libx264') args.push('-crf', '23', '-preset', 'fast');
      else args.push('-qp', '23', '-preset', 'p2');
      args.push('-c:a', 'aac', '-b:a', '192k');
      break;
    }
    case 'av1-balanced': {
      const enc = getVideoEncoder(hw, 'av1');
      args.push('-c:v', enc);
      if (enc === 'libsvtav1') args.push('-crf', '32', '-preset', '6');
      else if (enc === 'av1_nvenc') args.push('-qp', '32', '-preset', 'p4');
      else args.push('-qp', '32');
      args.push('-c:a', 'copy');
      break;
    }
    case 'remux-to-mkv': {
      args.push('-c:v', 'copy', '-c:a', 'copy', '-c:s', 'copy');
      break;
    }
    case 'web-optimized': {
      const enc = getVideoEncoder(hw, 'h264');
      args.push('-vf', 'scale=\'min(1920,iw)\':\'min(1080,ih)\':force_original_aspect_ratio=decrease');
      args.push('-c:v', enc);
      if (enc === 'libx264') args.push('-crf', '23', '-preset', 'fast', '-movflags', '+faststart');
      else args.push('-qp', '23', '-preset', 'p2', '-movflags', '+faststart');
      args.push('-c:a', 'aac', '-b:a', '192k');
      break;
    }
    case 'anime-cleaner': {
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
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-vf', 'scale=1920:1080:flags=lanczos', '-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '22', '-preset', 'slow');
      else args.push('-qp', '22', '-preset', 'p4');
      args.push('-c:a', 'copy');
      break;
    }
    case 'downscale-720p': {
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-vf', 'scale=1280:720:flags=lanczos', '-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '24', '-preset', 'fast');
      else args.push('-qp', '24', '-preset', 'p3');
      args.push('-c:a', 'aac', '-b:a', '128k');
      break;
    }
    case 'audio-normalizer': {
      const enc = getVideoEncoder(hw, 'h265');
      args.push('-c:v', enc);
      if (enc === 'libx265') args.push('-crf', '20', '-preset', 'slow');
      else args.push('-qp', '20', '-preset', 'p4');
      args.push('-af', 'loudnorm=I=-23:LRA=7:TP=-2', '-c:a', 'aac', '-b:a', '256k');
      break;
    }
    case 'hdr-to-sdr': {
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

export function getHwDecodeArgs(hw: HardwareProfile): string[] {
  if (hw.gpu === 'nvidia' && hw.hwaccels.includes('cuda')) {
    return ['-hwaccel', 'auto'];
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
