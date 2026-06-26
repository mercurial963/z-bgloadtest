/*
 * recon-cmp.js — single-VU standalone smoke harness for the CMP journey.
 * =========================================================================
 * THROWAWAY standalone runner, the CMP sibling of recon-g3.js. It does NOT
 * load-test anything and is NOT wired into load.js. Its single job is to run
 * the read-only cmpFlow() ONCE (1 VU, 1 iteration) so the new CMP journey can
 * be validated against prod in isolation before it joins the basket.
 *
 * It reuses lib/config.js (env + required-var guard) and lib/auth.js (per-user
 * password-grant token) so it pulls creds + HOST from the SAME env as the smoke.
 * CMP Loadtest user:
 *   CMP = CMP_USER / CMP_PASS
 *
 * It authenticates ONCE as the CMP user in setup(), then drives cmpFlow() once
 * with that token. cmpFlow is read-only (search* + searchById only); no writes.
 *
 * Run (from repo root), passing creds via -e so .env is untouched:
 *   k6 run --config scripts/config.json \
 *     -e CMP_USER=load.tea -e CMP_PASS=i5ATXG713WN3oC \
 *     scripts/recon-cmp.js
 *
 * (HOST, CLIENT_ID, CLIENT_SECRET, VUS, ITERATIONS and the other required vars
 * still come from your .env / environment as usual; only the CMP creds are
 * injected here.)
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init.
import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { cmpFlow } from './scenarios/cmp.js';

// Minimal single-shot profile — this is a smoke check, not load.
export const options = {
  ...tlsOptions,
  vus: 1,
  iterations: 1,
};

// One token for the CMP user, fetched in setup() and reused.
export function setup() {
  const cmpToken = authenticate(config.CMP_USER, config.CMP_PASS, 'CMP', config);
  return { cmpToken };
}

export default function (data) {
  cmpFlow(data.cmpToken, config);
}
