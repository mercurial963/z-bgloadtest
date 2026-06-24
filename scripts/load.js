/*
 * k6 LOAD TEST — WCF pre-go-live PRODUCTION (parallel arrival-rate harness)
 * =========================================================================
 * Target host : https://wcfapi.sso.go.th  (PRODUCTION, pre-go-live)
 *               No live users / no real data at risk. Do NOT point at UAT.
 *
 * Purpose     : Drive the three locked modules (G0, REG, CON-G2) in PARALLEL
 *               under a controlled, weighted request rate to validate the load
 *               harness and capture latency/error SLOs. This is the LOAD test,
 *               separate from smoke.js (which stays a 1-2 VU functional check).
 *               Do NOT confuse the two; this file never overwrites smoke.js.
 *
 * Profile     : STEPPED two-tier load in ONE continuous run (~51 min). Each
 *               scenario walks the same five stages:
 *                 1. ramp 0 -> warm-up rate over 30s
 *                 2. hold warm-up rate for WARMUP_HOLD (default 15m)
 *                 3. ramp warm-up -> load rate over 1m
 *                 4. hold load rate for LOAD_HOLD (default 30m)
 *                 5. ramp -> 0 over COOLDOWN (default 5m, cool down)
 *               The warm-up tier offers LOW_RPS total HTTP req/s; the load tier
 *               offers HIGH_RPS. Both tiers and all hold durations are env
 *               tunable, so the one file covers validation, go-live, and soak:
 *                   k6 run -e LOW_RPS=100 -e HIGH_RPS=400 ... scripts/load.js
 *                   k6 run -e HIGH_RPS=600 ... scripts/load.js   (heavier peak)
 *                   k6 run -e LOAD_HOLD=2h ... scripts/load.js    (soak)
 *                   k6 run -e WARMUP_HOLD=5m -e COOLDOWN=2m ... scripts/load.js
 *               All per-scenario rates derive from LOW_RPS / HIGH_RPS, so
 *               bumping a tier rescales that tier proportionally.
 *
 * Executors   : One `ramping-arrival-rate` scenario per module. Arrival-rate
 *               executors hold a target ITERATIONS (journeys) per second and
 *               spin up VUs as needed, so the offered load is rate-driven and
 *               does not collapse when a module's latency rises.
 *
 * Auth        : Bearer JWT. Authenticated ONCE in setup() (one token per
 *               module user, same as smoke) and the returned object is handed
 *               to every scenario function as its `data` arg.
 *
 * Read-only   : No write endpoints. No payment callbacks. No admin endpoints.
 * =========================================================================
 */

// config.js FIRST — importing it runs the required-var guard at module init,
// before k6 evaluates `export const options`. Do not reorder these imports.
import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';

// ---------------------------------------------------------------------------
// RATE MATH — weighting is on HTTP REQUESTS, not journeys.
// =========================================================================
// The traffic mix is specified per HTTP request: G0 70%, REG 20%, CON-G2 10%.
// Arrival-rate executors are driven by ITERATIONS (journeys) per second, so we
// convert each module's request-share into a journey rate by dividing by the
// real number of HTTP requests one journey of that module fires.
//
// requestsPerJourney (counted from the scenario code, healthy/seeded path):
//   G0     = 3   (3 unconditional GETs in g0Flow)
//   REG    = 6   (step 1 + chained steps 2-6, all reads)
//   CON-G2 = 16  (12 unconditional steps + 4 chained detail steps;
//                 steps 9-11 hire-report are commented out of the basket)
//
// We compute TWO tiers per module from the two total-req/s knobs:
//   warmRate = Math.max(1, Math.round(LOW_RPS  * weight / requestsPerJourney))
//   loadRate = Math.max(1, Math.round(HIGH_RPS * weight / requestsPerJourney))
// Math.max(1, ...) guarantees every module still fires even when its share
// rounds below 1 (e.g. CON-G2 at the warm-up tier).
//
// At the defaults (LOW_RPS = 100, HIGH_RPS = 400) this yields:
//   warm-up tier (LOW_RPS = 100 total req/s):
//     G0     : 100 * 0.70 =  70 req/s ;  70 / 3  = 23.33 -> 23 journeys/s
//     REG    : 100 * 0.20 =  20 req/s ;  20 / 6  =  3.33 ->  3 journeys/s
//     CON-G2 : 100 * 0.10 =  10 req/s ;  10 / 16 =  0.625 -> 1 journeys/s (floored)
//   load tier (HIGH_RPS = 400 total req/s):
//     G0     : 400 * 0.70 = 280 req/s ; 280 / 3  = 93.33 -> 93 journeys/s
//     REG    : 400 * 0.20 =  80 req/s ;  80 / 6  = 13.33 -> 13 journeys/s
//     CON-G2 : 400 * 0.10 =  40 req/s ;  40 / 16 =  2.5  ->  3 journeys/s
//
// Per-scenario stage targets at the defaults: g0 23->93, reg 3->13, cong2 1->3.
// ---------------------------------------------------------------------------

const LOW_RPS = Number(__ENV.LOW_RPS) || 100;    // warm-up total HTTP req/s
const HIGH_RPS = Number(__ENV.HIGH_RPS) || 400;  // load total HTTP req/s

// Hold durations (env tunable). The two ramps (30s up, 1m between tiers) stay
// hardcoded; cool-down is COOLDOWN.
const WARMUP_HOLD = __ENV.WARMUP_HOLD || '3m';
const LOAD_HOLD = __ENV.LOAD_HOLD || '10m';
const COOLDOWN = __ENV.COOLDOWN || '3m';

// Module weights (share of total HTTP requests) and real requests-per-journey.
const WEIGHTS = { g0: 0.70, reg: 0.20, cong2: 0.10 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16 };

// journeyRate(module, totalRps): convert this module's request-share at the
// given total req/s into a journey/s target rate, never rounding to 0.
function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

const G0_WARM = journeyRate('g0', LOW_RPS);
const G0_LOAD = journeyRate('g0', HIGH_RPS);
const REG_WARM = journeyRate('reg', LOW_RPS);
const REG_LOAD = journeyRate('reg', HIGH_RPS);
const CONG2_WARM = journeyRate('cong2', LOW_RPS);
const CONG2_LOAD = journeyRate('cong2', HIGH_RPS);

// ---------------------------------------------------------------------------
// Scenario functions. Each reads its token off the setup() return passed in as
// `data` (same access pattern as smoke's default fn). G0 reuses regToken.
// ---------------------------------------------------------------------------
export function g0Scenario(data) {
  g0Flow(data.regToken, config);
}

export function regScenario(data) {
  regFlow(data.regToken, config);
}

export function cong2Scenario(data) {
  conG2Flow(data.conG2Token, config);
}

// ---------------------------------------------------------------------------
// Options — TLS spread first, then one ramping-arrival-rate scenario per module.
// Common stepped shape per scenario (one continuous run):
//   ramp 0 -> warm over 30s, hold warm WARMUP_HOLD, ramp warm -> load over 1m,
//   hold load LOAD_HOLD, ramp -> 0 over COOLDOWN.
// startRate 0, timeUnit 1s. preAllocatedVUs/maxVUs are sized for the 400 rps
// LOAD tier (G0 = 93 journeys/s) so VUs are never the bottleneck at peak:
//   G0  : short journey (~3 GETs + sleeps) but very high journey rate, so it
//         needs a wide ceiling -> preAllocate 50, maxVUs 400.
//   REG : ~6 calls + sleeps at 13 journeys/s -> preAllocate 20, maxVUs 100.
//   CON-G2: long ~16-call journey, each iteration runs many seconds, so even at
//         3 journeys/s many iterations overlap -> preAllocate 30, maxVUs 150.
// ---------------------------------------------------------------------------
export const options = {
  ...tlsOptions,
  scenarios: {
    g0: {
      executor: 'ramping-arrival-rate',
      exec: 'g0Scenario',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: G0_WARM, duration: '30s' },
        { target: G0_WARM, duration: WARMUP_HOLD },
        { target: G0_LOAD, duration: '1m' },
        { target: G0_LOAD, duration: LOAD_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
    reg: {
      executor: 'ramping-arrival-rate',
      exec: 'regScenario',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { target: REG_WARM, duration: '30s' },
        { target: REG_WARM, duration: WARMUP_HOLD },
        { target: REG_LOAD, duration: '1m' },
        { target: REG_LOAD, duration: LOAD_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
    cong2: {
      executor: 'ramping-arrival-rate',
      exec: 'cong2Scenario',
      startRate: 0,
      timeUnit: '1s',
      // CON-G2's journey is the longest (many sequential steps + sleeps), so it
      // needs far more VUs per journey/s than G0/REG to sustain its arrival rate.
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: CONG2_WARM, duration: '30s' },
        { target: CONG2_WARM, duration: WARMUP_HOLD },
        { target: CONG2_LOAD, duration: '1m' },
        { target: CONG2_LOAD, duration: LOAD_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
  },
  thresholds: {
    // Go-live SLOs (same metrics as smoke).
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
    // Per-module visibility.
    reg_req_duration: ['p(95)<3000'],
    cong2_req_duration: ['p(95)<3000'],
    g0_req_duration: ['p(95)<3000'],
  },
};

// ---------------------------------------------------------------------------
// setup() — authenticate ONCE, cache tokens, hand them to every scenario as
// the `data` arg (same as smoke). G0 reuses regToken.
// ---------------------------------------------------------------------------
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  return { regToken, conG2Token };
}
