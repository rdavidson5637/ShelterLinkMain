'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'frontend', 'public', 'icons');
const IMAGES = path.join(ROOT, 'frontend', 'public', 'images');
const SOURCE_SVG = path.join(ICONS, 'icon.svg');
const LOGO = path.join(IMAGES, 'shelterlink-logo.png');

const PAW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="176" cy="170" r="48" fill="#f6f7f6"/>
  <circle cx="336" cy="170" r="48" fill="#f6f7f6"/>
  <circle cx="128" cy="280" r="40" fill="#f6f7f6"/>
  <circle cx="384" cy="280" r="40" fill="#f6f7f6"/>
  <ellipse cx="256" cy="340" rx="100" ry="110" fill="#f6f7f6"/>
</svg>`;

const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <circle cx="176" cy="170" r="48" fill="#ffffff"/>
  <circle cx="336" cy="170" r="48" fill="#ffffff"/>
  <circle cx="128" cy="280" r="40" fill="#ffffff"/>
  <circle cx="384" cy="280" r="40" fill="#ffffff"/>
  <ellipse cx="256" cy="340" rx="100" ry="110" fill="#ffffff"/>
</svg>`;

async function maskable(size) {
  const artSize = Math.round(size * 0.6);
  const offset = Math.round((size - artSize) / 2);
  const paw = await sharp(Buffer.from(PAW_SVG)).resize(artSize, artSize).png().toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 27, g: 94, b: 32, alpha: 1 },
    },
  })
    .composite([{ input: paw, top: offset, left: offset }])
    .png()
    .toFile(path.join(ICONS, `maskable-${size}.png`));
}

async function generateBrandMark() {
  if (!fs.existsSync(LOGO)) return;
  const image = sharp(LOGO);
  const meta = await image.metadata();
  const width = meta.width || 682;
  const height = meta.height || 1024;
  const side = Math.round(Math.min(width, height) * 0.72);
  const left = Math.round((width - side) / 2);
  const top = Math.round((height - side) / 2 - height * 0.02);
  const cropped = sharp(LOGO).extract({
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.min(side, width),
    height: Math.min(side, height),
  }).resize(72, 72);
  await cropped.webp({ quality: 80 }).toFile(path.join(IMAGES, 'brand-mark-72.webp'));
  await cropped.png().toFile(path.join(IMAGES, 'brand-mark-72.png'));
}

async function main() {
  fs.mkdirSync(ICONS, { recursive: true });
  fs.mkdirSync(IMAGES, { recursive: true });

  await sharp(SOURCE_SVG).resize(192, 192).png().toFile(path.join(ICONS, 'icon-192.png'));
  await sharp(SOURCE_SVG).resize(512, 512).png().toFile(path.join(ICONS, 'icon-512.png'));
  await maskable(192);
  await maskable(512);

  const applePaw = await sharp(Buffer.from(PAW_SVG)).resize(108, 108).png().toBuffer();
  await sharp({
    create: {
      width: 180,
      height: 180,
      channels: 3,
      background: { r: 27, g: 94, b: 32 },
    },
  })
    .composite([{ input: applePaw, top: 36, left: 36 }])
    .png()
    .toFile(path.join(ICONS, 'apple-touch-icon.png'));

  await sharp(Buffer.from(BADGE_SVG)).resize(96, 96).png().toFile(path.join(ICONS, 'badge-96.png'));
  await sharp(SOURCE_SVG).resize(32, 32).png().toFile(path.join(ICONS, 'favicon-32.png'));
  await generateBrandMark();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
