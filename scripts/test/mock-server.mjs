/*
 * mock-server.mjs — throwaway offline mock for the WCF k6 smoke.
 * =========================================================================
 * Built-in node:http only, no npm deps. Localhost only. Returns representative
 * JSON whose list responses carry records with the field names the chaining
 * probes for (uuid / companyUuid / accountNo / branchNo / payInstalmentRequestId
 * / hireReportId / companyAuditId / invoiceId, etc.).
 *
 * It logs every received path in order so we can confirm step coverage and that
 * chained ids round-trip (the {id} the mock handed out comes back in the URL).
 *
 * EMPTY-LIST PROOF: invoice/askContribute/list (CON-G2 step 18) deliberately
 * returns an empty content[] so step 19 (askContribute/select) must SKIP. That
 * proves the console.warn skip path fires against a well-formed-but-empty list.
 * =========================================================================
 */
import http from 'node:http';

const PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 8787;

// ids the mock hands out in list responses; we assert they come back in detail URLs.
const IDS = {
  uuid: 'company-uuid-0001',
  accountNo: '8400118685',
  branchNo: '000000',
  payInstalmentId: 'PIR-111',
  payInstalmentIdTab2: 'PIR-222',
  hireReportId: 'HR-333',
  companyAuditId: 'CA-444',
};

const log = [];
function record(method, pathname) {
  log.push(`${method} ${pathname}`);
  console.log(`[mock] ${log.length.toString().padStart(2, '0')}  ${method} ${pathname}`);
}

const list = (records) => ({ content: records, totalElements: records.length });

function route(method, pathname) {
  // ---- AUTH ----
  if (method === 'POST' && pathname === '/ips/api/auth/user/token') {
    return {
      access_token: 'mock-token-123',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'read',
    };
  }

  // ---- REG ----
  if (method === 'POST' && pathname === '/reg/company/list') {
    return list([
      {
        uuid: IDS.uuid,
        companyUuid: IDS.uuid,
        id: IDS.uuid,
        accountNo: IDS.accountNo,
        companyAccountNo: IDS.accountNo,
        branchNo: IDS.branchNo,
        accountBranch: IDS.branchNo,
        companyName: 'MOCK CO LTD',
      },
    ]);
  }
  if (method === 'GET' && pathname === `/reg/company/detail/${IDS.uuid}`) {
    return { uuid: IDS.uuid, accountNo: IDS.accountNo, branchNo: IDS.branchNo, name: 'MOCK CO LTD' };
  }
  if (method === 'POST' && pathname === '/reg/company/business-group/list') {
    return list([{ id: 'BG-1', businessGroupCode: '1001', name: 'group' }]);
  }
  if (method === 'POST' && pathname === '/reg/company/branch') {
    return list([{ branchNo: '000001', accountBranch: '000001', accountNo: IDS.accountNo }]);
  }
  if (method === 'POST' && pathname === '/reg/company/detail') {
    return { accountNo: IDS.accountNo, branchNo: '000001', name: 'MOCK BRANCH' };
  }

  // ---- CON-G2 ----
  if (method === 'POST' && pathname === '/coninvoice/pay-instalment-requests/list') {
    // Both tab1 and tab2 use this path; hand out a record so steps 2 & 4 chain.
    return list([
      {
        id: IDS.payInstalmentId,
        payInstalmentRequestId: IDS.payInstalmentId,
        accountNo: IDS.accountNo,
      },
    ]);
  }
  if (method === 'GET' && pathname.startsWith('/coninvoice/pay-instalment-requests/')) {
    const id = pathname.split('/').pop();
    return { id, status: 'OK', detail: 'pay-instalment detail' };
  }
  if (method === 'GET' && pathname === '/coninvoice/invoice/year/check/balance/amount') {
    return { accountNo: 'x', balance: 1000.5, amount: 1000.5, year: '2568' };
  }
  if (method === 'GET' && pathname === '/coninvoice/invoice/year/select') {
    return list([{ invoiceId: 'YR-INV-1', year: '2568', amount: 500 }]);
  }
  if (method === 'POST' && pathname === '/coninvoice/invoices/hire-report/list') {
    return list([{ hireReportId: IDS.hireReportId, id: IDS.hireReportId, accountNo: IDS.accountNo }]);
  }
  if (method === 'GET' && pathname === `/coninvoice/invoices/hire-report/report/${IDS.hireReportId}`) {
    return { hireReportId: IDS.hireReportId, rows: [] };
  }
  if (method === 'GET' && pathname === '/coninvoice/invoices/hire-report/create-invoice-init') {
    return { hireReportId: IDS.hireReportId, init: true };
  }
  if (method === 'POST' && pathname === '/coninvoice/invoices/contribution-audits/list') {
    return list([{ companyAuditId: IDS.companyAuditId, invoiceId: 'AUD-INV', id: IDS.companyAuditId }]);
  }
  if (method === 'GET' && pathname === `/coninvoice/invoices/contribution-audits/${IDS.companyAuditId}`) {
    return { companyAuditId: IDS.companyAuditId, status: 'OK' };
  }
  if (method === 'POST' && pathname === '/coninvoice/invoices/retroactive-records/check-invoice') {
    return { canInvoice: true, accountNo: IDS.accountNo };
  }
  if (method === 'POST' && pathname === '/coninvoice/invoice/askContribute/list') {
    // EMPTY-LIST PROOF: well-formed but empty -> step 19 must skip.
    return list([]);
  }
  if (method === 'GET' && pathname === '/coninvoice/invoice/askContribute/select') {
    return { invoiceId: 'should-not-be-hit', note: 'step19 should have skipped' };
  }

  return undefined; // 404
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  record(req.method, u.pathname);
  // drain body
  req.on('data', () => {});
  req.on('end', () => {
    const payload = route(req.method, u.pathname);
    if (payload === undefined) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', path: u.pathname }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

// On SIGTERM/SIGINT dump the ordered request log so the harness can capture it.
function dumpAndExit() {
  console.log('[mock] --- ORDERED REQUEST LOG ---');
  log.forEach((l, i) => console.log(`[mock] ${(i + 1).toString().padStart(2, '0')}  ${l}`));
  process.exit(0);
}
process.on('SIGTERM', dumpAndExit);
process.on('SIGINT', dumpAndExit);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] listening on http://127.0.0.1:${PORT}`);
});
