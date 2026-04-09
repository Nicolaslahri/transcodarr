import path from 'path';
import type { SmbMapping } from '@transcodarr/shared';

/**
 * Translate a canonical Main-side path to a local Worker path using SMB mappings.
 *
 * Example:
 *   filePath:    /data/media/movies/Inception.mkv
 *   mapping:     { networkBasePath: '/data/media', localBasePath: 'N:\\' }
 *   result:      N:\movies\Inception.mkv
 */
export function resolveLocalPath(filePath: string, mappings: SmbMapping[]): string | undefined {
  // Normalize: use forward slashes internally
  const normalizedFile = filePath.replace(/\\/g, '/');

  for (const mapping of mappings) {
    const base = mapping.networkBasePath.replace(/\\/g, '/').replace(/\/$/, '');

    if (normalizedFile.startsWith(base + '/') || normalizedFile === base) {
      const relative = normalizedFile.slice(base.length); // includes leading /
      const localBase = mapping.localBasePath.replace(/\//g, path.sep);
      // Remove trailing sep from localBase, add the relative path
      return localBase.replace(/[/\\]$/, '') + path.sep + relative.replace(/^[/\\]/, '').replace(/\//g, path.sep);
    }
  }

  return undefined;
}
