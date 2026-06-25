/*
 * k6 SMOKE TEST — WCF pre-go-live PRODUCTION (thin entrypoint)
 * =========================================================================
 * Target host : https://wcfapi.sso.go.th  (PRODUCTION, pre-go-live)
 *               No live users / no real data at risk. Do NOT point at UAT.
 *
 * Purpose     : Prove the two read-only user journeys run against production
 *               and capture baseline latency (p50/p95). This is a SMOKE test
 *               (1-2 VUs, low iterations) — NOT the 400 req/s load test.
 *
 * Structure   : This file is a thin entrypoint. The domain flows live in
 *               ./scenarios/reg.js and ./scenarios/cong2.js; env config +
 *               the required-var guard live in ./lib/config.js; auth + the
 *               shared response/request helpers live in ./lib/.
 *
 * IMPORTANT   : ./lib/config.js is imported FIRST. Its required-var guard runs
 *               at module init (on import), so a missing VUS/ITERATIONS fails
 *               clearly and immediately — before k6 evaluates `options` below.
 *
 * Auth        : Bearer JWT. Authenticated ONCE in setup() (one token per
 *               module user) and cached + reused across iterations.
 *
 * Read-only   : No write endpoints. No payment callbacks. No admin endpoints.
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init,
// before k6 evaluates `export const options`. Do not reorder these imports.
import { config, tlsOptions } from './lib/config.js';
import { sleep } from 'k6';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';
import { g3Flow } from './scenarios/g3.js';
import { finFlow } from './scenarios/fin.js';

// ---------------------------------------------------------------------------
// Options — smoke profile + baseline thresholds.
// Presence of VUS/ITERATIONS is enforced by the config.js init guard above
// (k6 evaluates these at init time, before setup()), so they parse cleanly or
// the guard has already thrown. No `|| fallback`.
// ---------------------------------------------------------------------------
export const options = {
  ...tlsOptions,
  vus: config.VUS,
  iterations: config.ITERATIONS,
  thresholds: {
    // Aligned with project acceptance criteria; smoke just confirms ballpark.
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
    // Per-domain visibility.
    reg_req_duration: ['p(95)<3000'],
    cong2_req_duration: ['p(95)<3000'],
    g0_req_duration: ['p(95)<3000'],
    g3_req_duration: ['p(95)<3000'],
    fin_req_duration: ['p(95)<3000'],
  },
};

// ---------------------------------------------------------------------------
// setup() — authenticate ONCE, cache tokens, reuse across all iterations.
// ---------------------------------------------------------------------------
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const g3Token = authenticate(config.G3_USER, config.G3_PASS, 'G3', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  return { regToken, conG2Token, g3Token, finToken };
}

// ---------------------------------------------------------------------------
// Default VU iteration — runs both domain flows once per iteration.
// ---------------------------------------------------------------------------
export default function (data) {
  regFlow(data.regToken, config);
  sleep(1);
  conG2Flow(data.conG2Token, config);
  sleep(1);
  g0Flow(data.regToken, config);
  sleep(1);
  g3Flow(data.g3Token, config);
  sleep(1);
  finFlow(data.finToken, config);
  sleep(1);
}
