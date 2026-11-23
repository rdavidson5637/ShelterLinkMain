'use strict';

/**
 * WCAG 2.x relative luminance and contrast for shelter brand colours.
 * Primary buttons use white (--on-primary) on the brand colour (--green).
 * A colour that cannot meet AA (4.5:1) against white is rejected so the
 * platform default teal stays in use.
 */

const HEX_RE = /^#([0-9A-Fa-f]{6})$/;
const AA_NORMAL = 4.5;
const WHITE = { r: 255, g: 255, b: 255 };

function parseHex(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const m = HEX_RE.exec(trimmed);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return {
    hex: `#${m[1].toLowerCase()}`,
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function srgbChannelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return (
    0.2126 * srgbChannelToLinear(r)
    + 0.7152 * srgbChannelToLinear(g)
    + 0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a, b, amount) {
  const t = Math.min(1, Math.max(0, amount));
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function toHex({ r, g, b }) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function darken(rgb, factor) {
  const f = Math.min(1, Math.max(0, factor));
  return {
    r: Math.round(rgb.r * f),
    g: Math.round(rgb.g * f),
    b: Math.round(rgb.b * f),
  };
}

/**
 * @returns {{ ok: true, hex: string, ratio: number, tokens: object } | { ok: false, error: string }}
 */
function evaluateBrandColour(input) {
  if (input == null || input === '') {
    return { ok: true, hex: null, ratio: null, tokens: null };
  }
  const colour = parseHex(input);
  if (!colour) {
    return { ok: false, error: 'Colour must be a six-digit hex value such as #0f766e' };
  }
  const ratio = contrastRatio(colour, WHITE);
  if (ratio < AA_NORMAL) {
    return {
      ok: false,
      error: `That colour does not meet WCAG AA contrast (4.5:1) on white buttons. Ratio ${ratio.toFixed(2)}. Pick a darker colour, or clear the field for the default teal.`,
    };
  }
  const hover = darken(colour, 0.82);
  const tint = mix(WHITE, colour, 0.12);
  const tintBorder = mix(WHITE, colour, 0.28);
  return {
    ok: true,
    hex: colour.hex,
    ratio,
    tokens: {
      green: colour.hex,
      greenHover: toHex(hover),
      greenTint: toHex(tint),
      greenTintBorder: toHex(tintBorder),
      onPrimary: '#ffffff',
      selection: `rgba(${colour.r}, ${colour.g}, ${colour.b}, 0.18)`,
    },
  };
}

function tokensForStoredColour(hex) {
  const result = evaluateBrandColour(hex);
  if (!result.ok || !result.hex) return null;
  return result.tokens;
}

module.exports = {
  AA_NORMAL,
  parseHex,
  relativeLuminance,
  contrastRatio,
  evaluateBrandColour,
  tokensForStoredColour,
};
