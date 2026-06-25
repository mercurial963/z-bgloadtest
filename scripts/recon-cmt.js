/*
 * recon-cmt.js — single-VU standalone smoke harness for the CMT journey.
 * =========================================================================
 * THROWAWAY standalone runner, the CMT sibling of recon-g3.js. It does NOT
 * load-test anything and is NOT wired into load.js. Its single job is to run
 * the read-only cmtFlow() ONCE (1 VU, 1 iteration) so the new CMT journey can
 * be validated against prod in isolation before it joins the basket.
 *
 * It reuses lib/config.js (env + required-var guard) and lib/auth.js (per-user
 * password-grant token) so it pulls creds + HOST from the SAME env as the smoke.
 * CMT Loadtest user:
 *   CMT = CMT_USER / CMT_PASS
 *
 * It authenticates ONCE as the CMT user in setup(), then drives cmtFlow() once
 * with that token. cmtFlow is read-only (search* + searchById only); no writes.
 *
 * Run (from repo root), passing creds via -e so .env is untouched:
 *   k6 run --config scripts/config.json \
 *     -e CMT_USER=load.tea -e CMT_PASS=i5ATXG713WN3oC \
 *     scripts/recon-cmt.js
 *
 * (HOST, CLIENT_ID, CLIENT_SECRET, VUS, ITERATIONS and the other required vars
 * still come from your .env / environment as usual; only the CMT creds are
 * injected here.)
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init.
import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { cmtFlow } from './scenarios/cmt.js';

// Minimal single-shot profile — this is a smoke check, not load.
export const options = {
  ...tlsOptions,
  vus: 1,
  iterations: 1,
};

// One token for the CMT user, fetched in setup() and reused.
export function setup() {
  const cmtToken = authenticate(config.CMT_USER, config.CMT_PASS, 'CMT', config);
  return { cmtToken };
}

export default function (data) {
  cmtFlow(data.cmtToken, config);
}
