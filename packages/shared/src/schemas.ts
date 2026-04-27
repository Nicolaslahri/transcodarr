import { z } from 'zod';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const SmbMappingSchema = z.object({
  networkBasePath: z.string().min(1),
  localBasePath:   z.string().min(1),
});

// ffmpeg flags / patterns that can read or write arbitrary files via ffmpeg's
// own URL-protocol or filter surface. spawn() blocks shell injection, but ffmpeg
// itself can open `concat:`, `subfile:`, `pipe:`, `file:` etc. so any custom
// recipe args MUST be screened for these tokens.
//
// Kept in sync with worker/src/transcoder.ts sanitizeFfmpegArgs (defence in depth).
const DANGEROUS_FFMPEG_PATTERNS = [
  'concat:', 'subfile:', 'pipe:', 'file:',
  'tcp://', 'udp://', 'rtmp://', 'rtsp://', 'srt://', 'sftp://', 'ftp://', 'http://', 'https://',
  'movie=', 'amovie=', 'subfile=',
  '-f lavfi',
];

function ffmpegArgsAreSafe(args: string[]): boolean {
  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (DANGEROUS_FFMPEG_PATTERNS.some(p => lower.includes(p))) return false;
    if (arg === '-i' || arg === '-y' || arg === '-Y') return false;
  }
  return true;
}

const FfmpegArgsSchema = z.array(z.string().max(2000)).max(200).refine(ffmpegArgsAreSafe, {
  message: 'Recipe args contain a disallowed pattern (concat:/subfile:/pipe:/file:/movie=/-f lavfi/-i/-y).',
});

const RecipeSchema = z.object({
  id:             z.string().min(1),
  name:           z.string().min(1),
  description:    z.string(),
  targetCodec:    z.string().min(1),
  targetContainer: z.enum(['mkv', 'mp4']),
  icon:           z.string(),
  color:          z.string(),
  estimatedReduction: z.number().optional(),
  ffmpegArgs:     FfmpegArgsSchema.optional(),
  sourceUrl:      z.string().url().optional(),
});

// Re-export so server-side custom-recipe creation can use the same denylist
// without going through the full RecipeSchema (e.g. when only validating args).
export { FfmpegArgsSchema, ffmpegArgsAreSafe, DANGEROUS_FFMPEG_PATTERNS, RecipeSchema };

const LangPrefsSchema = z.object({
  audioLang:    z.string().length(3).optional(),
  subtitleLang: z.string().length(3).optional(),
}).optional();

// ─── JobPayload (Main → Worker) ───────────────────────────────────────────────

export const JobPayloadSchema = z.object({
  jobId:         z.string().min(1),
  filePath:      z.string().min(1),
  smbPath:       z.string().optional(),
  smbBasePath:   z.string().optional(),
  recipe:        RecipeSchema,
  mainHost:      z.string().min(1),
  mainPort:      z.number().int().min(1).max(65535),
  callbackToken: z.string().min(16),  // 64 chars for crypto.randomBytes(32).toString('hex'); min(16) for backwards compat
  transferMode:  z.enum(['smb', 'wireless']),
  downloadUrl:   z.string().url().optional(),
  uploadUrl:     z.string().url().optional(),
  langPrefs:     LangPrefsSchema,
});

export type JobPayloadInput = z.infer<typeof JobPayloadSchema>;

// ─── ProgressUpdate (Worker → Main) ──────────────────────────────────────────

export const ProgressUpdateSchema = z.object({
  jobId:    z.string().min(1),
  workerId: z.string().min(1),
  progress: z.number().int().min(0).max(100),
  fps:      z.number().min(0).optional(),
  eta:      z.number().optional(),          // ms timestamp — may be a float
  phase:    z.enum(['receiving', 'transcoding', 'sending', 'swapping', 'finalizing']),
});

export type ProgressUpdateInput = z.infer<typeof ProgressUpdateSchema>;

// ─── JobCompletePayload (Worker → Main) ──────────────────────────────────────

export const JobCompletePayloadSchema = z.object({
  jobId:         z.string().min(1),
  workerId:      z.string().min(1),
  callbackToken: z.string().min(1),
  success:       z.boolean(),
  outputPath:    z.string().optional(),
  sizeBefore:    z.number().int().min(0).optional(),
  sizeAfter:     z.number().int().min(0).optional(),
  error:         z.string().optional(),
  avgFps:        z.number().min(0).optional(),
  elapsedSeconds: z.number().int().min(0).optional(),
});

export type JobCompletePayloadInput = z.infer<typeof JobCompletePayloadSchema>;

// ─── WorkerHeartbeat (Worker → Main) ─────────────────────────────────────────

export const GpuStatsSchema = z.object({
  utilPct:     z.number().min(0).max(100),
  tempC:       z.number().min(0),
  vramUsedMB:  z.number().min(0),
  vramTotalMB: z.number().min(0),
});

export const WorkerHeartbeatSchema = z.object({
  id:          z.string().min(1),
  status:      z.enum(['idle', 'active']),
  currentJobId: z.string().optional(),
  gpuStats:    GpuStatsSchema.optional(),
});

export type WorkerHeartbeatInput = z.infer<typeof WorkerHeartbeatSchema>;

// ─── Webhook payload (Settings → stored) ─────────────────────────────────────

export const WebhookCreateSchema = z.object({
  url:     z.string().url(),
  events:  z.array(z.string()).min(1).default(['job:complete', 'job:failed']),
  secret:  z.string().optional(),
  enabled: z.boolean().default(true),
});

export type WebhookCreateInput = z.infer<typeof WebhookCreateSchema>;
