import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const UPSTREAM_REPOSITORY = 'project-slippi/slippi-launcher';
const UPSTREAM_COMMIT = 'ce24cae3ed508c279c1848b8853b688946990c17';
const UPSTREAM_RANK_DIRECTORY = 'src/renderer/styles/images/ranks';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPOSITORY}/${UPSTREAM_COMMIT}`;
const ASSET_ROOT = path.resolve('assets/ranks');
const SOURCE_DIRECTORY = path.join(ASSET_ROOT, 'source-svg');
const OUTPUT_DIRECTORY = path.join(ASSET_ROOT, 'png');
const MAX_EMOJI_BYTES = 256 * 1024;

const rankAssets = [
  ['rank_bronze_1', 'rank_Bronze_I.svg'],
  ['rank_bronze_2', 'rank_Bronze_II.svg'],
  ['rank_bronze_3', 'rank_Bronze_III.svg'],
  ['rank_silver_1', 'rank_Silver_I.svg'],
  ['rank_silver_2', 'rank_Silver_II.svg'],
  ['rank_silver_3', 'rank_Silver_III.svg'],
  ['rank_gold_1', 'rank_Gold_I.svg'],
  ['rank_gold_2', 'rank_Gold_II.svg'],
  ['rank_gold_3', 'rank_Gold_III.svg'],
  ['rank_platinum_1', 'rank_Platinum_I.svg'],
  ['rank_platinum_2', 'rank_Platinum_II.svg'],
  ['rank_platinum_3', 'rank_Platinum_III.svg'],
  ['rank_diamond_1', 'rank_Diamond_I.svg'],
  ['rank_diamond_2', 'rank_Diamond_II.svg'],
  ['rank_diamond_3', 'rank_Diamond_III.svg'],
  ['rank_master_1', 'rank_Master_I.svg'],
  ['rank_master_2', 'rank_Master_II.svg'],
  ['rank_master_3', 'rank_Master_III.svg'],
  ['rank_grandmaster', 'rank_Grand_Master.svg'],
  ['rank_unranked', 'rank_Unranked1.svg'],
  ['rank_pending', 'rank_Unranked3.svg'],
];

await mkdir(SOURCE_DIRECTORY, { recursive: true });
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const refresh = process.argv.includes('--refresh');

for (const [emojiName, sourceFileName] of rankAssets) {
  const sourcePath = path.join(SOURCE_DIRECTORY, sourceFileName);
  const outputPath = path.join(OUTPUT_DIRECTORY, `${emojiName}.png`);
  let svgBytes;

  if (!refresh) {
    try {
      svgBytes = await readFile(sourcePath);
    } catch {
      // Missing files are downloaded from the pinned upstream commit below.
    }
  }

  if (!svgBytes) {
    const url = `${RAW_BASE_URL}/${UPSTREAM_RANK_DIRECTORY}/${sourceFileName}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });

    if (!response.ok) {
      throw new Error(`Could not download ${sourceFileName}: HTTP ${response.status} (${url})`);
    }

    svgBytes = Buffer.from(await response.arrayBuffer());
    await writeFile(sourcePath, svgBytes);
  }

  const pngBytes = await sharp(svgBytes, { density: 384 })
    .resize(128, 128, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  if (pngBytes.byteLength >= MAX_EMOJI_BYTES) {
    throw new Error(
      `${emojiName}.png is ${pngBytes.byteLength} bytes; ` +
        'Discord application emojis must be smaller than 256 KiB.',
    );
  }

  await writeFile(outputPath, pngBytes);
  console.info(`Prepared ${emojiName}.png (${pngBytes.byteLength.toLocaleString('en-US')} bytes).`);
}

const upstreamLicenseResponse = await fetch(`${RAW_BASE_URL}/LICENSE`, {
  signal: AbortSignal.timeout(20_000),
});

if (!upstreamLicenseResponse.ok) {
  throw new Error(`Could not download upstream LICENSE: HTTP ${upstreamLicenseResponse.status}.`);
}

await writeFile(
  path.join(ASSET_ROOT, 'UPSTREAM-LICENSE-GPL-3.0.txt'),
  Buffer.from(await upstreamLicenseResponse.arrayBuffer()),
);

console.info(
  `Prepared ${rankAssets.length} rank assets from ` + `${UPSTREAM_REPOSITORY}@${UPSTREAM_COMMIT}.`,
);
