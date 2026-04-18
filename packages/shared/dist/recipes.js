// ─── Built-in Recipes ─────────────────────────────────────────────────────────
export const BUILT_IN_RECIPES = [
    // ── Core compression ───────────────────────────────────────────────────────
    {
        id: 'space-saver',
        name: 'Space Saver',
        description: 'Best all-round choice. Encodes H.264 and older codecs to H.265 — typically 40–50% smaller with no visible quality loss. Already-H.265 files are skipped automatically.',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        icon: '🗜️',
        color: '#00d9ff',
        estimatedReduction: 45,
    },
    {
        id: 'quality-archive',
        name: 'Quality Archive',
        description: 'Visually lossless H.265 for permanent storage of Blu-ray rips and original captures. Larger files than Space Saver but indistinguishable from source.',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        icon: '🏛️',
        color: '#818cf8',
        estimatedReduction: 30,
    },
    {
        id: 'av1-balanced',
        name: 'AV1 Efficient',
        description: 'Maximum storage efficiency. AV1 is 30–40% smaller than H.265 at equal quality. Slow on CPU — pair with a GPU that has AV1 hardware encoding (RTX 40-series, RX 7000-series, Arc).',
        targetCodec: 'av1',
        targetContainer: 'mkv',
        icon: '⚡',
        color: '#a78bfa',
        estimatedReduction: 60,
    },
    // ── Media server ──────────────────────────────────────────────────────────
    {
        id: 'plex-ready',
        name: 'Plex / Jellyfin Ready',
        description: 'High-quality H.265 in MKV — direct play on Apple TV, Roku 4K, Android TV, and all modern Plex/Jellyfin clients. Requires Plex 1.20+ or Jellyfin 10.6+.',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        icon: '🎬',
        color: '#e5a00d',
        estimatedReduction: 40,
    },
    {
        id: 'universal-player',
        name: 'Legacy Compatible',
        description: 'Maximum device compatibility — plays on old smart TVs, game consoles, and embedded players that do not support H.265. H.264 produces larger files than H.265.',
        targetCodec: 'h264',
        targetContainer: 'mp4',
        icon: '📺',
        color: '#00ff88',
        estimatedReduction: 15,
    },
    {
        id: 'web-optimized',
        name: 'Web / Browser',
        description: 'Streams in Chrome, Firefox, and Safari without a plugin. H.264 is the only codec with universal browser MSE support. Capped at 1080p with instant-play faststart.',
        targetCodec: 'h264',
        targetContainer: 'mp4',
        icon: '🌐',
        color: '#38bdf8',
        estimatedReduction: 20,
    },
    {
        id: 'remux-to-mkv',
        name: 'Remux to MKV',
        description: 'Repackage into MKV with zero re-encoding and zero quality loss. Use to consolidate container formats or preserve every stream without touching video quality.',
        targetCodec: 'copy',
        targetContainer: 'mkv',
        icon: '📦',
        color: '#6b7280',
        estimatedReduction: 0,
    },
    // ── Downscaling ───────────────────────────────────────────────────────────
    {
        id: 'downscale-1080p',
        name: '4K → 1080p',
        description: 'Reclaim storage and broaden device support. Downscales 4K to 1080p H.265, preserving aspect ratio with a high-quality Lanczos filter.',
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
        targetContainer: 'mkv',
        icon: '📱',
        color: '#fb923c',
        estimatedReduction: 70,
    },
    // ── Specialty ─────────────────────────────────────────────────────────────
    {
        id: 'anime-cleaner',
        name: 'Anime Cleaner',
        description: 'Clean up bloated fansub releases — keeps Japanese + English audio, preserves all subtitles, re-encodes to efficient H.265.',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        icon: '🌸',
        color: '#ff6eb4',
        estimatedReduction: 45,
    },
    {
        id: 'audio-normalizer',
        name: 'Audio Normalizer',
        description: 'Fix wildly inconsistent volume levels. Applies EBU R128 loudness normalization and re-encodes audio to AAC 192k. Video stream is copied with no quality loss.',
        targetCodec: 'copy',
        targetContainer: 'mkv',
        icon: '🔊',
        color: '#34d399',
        estimatedReduction: 0,
    },
    {
        id: 'hdr-to-sdr',
        name: 'HDR → SDR Tonemap',
        description: 'Fix washed-out HDR on non-HDR screens. Tonemaps HDR10 to SDR BT.709 using zscale with Hable tonemapping, re-encodes to H.265.',
        targetCodec: 'hevc',
        targetContainer: 'mkv',
        icon: '🌅',
        color: '#f59e0b',
        estimatedReduction: 30,
    },
];
// ─── Hardware-Aware Encoder Selection ────────────────────────────────────────
function getVideoEncoder(hw, codec) {
    if (codec === 'h265') {
        if (hw.gpu === 'nvidia' && hw.encoders.includes('hevc_nvenc'))
            return 'hevc_nvenc';
        if (hw.gpu === 'amd' && hw.encoders.includes('hevc_amf'))
            return 'hevc_amf';
        if (hw.gpu === 'intel' && hw.encoders.includes('hevc_qsv'))
            return 'hevc_qsv';
        return 'libx265';
    }
    if (codec === 'h264') {
        if (hw.gpu === 'nvidia' && hw.encoders.includes('h264_nvenc'))
            return 'h264_nvenc';
        if (hw.gpu === 'amd' && hw.encoders.includes('h264_amf'))
            return 'h264_amf';
        if (hw.gpu === 'intel' && hw.encoders.includes('h264_qsv'))
            return 'h264_qsv';
        return 'libx264';
    }
    if (codec === 'av1') {
        if (hw.gpu === 'nvidia' && hw.encoders.includes('av1_nvenc'))
            return 'av1_nvenc';
        if (hw.gpu === 'amd' && hw.encoders.includes('av1_amf'))
            return 'av1_amf';
        if (hw.gpu === 'intel' && hw.encoders.includes('av1_qsv'))
            return 'av1_qsv';
        return 'libsvtav1';
    }
    return 'libx264';
}
function encodeH265(enc, tier) {
    const crf = { archive: '18', high: '20', balanced: '24', fast: '26' };
    const q = crf[tier];
    if (enc === 'libx265') {
        const preset = tier === 'archive' || tier === 'high' ? 'slow' : tier === 'balanced' ? 'medium' : 'fast';
        return ['-crf', q, '-preset', preset];
    }
    if (enc === 'hevc_nvenc') {
        const preset = tier === 'archive' ? 'p6' : tier === 'high' ? 'p5' : 'p4';
        return ['-rc', 'vbr', '-cq', q, '-preset', preset];
    }
    if (enc === 'hevc_amf') {
        const quality = tier === 'archive' ? 'quality' : tier === 'fast' ? 'speed' : 'balanced';
        return ['-qp', q, '-quality', quality];
    }
    if (enc === 'hevc_qsv') {
        const preset = tier === 'archive' || tier === 'high' ? 'slow' : tier === 'balanced' ? 'medium' : 'fast';
        return ['-global_quality', q, '-preset', preset];
    }
    return ['-qp', q]; // fallback for unknown GPU encoder
}
function encodeH264(enc, tier) {
    const crf = { high: '20', balanced: '23', fast: '25' };
    const q = crf[tier];
    const profile = ['-profile:v', 'high', '-level:v', '5.1'];
    if (enc === 'libx264') {
        const preset = tier === 'high' ? 'slow' : tier === 'balanced' ? 'fast' : 'faster';
        return ['-crf', q, '-preset', preset, ...profile];
    }
    if (enc === 'h264_nvenc') {
        const preset = tier === 'high' ? 'p5' : tier === 'balanced' ? 'p4' : 'p3';
        return ['-rc', 'vbr', '-cq', q, '-preset', preset, ...profile];
    }
    if (enc === 'h264_amf') {
        const quality = tier === 'fast' ? 'speed' : 'balanced';
        return ['-qp', q, '-quality', quality, ...profile];
    }
    if (enc === 'h264_qsv') {
        const preset = tier === 'high' ? 'slow' : tier === 'balanced' ? 'medium' : 'fast';
        return ['-global_quality', q, '-preset', preset, ...profile];
    }
    return ['-qp', q, ...profile];
}
function encodeAV1(enc, tier) {
    const crf = { high: '26', balanced: '30' };
    const q = crf[tier];
    if (enc === 'libsvtav1') {
        const preset = tier === 'high' ? '5' : '7'; // 7 = fast batch; 5 = slower/better
        return ['-crf', q, '-preset', preset];
    }
    if (enc === 'av1_nvenc') {
        const preset = tier === 'high' ? 'p6' : 'p5';
        return ['-rc', 'vbr', '-cq', q, '-preset', preset];
    }
    // AMD AMF AV1, Intel AV1 QSV, unknown
    return ['-qp', q];
}
// ─── Language Map Helper ──────────────────────────────────────────────────────
/**
 * Returns explicit -map args for selecting preferred audio/subtitle tracks.
 * When no langs are specified, returns [] and ffmpeg's default stream selection applies.
 */
function buildLangMaps(langs) {
    if (!langs?.audioLang && !langs?.subtitleLang)
        return [];
    const m = ['-map', '0:v'];
    if (langs.audioLang) {
        m.push('-map', `0:a:m:language:${langs.audioLang}?`);
    }
    else {
        m.push('-map', '0:a');
    }
    if (langs.subtitleLang) {
        m.push('-map', `0:s:m:language:${langs.subtitleLang}?`);
    }
    else {
        m.push('-map', '0:s?');
    }
    return m;
}
// ─── FFmpeg Args Builder ──────────────────────────────────────────────────────
// CPU-only video filter patterns that are incompatible with zero-copy CUDA surface output.
// Community recipes containing these patterns must not use -hwaccel_output_format cuda.
const CUDA_INCOMPATIBLE_FILTER_PATTERNS = ['zscale=', 'zscale,', 'yadif', 'drawtext=', 'scale=', 'scale,'];
export function buildFfmpegArgs(recipe, hw, langs) {
    // Community/custom recipes supply their own args — return them directly.
    if (recipe.ffmpegArgs && recipe.ffmpegArgs.length > 0) {
        return recipe.ffmpegArgs;
    }
    const args = [];
    switch (recipe.id) {
        // ── Space Saver — H.265, balanced quality ────────────────────────────────
        case 'space-saver': {
            args.push(...buildLangMaps(langs));
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'balanced'));
            args.push('-c:a', 'copy');
            break;
        }
        // ── Quality Archive — H.265, visually lossless ────────────────────────
        case 'quality-archive': {
            args.push(...buildLangMaps(langs));
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'archive'));
            args.push('-c:a', 'copy');
            break;
        }
        // ── AV1 Efficient — maximum compression ──────────────────────────────
        case 'av1-balanced': {
            args.push(...buildLangMaps(langs));
            const enc = getVideoEncoder(hw, 'av1');
            args.push('-c:v', enc, ...encodeAV1(enc, 'balanced'));
            args.push('-c:a', 'copy');
            break;
        }
        // ── Plex / Jellyfin Ready — high-quality H.265 for media servers ──────
        case 'plex-ready': {
            args.push(...buildLangMaps(langs));
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'high'));
            args.push('-c:a', 'copy');
            break;
        }
        // ── Legacy Compatible — H.264 for old devices ─────────────────────────
        case 'universal-player': {
            args.push(...buildLangMaps(langs));
            const enc = getVideoEncoder(hw, 'h264');
            args.push('-c:v', enc, ...encodeH264(enc, 'balanced'));
            args.push('-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text');
            break;
        }
        // ── Web / Browser — H.264 capped at 1080p, faststart ─────────────────
        case 'web-optimized': {
            args.push(...buildLangMaps(langs));
            // scale= is a CPU-only filter — zero-copy CUDA mode is suppressed via CUDA_INCOMPATIBLE_RECIPES
            args.push('-vf', "scale='min(1920,iw)':-2:flags=lanczos");
            const enc = getVideoEncoder(hw, 'h264');
            args.push('-c:v', enc, ...encodeH264(enc, 'balanced'));
            args.push('-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', '-c:s', 'mov_text');
            break;
        }
        // ── Remux to MKV — stream copy, no re-encode ─────────────────────────
        case 'remux-to-mkv': {
            args.push(...buildLangMaps(langs));
            args.push('-c:v', 'copy', '-c:a', 'copy', '-c:s', 'copy');
            break;
        }
        // ── 4K → 1080p — downscale with Lanczos, H.265 ───────────────────────
        case 'downscale-1080p': {
            args.push(...buildLangMaps(langs));
            // -2 keeps the height divisible by 2 while preserving the original aspect ratio
            args.push('-vf', "scale='min(1920,iw)':-2:flags=lanczos");
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'balanced'));
            args.push('-c:a', 'copy');
            break;
        }
        // ── 4K/1080p → 720p — downscale with Lanczos, H.265 ─────────────────
        case 'downscale-720p': {
            args.push(...buildLangMaps(langs));
            args.push('-vf', "scale='min(1280,iw)':-2:flags=lanczos");
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'fast'));
            args.push('-c:a', 'aac', '-b:a', '128k');
            break;
        }
        // ── Anime Cleaner — JP+EN tracks, H.265 ──────────────────────────────
        case 'anime-cleaner': {
            // Explicit per-language mapping — lang prefs from watched folder are intentionally ignored
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-map', '0:v', '-map', '0:a:m:language:jpn?', '-map', '0:a:m:language:eng?', '-map', '0:s?', '-c:v', enc, ...encodeH265(enc, 'high'), '-c:a', 'copy', '-c:s', 'copy');
            break;
        }
        // ── Audio Normalizer — copy video, normalize audio to EBU R128 ───────
        case 'audio-normalizer': {
            args.push(...buildLangMaps(langs));
            // Copy video bitstream — no video re-encode; goal is audio only
            args.push('-c:v', 'copy');
            args.push('-af', 'loudnorm=I=-23:LRA=7:TP=-2', '-c:a', 'aac', '-b:a', '192k');
            break;
        }
        // ── HDR → SDR Tonemap — zscale tonemapping → H.265 ───────────────────
        case 'hdr-to-sdr': {
            args.push(...buildLangMaps(langs));
            // zscale is CPU-only — zero-copy CUDA mode is suppressed via CUDA_INCOMPATIBLE_RECIPES
            args.push('-vf', 'zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709,format=yuv420p');
            const enc = getVideoEncoder(hw, 'h265');
            args.push('-c:v', enc, ...encodeH265(enc, 'balanced'));
            args.push('-c:a', 'copy');
            break;
        }
        default:
            throw new Error(`Unknown recipe: ${recipe.id}`);
    }
    return args;
}
// ─── Hardware Decode Args ─────────────────────────────────────────────────────
// Recipes whose pipeline uses CPU-only video filters and cannot benefit from
// zero-copy CUDA surface output. These get -hwaccel cuda (decode on GPU, copy
// frames to CPU before filter) instead of -hwaccel cuda -hwaccel_output_format cuda.
const CUDA_INCOMPATIBLE_RECIPES = new Set([
    'hdr-to-sdr', // zscale is CPU-only
    'web-optimized', // scale= is CPU-only
    'downscale-1080p', // scale= is CPU-only
    'downscale-720p', // scale= is CPU-only
    'remux-to-mkv', // stream copy — no encode from CUDA surface
    'audio-normalizer', // stream copy video — no CUDA encode needed
]);
/**
 * Returns hardware decode args for ffmpeg.
 *
 * @param hw         - Worker hardware profile
 * @param recipeId   - Recipe ID; used to detect CPU-filter recipes that can't
 *                     use zero-copy CUDA surface output.
 * @param customArgs - Community recipe args to scan for CPU-incompatible filters
 */
export function getHwDecodeArgs(hw, recipeId, customArgs) {
    if (hw.gpu === 'nvidia' && hw.hwaccels.includes('cuda')) {
        const isCudaIncompat = (recipeId && CUDA_INCOMPATIBLE_RECIPES.has(recipeId))
            || (customArgs && customArgs.some(a => CUDA_INCOMPATIBLE_FILTER_PATTERNS.some(p => a.includes(p))));
        if (isCudaIncompat) {
            return ['-hwaccel', 'cuda']; // GPU decode, CPU filter
        }
        return ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda']; // zero-copy GPU→NVENC
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
 * For codec-targeting recipes (space-saver, plex-ready, quality-archive…),
 * skip if the file is already in the target codec — no point re-encoding
 * H.265 → H.265, or re-encoding a file that would only get larger.
 *
 * For intent-driven recipes (anime-cleaner, audio-normalizer, hdr-to-sdr,
 * remux-to-mkv) skip logic is disabled — the recipe's value is in the
 * stream selection or audio processing, not just the codec output.
 */
export function shouldSkipFile(currentCodec, recipe) {
    // These recipes do more than transcode video — always run them regardless of codec
    const noSkipRecipes = ['anime-cleaner', 'audio-normalizer', 'hdr-to-sdr', 'remux-to-mkv'];
    if (noSkipRecipes.includes(recipe.id))
        return false;
    const normalized = currentCodec.toLowerCase();
    const target = recipe.targetCodec.toLowerCase();
    // Custom recipes with ffmpegArgs — never auto-skip
    if (target === 'copy')
        return false;
    const hevcAliases = ['hevc', 'h265', 'h.265'];
    const h264Aliases = ['h264', 'h.264', 'avc'];
    const av1Aliases = ['av1'];
    if (target === 'hevc')
        return hevcAliases.some(a => normalized.includes(a));
    if (target === 'h264')
        return h264Aliases.some(a => normalized.includes(a));
    if (target === 'av1')
        return av1Aliases.some(a => normalized.includes(a));
    return normalized.includes(target);
}
//# sourceMappingURL=recipes.js.map