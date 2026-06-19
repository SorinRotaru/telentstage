#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'help' || key === 'overwrite') {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key] = next;
    i += 1;
  }
  return out;
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

async function walkImageFiles(root) {
  const out = [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const children = await walkImageFiles(full);
      out.push(...children);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (IMAGE_EXTS.has(ext)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function slugName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

function isHeicFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.heic' || ext === '.heif';
}

function runProcess(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (buf) => {
      stderr += String(buf || '');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}

async function ensureFfmpeg() {
  try {
    await runProcess('ffmpeg', ['-version']);
  } catch {
    throw new Error('ffmpeg is not available in PATH. Install ffmpeg first.');
  }
}

async function convertHeicToJpegTemp(sourcePath) {
  const tempOut = path.join(
    os.tmpdir(),
    `seed-heic-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`
  );
  await runProcess('sips', ['-s', 'format', 'jpeg', sourcePath, '--out', tempOut]);
  return tempOut;
}

function printHelp() {
  console.log(`
Generate short MP4 videos from images for seeding.

Usage:
  node scripts/generate-videos-from-images.js [options]

Supported source image formats:
  .jpg .jpeg .png .webp .heic .heif

Options:
  --input-dir <path>     Source images folder (default: ./seed/images)
  --output-dir <path>    Generated videos folder (default: ./seed/videos)
  --count <n>            Number of videos to generate (default: one per image)
  --duration <sec>       Video duration in seconds (default: 7)
  --fps <n>              Frame rate (default: 30)
  --width <n>            Output width (default: 1080)
  --height <n>           Output height (default: 1920)
  --overwrite            Overwrite existing output files
  --help                 Show this help

Example:
  node scripts/generate-videos-from-images.js --input-dir ./seed/images --output-dir ./seed/videos --count 1000
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const inputDir = path.resolve(args['input-dir'] || 'seed/images');
  const outputDir = path.resolve(args['output-dir'] || 'seed/videos');
  const duration = toFloat(args.duration, 7);
  const fps = toInt(args.fps, 30);
  const width = toInt(args.width, 1080);
  const height = toInt(args.height, 1920);
  const overwrite = Boolean(args.overwrite);

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    throw new Error(`Input directory not found: ${inputDir}`);
  }
  if (duration <= 0) throw new Error('--duration must be > 0');
  if (fps <= 0) throw new Error('--fps must be > 0');
  if (width <= 0 || height <= 0) throw new Error('--width and --height must be > 0');

  await ensureFfmpeg();
  await fs.promises.mkdir(outputDir, { recursive: true });

  const images = await walkImageFiles(inputDir);
  if (images.length === 0) {
    throw new Error(`No image files found in: ${inputDir}`);
  }

  const requested = toInt(args.count, images.length);
  if (requested <= 0) throw new Error('--count must be >= 1');

  console.log('\nImage-to-video config');
  console.log(`- Input dir:   ${inputDir}`);
  console.log(`- Output dir:  ${outputDir}`);
  console.log(`- Images:      ${images.length}`);
  console.log(`- Videos:      ${requested}`);
  console.log(`- Duration:    ${duration}s`);
  console.log(`- FPS:         ${fps}`);
  console.log(`- Resolution:  ${width}x${height}`);
  console.log(`- Overwrite:   ${overwrite ? 'yes' : 'no'}`);
  console.log('');

  let done = 0;
  let skipped = 0;
  for (let i = 0; i < requested; i += 1) {
    const src = images[i % images.length];
    const srcName = path.parse(src).name;
    const variantIndex = Math.floor(i / images.length) + 1;
    const outputName = `${String(i + 1).padStart(5, '0')}-${slugName(srcName)}-v${String(variantIndex).padStart(2, '0')}.mp4`;
    const outputPath = path.join(outputDir, outputName);

    if (!overwrite && fs.existsSync(outputPath)) {
      skipped += 1;
      console.log(`[${i + 1}/${requested}] skip ${outputName} (exists)`);
      continue;
    }

    const zoomStart = 1 + ((i % 7) * 0.01);
    const zoomStep = 0.0006 + ((i % 5) * 0.00005);
    const vf = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `zoompan=z='min(zoom+${zoomStep.toFixed(5)},${(zoomStart + 0.12).toFixed(2)})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.max(1, Math.round(duration * fps))}:s=${width}x${height}`,
      'format=yuv420p',
    ].join(',');

    const ffArgs = [
      '-y',
      '-loop', '1',
      '-t', String(duration),
      '-i', src,
      '-vf', vf,
      '-r', String(fps),
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ];

    let heicTempPath = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      await runProcess('ffmpeg', ffArgs);
    } catch (err) {
      if (process.platform === 'darwin' && isHeicFile(src)) {
        try {
          // eslint-disable-next-line no-await-in-loop
          heicTempPath = await convertHeicToJpegTemp(src);
          const ffArgsFallback = [...ffArgs];
          const idx = ffArgsFallback.indexOf(src);
          if (idx >= 0) ffArgsFallback[idx] = heicTempPath;
          // eslint-disable-next-line no-await-in-loop
          await runProcess('ffmpeg', ffArgsFallback);
        } catch (fallbackErr) {
          throw new Error(
            `Failed for ${path.basename(src)}. ffmpeg: ${err.message}. HEIC fallback: ${fallbackErr.message}`
          );
        } finally {
          if (heicTempPath && fs.existsSync(heicTempPath)) {
            fs.unlinkSync(heicTempPath);
          }
        }
      } else {
        throw err;
      }
    }

    done += 1;
    console.log(`[${i + 1}/${requested}] ok   ${outputName}`);
  }

  console.log('\nImage-to-video complete');
  console.log(`- Created: ${done}`);
  console.log(`- Skipped: ${skipped}`);
  console.log(`- Output:  ${outputDir}`);
}

main().catch((err) => {
  console.error('\nImage-to-video failed:', err.message || err);
  process.exit(1);
});
