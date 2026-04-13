// ─── Job & Worker Status ─────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'analyzing'
  | 'queued'
  | 'paused'
  | 'dispatched'
  | 'transcoding'
  | 'swapping'
  | 'complete'
  | 'failed'
  | 'skipped';

export type WorkerStatus = 'pending' | 'active' | 'idle' | 'online' | 'offline';

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'cpu';

// ─── Hardware ────────────────────────────────────────────────────────────────

export interface HardwareProfile {
  gpu: GpuVendor;
  gpuName: string;
  encoders: string[];   // e.g. ['hevc_nvenc', 'h264_nvenc', 'av1_nvenc']
  decoders: string[];   // e.g. ['h264_cuvid', 'hevc_cuvid']
  hwaccels: string[];   // e.g. ['cuda', 'nvdec']
}

// ─── SMB Path Mapping ────────────────────────────────────────────────────────

export interface SmbMapping {
  /** Network path as seen from Main, e.g. /data/media */
  networkBasePath: string;
  /** Local path on this Worker, e.g. N:\ or /mnt/media */
  localBasePath: string;
}

// ─── Worker Connection Mode ───────────────────────────────────────────────────

/**
 * How the Worker accesses media files:
 *   'smb'      — Worker has a network share mounted; files are accessed directly
 *   'wireless' — No shared filesystem; files are transferred over HTTP before/after transcoding
 */
export type ConnectionMode = 'smb' | 'wireless';

// ─── Transfer Phase ──────────────────────────────────────────────────────────

/**
 * Granular phase of the transfer/transcode pipeline.
 *   'receiving'   — worker is downloading the source file from Main (wireless only)
 *   'transcoding' — ffmpeg is running
 *   'sending'     — worker is uploading the result back to Main (wireless only)
 *   'swapping'    — Main is atomically replacing the original file
 */
export type TransferPhase = 'receiving' | 'transcoding' | 'sending' | 'swapping';

// ─── Worker ──────────────────────────────────────────────────────────────────

export interface WorkerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  status: WorkerStatus;
  hardware: HardwareProfile;
  smbMappings: SmbMapping[];
  /** How this worker connects to media files */
  connectionMode: ConnectionMode;
  lastSeen: number;
  /** Semver version string reported by the worker on registration */
  version?: string;
  /** True when worker version differs from Main version */
  versionMismatch?: boolean;
  currentJobId?: string;
  currentProgress?: number;
  currentFps?: number;
  /** Current transfer phase shown in the UI */
  currentPhase?: TransferPhase;
  /** Live GPU metrics (NVIDIA only, may be absent) */
  gpuStats?: GpuStats;
}

// ─── Recipe ──────────────────────────────────────────────────────────────────

export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Codec string that ffprobe returns — used for smart-filter skip check */
  targetCodec: string;
  targetContainer: 'mkv' | 'mp4';
  icon: string;
  color: string;
  /** Estimated size reduction percentage shown in the recipe picker */
  estimatedReduction?: number;
  /** Raw ffmpeg args — if present, used directly instead of the built-in switch. Enables community recipes. */
  ffmpegArgs?: string[];
  /** URL the recipe was imported from (community recipes only) */
  sourceUrl?: string;
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  filePath: string;
  fileName: string;
  fileSize?: number;
  codecIn?: string;
  codecOut?: string;        // target codec from the recipe
  resolution?: string;
  bitratIn?: number;
  recipe: string;
  status: JobStatus;
  workerId?: string;
  workerName?: string;
  progress: number;
  fps?: number;
  eta?: number;
  /** Current transfer phase (receiving / transcoding / sending) */
  phase?: TransferPhase;
  error?: string;
  sizeBefore?: number;
  sizeAfter?: number;
  /** Manual sort position (drag-to-reorder) */
  sortOrder?: number;
  /** Pinned worker — dispatch only to this worker */
  pinnedWorkerId?: string;
  /** Whether the source file has subtitle tracks */
  hasSubtitles?: boolean;
  /** Average fps over the transcoding run */
  avgFps?: number;
  /** Total elapsed seconds for the transcode */
  elapsedSeconds?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// ─── Language Preferences ─────────────────────────────────────────────────────

export interface LangPrefs {
  /** ISO 639-2/B language code for preferred audio track, e.g. 'eng'. Undefined = keep all. */
  audioLang?: string;
  /** ISO 639-2/B language code for preferred subtitle track, e.g. 'eng'. Undefined = keep all. */
  subtitleLang?: string;
}

// ─── Job Payload (Main → Worker) ─────────────────────────────────────────────

export interface JobPayload {
  jobId: string;
  /** Canonical path on Main (Pi) */
  filePath: string;
  /** Translated path if Worker has an SMB mapping covering filePath (SMB mode only) */
  smbPath?: string;
  /** Worker-side base path of the matching SMB mapping — used as fallback search root if smbPath doesn't exist */
  smbBasePath?: string;
  recipe: Recipe;
  mainHost: string;
  mainPort: number;
  /** Random token for callback auth */
  callbackToken: string;
  /** How the worker should access files */
  transferMode: ConnectionMode;
  /** URL for worker to stream-download the source file (wireless mode only) */
  downloadUrl?: string;
  /** URL for worker to stream-upload the transcoded result (wireless mode only) */
  uploadUrl?: string;
  /** Preferred audio/subtitle language tracks — applied during ffmpeg arg construction */
  langPrefs?: LangPrefs;
}

// ─── File Analysis (from ffprobe) ─────────────────────────────────────────────

export interface FileAnalysis {
  codec: string;
  duration: number;
  bitrate: number;
  resolution: string;
  audioCodec: string;
  audioLanguages: string[];
  fileSize: number;
  container: string;
}

// ─── Progress Update (Worker → Main) ─────────────────────────────────────────

export interface ProgressUpdate {
  jobId: string;
  workerId: string;
  progress: number;
  fps?: number;
  eta?: number;
  phase: TransferPhase;
}

// ─── Job Complete (Worker → Main) ────────────────────────────────────────────

export interface JobCompletePayload {
  jobId: string;
  workerId: string;
  callbackToken: string;
  success: boolean;
  outputPath?: string;
  sizeBefore?: number;
  sizeAfter?: number;
  error?: string;
}

// ─── Watched Path ────────────────────────────────────────────────────────────

export interface WatchedPath {
  id: string;
  path: string;
  recipe: string;
  enabled: boolean;
  createdAt: number;
}

// ─── GPU Stats (NVIDIA only, best-effort) ────────────────────────────────────

export interface GpuStats {
  /** GPU utilisation 0–100% */
  utilPct: number;
  /** GPU temperature in °C */
  tempC: number;
  /** VRAM used in MB */
  vramUsedMB: number;
  /** VRAM total in MB */
  vramTotalMB: number;
}

// ─── WebSocket Events (Main → Browser) ───────────────────────────────────────

export type WsEventType =
  | 'worker:discovered'
  | 'worker:accepted'
  | 'worker:updated'
  | 'worker:offline'
  | 'worker:progress'
  | 'worker:stats'
  | 'job:queued'
  | 'job:paused'
  | 'job:progress'
  | 'job:complete'
  | 'job:failed'
  | 'job:removed'
  | 'job:cleared'
  | 'scan:summary'
  | 'scan:progress'
  | 'stats:update'
  | 'system:warning';

export interface WsEvent<T = unknown> {
  event: WsEventType;
  data: T;
  timestamp: number;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface DashboardStats {
  jobsToday: number;
  jobsTotal: number;
  gbSaved: number;
  workersOnline: number;
  queueDepth: number;
  activeJobs: number;
}
