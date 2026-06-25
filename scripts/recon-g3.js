/*
 * recon-g3.js — READ-ONLY response-shape discovery for the G3 (Accounting) journey.
 * =========================================================================
 * THROWAWAY discovery script, the G3 sibling of recon.js. It does NOT load-test
 * anything. Its single job is to print the REAL shape of the G3 search/list
 * responses so Pao can read off real accountNo / passbookId / account-id values
 * and confirm or replace the literal filter values g3.js currently hardcodes.
 *
 * Why this exists: scenarios/g3.js chains detail/history steps off a few search
 * steps, but several account-scoped lookups stay LITERAL because no kept search
 * produces them (passbook accountNo=1000244105, passbook-list accountNo=2000233104,
 * passbook-history/24367009). REG and CON-G2 discover their ids at runtime and
 * recon.js dumps those shapes; G3 had no equivalent. This is it.
 *
 * It reuses lib/config.js (env + required-var guard) and lib/auth.js (per-user
 * password-grant token) so it pulls creds + HOST from the SAME .env as the smoke.
 * G3 Loadtest user:
 *   G3 = G3_USER / G3_PASS
 *
 * It authenticates ONCE as the G3 user, then calls ONLY the read-only search/list
 * endpoints that feed the hardcoded downstream values — the exact GET requests
 * (paths + query params) lifted from scenarios/g3.js so the responses match what
 * the smoke will see. NO detail calls, NO writes, NO report POSTs, NO file
 * exports. Five requests total — the gentlest possible prod touch.
 *
 * For each endpoint it prints:
 *   - HTTP status
 *   - the FULL response body, pretty-printed (JSON.stringify(body, null, 2))
 *   - a labeled line with Object.keys() of the FIRST record (via firstRecord(),
 *     i.e. exactly the object the chain would operate on)
 *
 * Run (from repo root, with .env sourced into the environment):
 *   ./scripts/run.sh recon-g3.js
 * or directly:
 *   k6 run --config scripts/config.json --include-system-env-vars scripts/recon-g3.js
 *
 * Single execution (1 VU, 1 iteration). No thresholds/VU profile.
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init.
import { config, tlsOptions } from './lib/config.js';
import http from 'k6/http';
import { authenticate } from './lib/auth.js';
import { firstRecord } from './lib/http.js';

// Minimal single-shot profile — this is discovery, not load.
export const options = {
  ...tlsOptions,
  vus: 1,
  iterations: 1,
};

// One token for the G3 user, fetched in setup() and reused.
export function setup() {
  const g3Token = authenticate(config.G3_USER, config.G3_PASS, 'G3', config);
  return { g3Token };
}

// GET a search/list endpoint and print status + full body + first-record keys.
// G3's search steps are GET-with-query-params (unlike REG/CON-G2's POST /list
// bodies), so this probe issues a GET; the print format matches recon.js exactly.
function probe(label, token, path) {
  const res = http.get(`${config.HOST}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    tags: { name: `recon-g3 ${label}` },
  });

  console.log('\n========================================================');
  console.log(`ENDPOINT: ${label}`);
  console.log(`GET ${path}`);
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
  // ---- account-profile search (รหัสบัญชี) -----------------------------
  // g3.js step 1. Produces the id that g3.js chains into account-profile/{id}
  // (detail) and /{id}/history. The id is read via pickOrWarn on
  // ['accountProfileId', 'id', 'accountProfileCode'] — this dump shows which of
  // those the record actually carries. Path lifted verbatim from g3.js step 1.
  probe(
    'G3 /account-profile (search by accountProfileCode)',
    data.g3Token,
    '/account-profile?accountProfileCode=11100000'
  );

  // ---- account-item search (รหัสรายการ) -------------------------------
  // g3.js step 5. Produces the accountItemId that g3.js chains into
  // account-item/{id} (detail), /{id}/history, and /{id}/1000 (sso pairing).
  // Read via pickOrWarn on ['accountItemId', 'id']. Path lifted verbatim from
  // g3.js step 5 (search by code ADJO).
  probe(
    'G3 /account-item (search ADJO)',
    data.g3Token,
    '/account-item?accountItemCode=ADJO&accountItemName=&accountLedgerType=&itemGroup=&page=0&size=20&sort=string&sort=ASC'
  );

  // ---- remain-balance passbook lookups (บัตรบัญชีนายจ้าง) -------------
  // These are the account-scoped reads g3.js leaves LITERAL because no kept
  // search produces their accountNo / passbookId. Probing them reveals real
  // record ids so Pao can confirm/replace the hardcodes in g3.js steps 9-11.

  // g3.js step 9 — passbook by accountNo. Verifies the literal accountNo=1000244105
  // (and accountBranch=000000). The first-record keys should expose the real
  // accountNo and any passbook id field for this employer card.
  probe(
    'G3 /remain-balance/passbook (by accountNo)',
    data.g3Token,
    '/remain-balance/passbook?accountBranch=000000&accountNo=1000244105&page=0&size=20&sort=ASC'
  );

  // g3.js step 10 — passbook-list by accountNo. Verifies the literal
  // accountNo=2000233104 (accountBranch=000000, yearCon=2). This list is the
  // most likely source of a real passbookId to feed step 11's history call.
  probe(
    'G3 /remain-balance/passbook-list (by accountNo)',
    data.g3Token,
    '/remain-balance/passbook-list?accountBranch=000000&accountNo=2000233104&yearCon=2&page=0&size=20'
  );
}
