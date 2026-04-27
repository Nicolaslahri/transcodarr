import { describe, it, expect } from 'vitest';
import {
  shouldSkipFile,
  pickVideoEncoder,
  isRecipeSupportedByWorker,
  getHwDecodeArgs,
  BUILT_IN_RECIPES,
} from '../src/recipes.js';
import type { HardwareProfile, Recipe } from '../src/types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const NVIDIA_FULL: HardwareProfile = {
  gpu: 'nvidia',
  gpuName: 'RTX 4070',
  encoders: ['hevc_nvenc', 'h264_nvenc', 'av1_nvenc', 'libx265', 'libx264', 'libsvtav1'],
  decoders: ['hevc_cuvid'],
  hwaccels: ['cuda'],
};

const INTEL_QSV_NO_LIBS: HardwareProfile = {
  gpu: 'intel',
  gpuName: 'Intel UHD',
  encoders: ['hevc_qsv', 'h264_qsv'], // No libx265/libx264 — minimal QSV-only build
  decoders: ['hevc_qsv'],
  hwaccels: ['qsv'],
};

const PI_CPU_ONLY: HardwareProfile = {
  gpu: 'cpu',
  gpuName: 'Software (CPU)',
  encoders: ['libx264', 'libx265'],
  decoders: [],
  hwaccels: [],
};

const LEGACY_EMPTY: HardwareProfile = {
  gpu: 'nvidia',
  gpuName: 'NVIDIA GPU',
  encoders: [], // Pre-1.0.36 worker — no probe data, fall back to lib name
  decoders: [],
  hwaccels: [],
};

const SPACE_SAVER = BUILT_IN_RECIPES.find(r => r.id === 'space-saver')!;
const AV1_BALANCED = BUILT_IN_RECIPES.find(r => r.id === 'av1-balanced')!;
const REMUX = BUILT_IN_RECIPES.find(r => r.id === 'remux-to-mkv')!;

// ─── shouldSkipFile — alias handling ──────────────────────────────────────────

describe('shouldSkipFile', () => {
  // Real bug from pass-4 audit: a custom recipe with targetCodec='h265' didn't
  // skip already-hevc files because the alias group was only checked when
  // target === 'hevc'.
  it('skips hevc source for an h265-targeted recipe (alias normalisation)', () => {
    const recipe: Recipe = { ...SPACE_SAVER, targetCodec: 'h265' };
    expect(shouldSkipFile('hevc', recipe)).toBe(true);
  });

  it('skips h265 source for an hevc-targeted recipe (alias normalisation)', () => {
    const recipe: Recipe = { ...SPACE_SAVER, targetCodec: 'hevc' };
    expect(shouldSkipFile('h265', recipe)).toBe(true);
  });

  it('skips avc source for an h264-targeted recipe', () => {
    const recipe: Recipe = { ...SPACE_SAVER, targetCodec: 'h264' };
    expect(shouldSkipFile('avc', recipe)).toBe(true);
  });

  it('does NOT skip h264 source for an hevc-targeted recipe', () => {
    expect(shouldSkipFile('h264', SPACE_SAVER)).toBe(false);
  });

  it('never skips for intent-driven recipes (remux, audio-normalizer, etc.)', () => {
    expect(shouldSkipFile('hevc', REMUX)).toBe(false);
    const audio = BUILT_IN_RECIPES.find(r => r.id === 'audio-normalizer')!;
    expect(shouldSkipFile('hevc', audio)).toBe(false);
  });

  it('never skips for copy targets (custom recipes with ffmpegArgs)', () => {
    const recipe: Recipe = { ...SPACE_SAVER, targetCodec: 'copy' };
    expect(shouldSkipFile('hevc', recipe)).toBe(false);
  });
});

// ─── pickVideoEncoder — fallback discipline ───────────────────────────────────

describe('pickVideoEncoder', () => {
  it('prefers hardware encoder when present', () => {
    expect(pickVideoEncoder(NVIDIA_FULL, 'h265')).toBe('hevc_nvenc');
    expect(pickVideoEncoder(NVIDIA_FULL, 'h264')).toBe('h264_nvenc');
    expect(pickVideoEncoder(NVIDIA_FULL, 'av1')).toBe('av1_nvenc');
  });

  it('falls back to lib encoder when listed in encoders array', () => {
    expect(pickVideoEncoder(PI_CPU_ONLY, 'h265')).toBe('libx265');
    expect(pickVideoEncoder(PI_CPU_ONLY, 'h264')).toBe('libx264');
  });

  // Pass-2 regression: previously fell back to 'libx265' whenever no lib*
  // entries were in encoders, defeating the dispatcher's capability check on
  // QSV-only builds.
  it('returns null when neither GPU nor matching lib encoder is present', () => {
    expect(pickVideoEncoder(INTEL_QSV_NO_LIBS, 'av1')).toBeNull();
  });

  it('falls back to lib only when encoders array is COMPLETELY empty (legacy)', () => {
    expect(pickVideoEncoder(LEGACY_EMPTY, 'h265')).toBe('libx265');
    expect(pickVideoEncoder(LEGACY_EMPTY, 'h264')).toBe('libx264');
  });

  it('AV1 has no profile-empty fallback — refuses Pi/CPU jobs', () => {
    expect(pickVideoEncoder(PI_CPU_ONLY, 'av1')).toBeNull();
    expect(pickVideoEncoder(LEGACY_EMPTY, 'av1')).toBeNull();
  });

  // Pass-2 / pass-4 regression risk: manual-add workers stored hardware = {}
  // with no encoders array. Previously crashed the dispatcher.
  it('handles missing encoders array gracefully (Array.isArray guard)', () => {
    const broken = { gpu: 'nvidia', gpuName: 'X' } as unknown as HardwareProfile;
    expect(() => pickVideoEncoder(broken, 'h265')).not.toThrow();
  });
});

// ─── isRecipeSupportedByWorker ────────────────────────────────────────────────

describe('isRecipeSupportedByWorker', () => {
  it('accepts intent-driven recipes (codec=null in map) on any worker', () => {
    expect(isRecipeSupportedByWorker(REMUX, PI_CPU_ONLY)).toEqual({ ok: true });
  });

  it('rejects AV1 recipe on a worker without AV1 hardware or libsvtav1', () => {
    const result = isRecipeSupportedByWorker(AV1_BALANCED, PI_CPU_ONLY);
    expect(result.ok).toBe(false);
  });

  // Pass-3 fix: unknown recipe id (typo, stale DB) now rejected when there's
  // no ffmpegArgs to fall back on, instead of silently producing stream-copy.
  it('rejects unknown recipe id with no ffmpegArgs', () => {
    const ghost: Recipe = { ...SPACE_SAVER, id: 'spaceSaver' /* typo */, ffmpegArgs: undefined };
    const result = isRecipeSupportedByWorker(ghost, NVIDIA_FULL);
    expect(result.ok).toBe(false);
  });

  it('accepts unknown recipe id when ffmpegArgs are provided', () => {
    const custom: Recipe = { ...SPACE_SAVER, id: 'custom-abc', ffmpegArgs: ['-c:v', 'libx264'] };
    expect(isRecipeSupportedByWorker(custom, NVIDIA_FULL)).toEqual({ ok: true });
  });

  it('handles malformed hardware payload gracefully', () => {
    expect(() => isRecipeSupportedByWorker(SPACE_SAVER, undefined as unknown as HardwareProfile)).not.toThrow();
    expect(() => isRecipeSupportedByWorker(SPACE_SAVER, null as unknown as HardwareProfile)).not.toThrow();
  });
});

// ─── getHwDecodeArgs — CUDA filter detection ──────────────────────────────────

describe('getHwDecodeArgs', () => {
  it('uses zero-copy CUDA when no CPU filters present', () => {
    expect(getHwDecodeArgs(NVIDIA_FULL, 'space-saver')).toEqual([
      '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
    ]);
  });

  it('drops zero-copy when a built-in recipe is in CUDA_INCOMPATIBLE_RECIPES', () => {
    expect(getHwDecodeArgs(NVIDIA_FULL, 'web-optimized')).toEqual(['-hwaccel', 'cuda']);
  });

  // Pass-3 fix: substring 'format=' would false-positive on aformat= (audio
  // filter) and miss legitimate cases. Now argv-aware boundary regex.
  it('does NOT match audio filter "aformat=" as the video "format" filter', () => {
    const customArgs = ['-af', 'aformat=sample_fmts=fltp', '-c:v', 'h264_nvenc'];
    expect(getHwDecodeArgs(NVIDIA_FULL, undefined, customArgs)).toEqual([
      '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
    ]);
  });

  it('detects format= in -vf and drops zero-copy', () => {
    const customArgs = ['-vf', 'format=yuv420p', '-c:v', 'h264_nvenc'];
    expect(getHwDecodeArgs(NVIDIA_FULL, undefined, customArgs)).toEqual(['-hwaccel', 'cuda']);
  });

  it('detects format= chained inside a longer -vf graph', () => {
    const customArgs = ['-vf', "scale='min(1920,iw)':-2,format=yuv420p"];
    expect(getHwDecodeArgs(NVIDIA_FULL, undefined, customArgs)).toEqual(['-hwaccel', 'cuda']);
  });

  // Pass-4 fix: regex pre-boundary class missing `]` meant `[in0]format=...`
  // (named-stream syntax in -filter_complex) was not detected. The encode
  // would run through the GPU surface path and fail.
  it('detects format= preceded by ] (named-stream syntax)', () => {
    const customArgs = ['-filter_complex', '[in0]format=yuv420p[out]'];
    expect(getHwDecodeArgs(NVIDIA_FULL, undefined, customArgs)).toEqual(['-hwaccel', 'cuda']);
  });

  it('detects scale= in -filter:v (alias for -vf)', () => {
    const customArgs = ['-filter:v', 'scale=1920:1080'];
    expect(getHwDecodeArgs(NVIDIA_FULL, undefined, customArgs)).toEqual(['-hwaccel', 'cuda']);
  });

  it('returns empty for non-NVIDIA workers', () => {
    expect(getHwDecodeArgs(PI_CPU_ONLY, 'space-saver')).toEqual([]);
    expect(getHwDecodeArgs(INTEL_QSV_NO_LIBS, 'space-saver')).toEqual(['-hwaccel', 'qsv']);
  });
});
