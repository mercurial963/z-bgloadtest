/*
 * extraction.test.mjs — standalone Node harness for the pure ID-chaining helpers.
 * =========================================================================
 * NOTE: firstRecord() and pick() are COPIED VERBATIM from ../lib/http.js (lines
 * 13-37) rather than imported, because http.js does `import http from 'k6/http'`
 * at the top, which Node cannot resolve. The two functions below are pure JS and
 * have no k6 dependency — they are an exact copy of the source under test.
 * =========================================================================
 */
import assert from 'node:assert/strict';

// ---- COPIED VERBATIM FROM lib/http.js ----
function firstRecord(body) {
  if (!body) return null;
  if (Array.isArray(body) && body.length) return body[0];
  if (Array.isArray(body.content) && body.content.length) return body.content[0];
  if (body.data) {
    if (Array.isArray(body.data) && body.data.length) return body.data[0];
    if (Array.isArray(body.data.content) && body.data.content.length) return body.data.content[0];
  }
  if (Array.isArray(body.items) && body.items.length) return body.items[0];
  if (Array.isArray(body.records) && body.records.length) return body.records[0];
  return null;
}

function pick(record, keys) {
  if (!record) return null;
  for (const k of keys) {
    if (record[k] !== undefined && record[k] !== null && record[k] !== '') {
      return record[k];
    }
  }
  return null;
}
// ---- END COPY ----

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
}

console.log('--- firstRecord(): list shapes ---');
t('records under content', () => {
  assert.deepEqual(firstRecord({ content: [{ uuid: 'A' }, { uuid: 'B' }] }), { uuid: 'A' });
});
t('records under data.content', () => {
  assert.deepEqual(firstRecord({ data: { content: [{ id: 1 }, { id: 2 }] } }), { id: 1 });
});
t('records under data (array)', () => {
  assert.deepEqual(firstRecord({ data: [{ id: 9 }] }), { id: 9 });
});
t('top-level array', () => {
  assert.deepEqual(firstRecord([{ id: 'top' }, { id: 'x' }]), { id: 'top' });
});
t('records under items', () => {
  assert.deepEqual(firstRecord({ items: [{ id: 'i1' }] }), { id: 'i1' });
});
t('records under records', () => {
  assert.deepEqual(firstRecord({ records: [{ id: 'r1' }] }), { id: 'r1' });
});

console.log('--- firstRecord(): empty / missing -> null (skip path) ---');
t('empty content array -> null', () => assert.equal(firstRecord({ content: [] }), null));
t('empty top-level array -> null', () => assert.equal(firstRecord([]), null));
t('empty data.content -> null', () => assert.equal(firstRecord({ data: { content: [] } }), null));
t('null body -> null', () => assert.equal(firstRecord(null), null));
t('object with no known list key -> null', () => assert.equal(firstRecord({ foo: 'bar' }), null));
t('data present but not a list -> null', () => assert.equal(firstRecord({ data: { x: 1 } }), null));

console.log('--- pick(): id field candidates (real probe lists from the flows) ---');
t('uuid (REG step1)', () => {
  assert.equal(pick({ uuid: 'U1', id: 'X' }, ['uuid', 'companyUuid', 'id']), 'U1');
});
t('companyUuid fallback (REG step1)', () => {
  assert.equal(pick({ companyUuid: 'CU' }, ['uuid', 'companyUuid', 'id']), 'CU');
});
t('id fallback (REG step1)', () => {
  assert.equal(pick({ id: 'ID3' }, ['uuid', 'companyUuid', 'id']), 'ID3');
});
t('accountNo (REG)', () => {
  assert.equal(pick({ accountNo: '8400118685' }, ['accountNo', 'companyAccountNo']), '8400118685');
});
t('companyAccountNo fallback (REG)', () => {
  assert.equal(pick({ companyAccountNo: 'CA' }, ['accountNo', 'companyAccountNo']), 'CA');
});
t('branchNo / accountBranch (REG)', () => {
  assert.equal(pick({ accountBranch: '000001' }, ['branchNo', 'accountBranch']), '000001');
});
t('payInstalmentRequestId (CON-G2 step1/3)', () => {
  assert.equal(
    pick({ payInstalmentRequestId: 'PIR9' }, ['id', 'payInstalmentRequestId', 'requestId']),
    'PIR9'
  );
});
t('id wins over payInstalmentRequestId (order)', () => {
  assert.equal(
    pick({ id: 'IDwin', payInstalmentRequestId: 'PIR9' }, ['id', 'payInstalmentRequestId', 'requestId']),
    'IDwin'
  );
});
t('hireReportId (CON-G2 step9)', () => {
  assert.equal(pick({ hireReportId: 'HR1' }, ['hireReportId', 'id', 'invoiceId']), 'HR1');
});
t('companyAuditId (CON-G2 step12)', () => {
  assert.equal(pick({ companyAuditId: 'CA1' }, ['companyAuditId', 'invoiceId', 'id']), 'CA1');
});
t('invoiceId (CON-G2 step18)', () => {
  assert.equal(pick({ invoiceId: 'INV1' }, ['invoiceId', 'id']), 'INV1');
});

console.log('--- pick(): missing / empty -> null (skip path) ---');
t('none of the candidate keys present -> null', () => {
  assert.equal(pick({ somethingElse: 'x' }, ['uuid', 'companyUuid', 'id']), null);
});
t('candidate present but empty string -> skipped -> null', () => {
  assert.equal(pick({ uuid: '' }, ['uuid']), null);
});
t('candidate present but null -> skipped, falls through', () => {
  assert.equal(pick({ uuid: null, id: 'ID' }, ['uuid', 'id']), 'ID');
});
t('null record -> null', () => assert.equal(pick(null, ['id']), null));

console.log('--- combined: firstRecord -> pick end-to-end ---');
t('REG step1: content list -> uuid + accountNo', () => {
  const body = { content: [{ uuid: 'U', accountNo: '840', branchNo: '000000' }] };
  const rec = firstRecord(body);
  assert.equal(pick(rec, ['uuid', 'companyUuid', 'id']), 'U');
  assert.equal(pick(rec, ['accountNo', 'companyAccountNo']), '840');
});
t('CON-G2 empty list -> firstRecord null -> pick null (skip fires)', () => {
  const rec = firstRecord({ content: [] });
  assert.equal(rec, null);
  assert.equal(pick(rec, ['id', 'payInstalmentRequestId', 'requestId']), null);
});

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
