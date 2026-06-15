const fs = require('fs');

function generateIconSVG(size) {
  const rx = Math.round(size * 0.15);
  const fontSize1 = Math.round(size * 0.35);
  const fontSize2 = Math.round(size * 0.14);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `  <defs>`,
    `    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `      <stop offset="0%" style="stop-color:#1a3a6b"/>`,
    `      <stop offset="100%" style="stop-color:#2563eb"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  <rect width="${size}" height="${size}" rx="${rx}" fill="url(#bg)"/>`,
    `  <text x="50%" y="42%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize1}" fill="white" font-weight="bold">&#1514;&#1502;</text>`,
    `  <text x="50%" y="72%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${fontSize2}" fill="rgba(255,255,255,0.85)">TRANSCRIBE</text>`,
    `</svg>`
  ].join('\n');
}

fs.writeFileSync('public/pwa-192.svg', generateIconSVG(192));
fs.writeFileSync('public/pwa-512.svg', generateIconSVG(512));
console.log('SVG icons created');
