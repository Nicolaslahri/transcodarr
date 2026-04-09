import { execSync } from 'child_process';
import type { HardwareProfile, GpuVendor } from '@transcodarr/shared';

function runFfmpeg(...args: string[]): string {
  try {
    return execSync(`ffmpeg ${args.join(' ')} 2>&1`, { encoding: 'utf8', timeout: 15_000 });
  } catch (e: any) {
    return (e.stdout as string) ?? '';
  }
}

export function detectHardware(): HardwareProfile {
  console.log('🔍 Detecting hardware capabilities...');

  // 1. hwaccels
  const hwOutput = runFfmpeg('-hide_banner', '-hwaccels');
  const hwaccels = hwOutput
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.toLowerCase().startsWith('hardware') && !l.toLowerCase().startsWith('video'));

  // 2. Encoders
  const encOutput = runFfmpeg('-hide_banner', '-encoders');
  const gpuEncoders: string[] = [];
  for (const line of encOutput.split('\n')) {
    const match = line.match(/^\s*V[\w.]+\s+(\w+)\s+/);
    if (!match) continue;
    const name = match[1];
    if (name.includes('nvenc') || name.includes('amf') || name.includes('qsv') || name.includes('vaapi')) {
      gpuEncoders.push(name);
    }
  }

  // 3. Decoders
  const decOutput = runFfmpeg('-hide_banner', '-decoders');
  const gpuDecoders: string[] = [];
  for (const line of decOutput.split('\n')) {
    const match = line.match(/^\s*V[\w.]+\s+(\w+)\s+/);
    if (!match) continue;
    const name = match[1];
    if (name.includes('cuvid') || name.includes('nvdec') || name.includes('qsv') || name.includes('amf')) {
      gpuDecoders.push(name);
    }
  }

  // 4. Determine GPU vendor & name
  let gpu: GpuVendor = 'cpu';
  let gpuName = 'Software (CPU)';

  if (gpuEncoders.some(e => e.includes('nvenc'))) {
    gpu = 'nvidia';
    try {
      const smiOut = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8', timeout: 5000 });
      gpuName = smiOut.trim().split('\n')[0] ?? 'NVIDIA GPU';
    } catch {
      gpuName = 'NVIDIA GPU';
    }
  } else if (gpuEncoders.some(e => e.includes('amf'))) {
    gpu = 'amd';
    gpuName = 'AMD GPU';
  } else if (gpuEncoders.some(e => e.includes('qsv') || e.includes('vaapi'))) {
    gpu = 'intel';
    gpuName = 'Intel GPU (QuickSync)';
  }

  const profile: HardwareProfile = { gpu, gpuName, encoders: gpuEncoders, decoders: gpuDecoders, hwaccels };

  console.log(`  GPU: ${gpuName} (${gpu.toUpperCase()})`);
  console.log(`  Encoders: ${gpuEncoders.join(', ') || 'CPU only'}`);

  return profile;
}
