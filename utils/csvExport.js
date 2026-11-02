function neutralizeFormula(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

function presentValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return neutralizeFormula(value.toISOString());
  if (typeof value === 'object') return neutralizeFormula(JSON.stringify(value));
  return neutralizeFormula(value);
}

function quoteField(value) {
  if (value == null) return '';
  const text = String(value);
  const needsQuotes = typeof value === 'string' || /[",\n\r]/.test(text);
  if (!needsQuotes) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function convertToCSV(data, fields) {
  if (!Array.isArray(data)) {
    throw new TypeError('data must be an array');
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError('fields must be an array');
  }

  const lines = [fields.map((field) => quoteField(String(field))).join(',')];
  for (const row of data) {
    const source = row && typeof row === 'object' ? row : {};
    lines.push(fields.map((field) => quoteField(presentValue(source[field]))).join(','));
  }
  return lines.join('\n');
}

module.exports = {
  convertToCSV,
  neutralizeFormula,
};
