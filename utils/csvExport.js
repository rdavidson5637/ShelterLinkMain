const { Parser } = require('json2csv');

function neutralizeFormula(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function convertToCSV(data, fields) {
  if (!Array.isArray(data)) {
    throw new TypeError('data must be an array');
  }

  const safe = data.map((row) => {
    const copy = { ...row };
    for (const field of fields) {
      copy[field] = neutralizeFormula(copy[field]);
    }
    return copy;
  });

  const parser = new Parser({ fields });
  return parser.parse(safe);
}

module.exports = {
  convertToCSV,
  neutralizeFormula,
};
