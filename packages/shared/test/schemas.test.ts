import { describe, it, expect } from 'vitest';
import { FfmpegArgsSchema, RecipeSchema, JobPayloadSchema, ProgressUpdateSchema } from '../src/schemas.js';

// ─── FfmpegArgsSchema — denylist coverage ─────────────────────────────────────
//
// These tests pin down EVERY dangerous pattern we've added across audit
// passes. If a future change drops or weakens the denylist, the test fails
// loudly instead of letting a security regression ship silently.

describe('FfmpegArgsSchema — substring patterns', () => {
  const safe = ['-c:v', 'libx264', '-crf', '23'];
  it('accepts ordinary recipe args', () => {
    expect(FfmpegArgsSchema.safeParse(safe).success).toBe(true);
  });

  // URL-protocol family — each must be rejected.
  it.each([
    ['concat:'], ['subfile:'], ['pipe:'], ['file:'],
    ['fd:'], ['tee:'], ['cache:'], ['crypto:'], ['async:'], ['data:'],
    ['md5:'], ['unix:'],
    ['tcp://'], ['udp://'], ['rtmp://'], ['rtsp://'], ['srt://'],
    ['sftp://'], ['ftp://'], ['http://'], ['https://'], ['tls://'],
    ['gopher://'], ['gophers://'], ['mmsh://'], ['mmst://'],
    ['bluray:'], ['prompeg:'],
  ])('rejects URL protocol "%s"', (pat) => {
    const args = ['-i', `${pat}/etc/passwd`, '-c:v', 'copy'];
    expect(FfmpegArgsSchema.safeParse(args).success).toBe(false);
  });

  // Filter-graph family that opens arbitrary files.
  it.each([
    ['-vf', 'movie=/etc/passwd'],
    ['-vf', 'amovie=/etc/passwd'],
    ['-vf', 'subtitles=foo,subfile=/secret'],
  ])('rejects filter pattern in arg "%s %s"', (flag, val) => {
    expect(FfmpegArgsSchema.safeParse([flag, val]).success).toBe(false);
  });
});

describe('FfmpegArgsSchema — single dangerous flags', () => {
  // Pass-3 fix: bare -init_hw_device used to slip through the pair-only check
  // when it was the trailing arg. Now caught regardless of position.
  it.each(['-init_hw_device', '-attach', '-dump_attachment'])(
    'rejects flag "%s" even with no following value (trailing-arg case)',
    (flag) => {
      expect(FfmpegArgsSchema.safeParse(['-c:v', 'libx264', flag]).success).toBe(false);
    },
  );
  it.each(['-i', '-y', '-Y'])('rejects worker-controlled flag "%s"', (flag) => {
    expect(FfmpegArgsSchema.safeParse([flag, 'x']).success).toBe(false);
  });
});

describe('FfmpegArgsSchema — argv-split pairs', () => {
  // Pass-2 fix: '-f lavfi' as ['-f', 'lavfi'] couldn't be caught by substring
  // scan because the literal space-version never appears in a single arg.
  it.each([
    ['-f', 'lavfi'],
    ['-f', 'concat'],
    ['-f', 'image2'],
    ['-f', 'tee'],
  ])('rejects argv pair ["%s", "%s"]', (a, b) => {
    expect(FfmpegArgsSchema.safeParse([a, b, '-c:v', 'libx264']).success).toBe(false);
  });

  it('case-insensitive on the pair value', () => {
    expect(FfmpegArgsSchema.safeParse(['-f', 'LAVFI']).success).toBe(false);
  });
});

describe('FfmpegArgsSchema — error messages surface the offending token', () => {
  // Pass-3 fix: superRefine surfaces the actual reason instead of a generic message.
  it('reports the dangerous pattern that triggered rejection', () => {
    const result = FfmpegArgsSchema.safeParse(['-vf', 'movie=/etc/passwd']);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map(i => i.message).join(' ');
      expect(msg).toMatch(/movie=|Recipe args rejected/);
    }
  });
});

// ─── RecipeSchema — defaults + enum constraints ───────────────────────────────

describe('RecipeSchema', () => {
  const minimal = { id: 'foo', name: 'Foo', targetCodec: 'hevc' };

  it('parses minimal community recipe with defaults filled in', () => {
    const result = RecipeSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetContainer).toBe('mkv');
      expect(result.data.icon).toBe('🔧');
      expect(result.data.color).toBe('#6b7280');
      expect(result.data.description).toBe('');
    }
  });

  it.each(['hevc', 'h265', 'h264', 'av1', 'copy', 'vp9'])(
    'accepts targetCodec="%s"',
    (codec) => {
      expect(RecipeSchema.safeParse({ ...minimal, targetCodec: codec }).success).toBe(true);
    },
  );

  // Pass-4 fix: previously z.string().min(1) accepted any garbage, which
  // poisoned shouldSkipFile's substring matcher (a recipe with targetCodec='a'
  // would skip every file containing 'a' in its codec field).
  it('rejects unknown targetCodec', () => {
    expect(RecipeSchema.safeParse({ ...minimal, targetCodec: 'a' }).success).toBe(false);
    expect(RecipeSchema.safeParse({ ...minimal, targetCodec: '' }).success).toBe(false);
  });

  it('rejects targetContainer outside mkv|mp4', () => {
    expect(RecipeSchema.safeParse({ ...minimal, targetContainer: 'webm' }).success).toBe(false);
  });
});

// ─── ProgressUpdateSchema — phase enum must include 'finalizing' ──────────────

describe('ProgressUpdateSchema', () => {
  const base = { jobId: 'j1', workerId: 'w1', progress: 50, phase: 'transcoding' };

  // Pass-3 regression: TransferPhase type union didn't include 'finalizing'
  // even though the schema enum did. Worker code compared phase==='finalizing'
  // and TS errored out on Linux (case-sensitive Docker builds).
  it.each(['receiving', 'transcoding', 'sending', 'swapping', 'finalizing'])(
    'accepts phase="%s"',
    (phase) => {
      expect(ProgressUpdateSchema.safeParse({ ...base, phase }).success).toBe(true);
    },
  );

  it('rejects unknown phase', () => {
    expect(ProgressUpdateSchema.safeParse({ ...base, phase: 'unknown' }).success).toBe(false);
  });

  it('rejects out-of-range progress', () => {
    expect(ProgressUpdateSchema.safeParse({ ...base, progress: -1 }).success).toBe(false);
    expect(ProgressUpdateSchema.safeParse({ ...base, progress: 101 }).success).toBe(false);
  });
});

// ─── JobPayloadSchema — basic sanity ──────────────────────────────────────────

describe('JobPayloadSchema', () => {
  const validRecipe = {
    id: 'space-saver', name: 'Space Saver', description: 'desc',
    targetCodec: 'hevc', targetContainer: 'mkv', icon: '🗜️', color: '#00d9ff',
  };

  it('accepts a wireless dispatch payload', () => {
    const result = JobPayloadSchema.safeParse({
      jobId: 'j1', filePath: '/media/x.mkv', recipe: validRecipe,
      mainHost: '192.168.0.1', mainPort: 3001,
      callbackToken: '0123456789abcdef',
      transferMode: 'wireless',
      downloadUrl: 'http://192.168.0.1:3001/d', uploadUrl: 'http://192.168.0.1:3001/u',
    });
    expect(result.success).toBe(true);
  });

  it('rejects too-short callbackToken', () => {
    const result = JobPayloadSchema.safeParse({
      jobId: 'j1', filePath: '/x', recipe: validRecipe,
      mainHost: 'h', mainPort: 1, callbackToken: 'short',
      transferMode: 'smb',
    });
    expect(result.success).toBe(false);
  });
});
