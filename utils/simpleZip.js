'use strict';

/**
 * Minimal ZIP (store only, no compression) for a single text file.
 * No third-party dependency — enough for a GDPR self-export download.
 */

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * @param {string} filename ASCII filename inside the archive
 * @param {string|Buffer} content File body
 * @returns {Buffer} ZIP bytes
 */
function zipSingleFile(filename, content) {
  const name = Buffer.from(String(filename), 'utf8');
  const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const checksum = crc32(data);
  const size = data.length;

  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(checksum),
    u32(size),
    u32(size),
    u16(name.length),
    u16(0),
    name,
  ]);

  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(checksum),
    u32(size),
    u32(size),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    name,
  ]);

  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralHeader.length),
    u32(localHeader.length + data.length),
    u16(0),
  ]);

  return Buffer.concat([localHeader, data, centralHeader, end]);
}

module.exports = { zipSingleFile, crc32 };
