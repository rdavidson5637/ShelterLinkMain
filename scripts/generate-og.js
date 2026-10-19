'use strict';

// Renders frontend/public/images/og.png (1200x630) for link previews.
// sharp is a devDependency, so run this locally and commit the PNG:
//   node scripts/generate-og.js
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'frontend', 'public', 'images', 'og.png');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#1b5e20"/>
  <g fill="#f6f7f6" transform="translate(96 150) scale(0.62)">
    <circle cx="176" cy="170" r="48"/>
    <circle cx="336" cy="170" r="48"/>
    <circle cx="128" cy="280" r="40"/>
    <circle cx="384" cy="280" r="40"/>
    <ellipse cx="256" cy="340" rx="100" ry="110"/>
  </g>
  <text x="470" y="290" font-family="Helvetica, Arial, sans-serif" font-size="92" font-weight="700" fill="#ffffff">ShelterLink</text>
  <text x="470" y="370" font-family="Helvetica, Arial, sans-serif" font-size="38" fill="#e3efe4">Volunteer rotas for animal rescues</text>
  <text x="470" y="430" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#c5dcc7">Shifts, urgent cover and hours in one place</text>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toFile(OUT)
  .then((info) => console.log(`wrote ${OUT} (${info.width}x${info.height})`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
