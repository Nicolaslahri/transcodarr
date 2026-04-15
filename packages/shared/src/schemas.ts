import { z } from 'zod';

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const SmbMappingSchema = z.object({
  networkBasePath: z.string().min(1),
  localBasePath:   z.string().min(1),
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
  ffmpegArgs:     z.array(z.string()).optional(),
  sourceUrl:      z.string().url().optional(),
});

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
  callbackToken: z.string().min(16),
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
  eta:      z.number().int().optional(),
  phase:    z.enum(['receiving', 'transcoding', 'sending', 'swapping']),
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
