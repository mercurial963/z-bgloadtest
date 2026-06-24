/*
 * recon.js — READ-ONLY response-shape discovery for the WCF k6 suite.
 * =========================================================================
 * THROWAWAY discovery script. It does NOT load-test anything. Its single job
 * is to print the REAL shape of every LIST response the chained smoke steps
 * extract values from, so we can replace the guessed pick() candidate lists
 * (uuid / companyUuid / id / accountNo / branchNo / payInstalmentRequestId /
 * hireReportId / companyAuditId / invoiceId …) with the field names production
 * actually returns.
 *
 * It reuses lib/config.js (env + required-var guard) and lib/auth.js (per-user
 * password-grant token) so it pulls creds + HOST from the SAME .env as the
 * smoke. Same per-module Loadtest users:
 *   REG    = REG_USER   / REG_PASS
 *   CON-G2 = CONG2_USER / CONG2_PASS
 *
 * It authenticates ONCE per user, then calls ONLY the LIST endpoints that feed
 * downstream chaining — the exact requests (paths + bodies/filters) lifted from
 * scenarios/reg.js and scenarios/cong2.js so the responses match what the smoke
 * will see. NO detail calls, NO writes, NO side-effecting endpoints. ~7 requests
 * total — the gentlest possible prod touch.
 *
 * For each endpoint it prints:
 *   - HTTP status
 *   - the FULL response body, pretty-printed (JSON.stringify(body, null, 2))
 *   - a labeled line with Object.keys() of the FIRST record (via firstRecord(),
 *     i.e. exactly the object the chain would operate on)
 *
 * Run (from repo root, with .env sourced into the environment):
 *   k6 run --include-system-env-vars scripts/recon.js
 *
 * Single execution (1 VU, 1 iteration). No thresholds/VU profile.
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init.
import { config } from './lib/config.js';
import http from 'k6/http';
import { authenticate } from './lib/auth.js';
import { firstRecord } from './lib/http.js';

// Minimal single-shot profile — this is discovery, not load.
export const options = {
  vus: 1,
  iterations: 1,
};

// One token per user, fetched in setup() and reused.
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  return { regToken, conG2Token };
}

// POST a list endpoint and print status + full body + first-record keys.
function probe(label, token, path, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const res = http.post(`${config.HOST}${path}`, JSON.stringify(body), {
    headers,
    tags: { name: `recon ${label}` },
  });

  console.log('\n========================================================');
  console.log(`ENDPOINT: ${label}`);
  console.log(`POST ${path}`);
  console.log(`STATUS: ${res.status}`);

  let parsed = null;
  try {
    parsed = res.json();
  } catch (e) {
    parsed = null;
  }

  console.log('FULL BODY:');
  if (parsed === null) {
    // Non-JSON (or empty) body — print the raw text so we still see something.
    console.log(res.body);
  } else {
    console.log(JSON.stringify(parsed, null, 2));
  }

  const rec = firstRecord(parsed);
  if (rec && typeof rec === 'object') {
    console.log(`FIRST RECORD Object.keys(): [${Object.keys(rec).join(', ')}]`);
  } else {
    console.log('FIRST RECORD Object.keys(): <no usable first record — list empty or unrecognized shape>');
  }
}

export default function (data) {
  // ---- REG list endpoints that feed chaining --------------------------
  // Step 1: feeds uuid + accountNo. Body lifted verbatim from scenarios/reg.js.
  probe('REG /reg/company/list', data.regToken, '/reg/company/list', {
    pagination: {
      pageNumber: 1,
      pageSize: 20,
      orders: [{ direction: 'ASC', property: 'updatedDate' }],
    },
    accountNoLike: null,
    commercialIdLike: null,
    companyNameLike: null,
    ssoResponsibilityLike: '1001',
  });

  // Step 4: feeds branchNo. Body lifted from scenarios/reg.js. accountNo there
  // is chained from step 1; for recon we use the .env balance accountNo so the
  // branch list is scoped to a real employer rather than left unbound.
  probe('REG /reg/company/branch', data.regToken, '/reg/company/branch', {
    accountNo: config.CONG2_BALANCE_ACCOUNT_NO,
    ssoResponsibility: '3101',
    removeMainBranch: true,
    pagination: {
      pageNumber: 0,
      pageSize: 20,
      orders: [{ direction: 'DESC', property: 'accountNo' }],
    },
  });

  // ---- CON-G2 list endpoints that feed chaining -----------------------
  // Step 1 (tab1): feeds the tab1 id. Body lifted from scenarios/cong2.js.
  probe(
    'CON-G2 /coninvoice/pay-instalment-requests/list (tab1)',
    data.conG2Token,
    '/coninvoice/pay-instalment-requests/list',
    {
      currentTab: 'wait to approve',
      operation: 'AND',
      pagination: { pageNumber: 0, pageSize: 50 },
      approveStatus: 'N',
      approvalStatus: 'N',
    }
  );

  // Step 3 (tab2): feeds the tab2 id. Body lifted from scenarios/cong2.js.
  probe(
    'CON-G2 /coninvoice/pay-instalment-requests/list (tab2)',
    data.conG2Token,
    '/coninvoice/pay-instalment-requests/list',
    {
      currentTab: 'all',
      operation: 'AND',
      pagination: { pageNumber: 0, pageSize: 100 },
    }
  );

  // Step 9: feeds hireReportId. Body lifted from scenarios/cong2.js.
  probe(
    'CON-G2 /coninvoice/invoices/hire-report/list',
    data.conG2Token,
    '/coninvoice/invoices/hire-report/list',
    {
      accountNoBegins: '',
      accountNoEnd: '',
      ssoBranchCode: '',
      accountBranch: '',
      year: '2568',
      pagination: { pageNumber: 0, pageSize: 10 },
    }
  );

  // Step 12: feeds companyAuditId. Body lifted from scenarios/cong2.js.
  probe(
    'CON-G2 /coninvoice/invoices/contribution-audits/list',
    data.conG2Token,
    '/coninvoice/invoices/contribution-audits/list',
    {
      beginAccountNo: '1170014259',
      pagination: { pageNumber: 0, pageSize: 10 },
    }
  );

  // Step 18: feeds askContribute invoiceId. Body lifted from scenarios/cong2.js.
  probe(
    'CON-G2 /coninvoice/invoice/askContribute/list',
    data.conG2Token,
    '/coninvoice/invoice/askContribute/list',
    {
      pagination: { pageNumber: 0, pageSize: 10 },
      accountNo: config.CONG2_RETRO_ACCOUNT_NO,
      year: '2568',
      typeDocCode: '1',
    }
  );
}
