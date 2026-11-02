'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('the check-in print page has no script and escapes the shift title', async () => {
  const { checkInPrintDocument, writeCheckInPrint } = await import(
    '../frontend/js/admin/checkInPrint.js'
  );

  const html = checkInPrintDocument({
    title: '<script>alert(1)</script>',
    when: 'Mon 12 Oct, 09:00 - 12:00',
    code: 'VET3F6',
  });

  assert.equal(html.includes('<script'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /VET3F6/);
  assert.match(html, /Mon 12 Oct, 09:00 - 12:00/);

  const calls = [];
  const win = {
    document: {
      write(value) {
        calls.push(['write', value]);
      },
      close() {
        calls.push(['close']);
      },
    },
    print() {
      calls.push(['print']);
    },
  };

  assert.equal(writeCheckInPrint(win, { title: 'Shift', when: 'Today', code: 'ABC' }), true);
  assert.deepEqual(calls.map((call) => call[0]), ['write', 'close', 'print']);
  assert.equal(String(calls[0][1]).includes('<script'), false);
  assert.equal(writeCheckInPrint(null, {}), false);
});
