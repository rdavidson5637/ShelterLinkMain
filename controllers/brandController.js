'use strict';

const ShelterBrand = require('../models/ShelterBrand');
const { runWithShelter } = require('../utils/shelterContext');
const { publicShelterId } = require('../middleware/shelter');

// ?shelter=<slug> names the shelter; otherwise the session, then Assisi.
async function inBrandContext(req, fn) {
  const id = await publicShelterId(req);
  if (!id) return null;
  return runWithShelter(id, fn);
}

async function getBrand(req, res) {
  try {
    const brand = await inBrandContext(req, () => ShelterBrand.getPublicBrand());
    if (!brand || !brand.name) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({
      name: brand.name,
      // Lets a page tell whether the slug it asked for was found or fell back.
      slug: brand.slug || null,
      hasLogo: Boolean(brand.hasLogo),
      primaryColour: brand.primaryColour || null,
      colourTokens: brand.colourTokens || null,
    });
  } catch (error) {
    console.error('[Brand] getBrand error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getBrandLogo(req, res) {
  try {
    const logo = await inBrandContext(req, () => ShelterBrand.readLogoBytes());
    if (!logo || !logo.buffer) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(logo.buffer);
  } catch (error) {
    console.error('[Brand] getBrandLogo error:', error.message);
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getBrand,
  getBrandLogo,
};
