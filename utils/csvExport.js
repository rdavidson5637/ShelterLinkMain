const { Parser } = require('json2csv');

function convertToCSV(data, fields) {
  if (!Array.isArray(data)) {
    throw new TypeError('data must be an array');
  }

  const parser = new Parser({ fields });
  return parser.parse(data);
}

module.exports = {
  convertToCSV,
};
