/*
 * k6 LOAD TEST — WCF pre-go-live PRODUCTION (parallel arrival-rate harness)
 * =========================================================================
 * Target host : https://wcfapi.sso.go.th  (PRODUCTION, pre-go-live)
 *               No live users / no real data at risk. Do NOT point at UAT.
 *
 * Purpose     : Drive the live read-only modules (G0, REG, CON-G2, FIN) in PARALLEL
 *               (G3 is parked pending acc-service routing on the gateway)
 *               under a controlled, weighted request rate to validate the load
 *               harness and capture latency/error SLOs. This is the LOAD test,
 *               separate from smoke.js (which stays a 1-2 VU functional check).
 *               Do NOT confuse the two; this file never overwrites smoke.js.
 *
 * Profile     : STEPPED two-tier load in ONE continuous run (~37.5 min). Each
 *               scenario walks the same five stages:
 *                 1. ramp 0 -> warm-up rate over 30s
 *                 2. hold warm-up rate for WARMUP_HOLD (default 3m)
 *                 3. ramp warm-up -> load rate over 1m
 *                 4. hold load rate for LOAD_HOLD (default 30m)
 *                 5. ramp -> 0 over COOLDOWN (default 3m, cool down)
 *               The warm-up tier offers LOW_RPS total HTTP req/s; the load tier
 *               offers HIGH_RPS. Both tiers and all hold durations are env
 *               tunable, so the one file covers validation, go-live, and soak:
 *                   k6 run -e LOW_RPS=100 -e HIGH_RPS=150 ... scripts/load.js
 *                   k6 run -e HIGH_RPS=400 ... scripts/load.js   (heavier peak)
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
// G3 is parked pending acc-service routing on the gateway (g3.js stays on disk).
import { finFlow } from './scenarios/fin.js';
import { cmpFlow } from './scenarios/cmp.js';

// ---------------------------------------------------------------------------
// RATE MATH — weighting is on HTTP REQUESTS, not journeys.
// =========================================================================
// The traffic mix is specified per HTTP request across the four live modules:
// G0 65%, REG 18%, CON-G2 10%, FIN 7%. (G3 is parked pending acc-service routing
// on the gateway; its old 7% share was dropped and the remaining four were
// renormalized to sum to 1.0, keeping G0 dominant.) Arrival-rate executors are
// driven by ITERATIONS (journeys) per second, so we convert each module's
// request-share into a journey rate by dividing by the real number of HTTP
// requests one journey of that module fires.
//
// requestsPerJourney (counted from the scenario code, healthy/seeded path):
//   G0     = 3   (3 unconditional GETs in g0Flow)
//   REG    = 6   (step 1 + chained steps 2-6, all reads)
//   CON-G2 = 16  (12 unconditional steps + 4 chained detail steps;
//                 steps 9-11 hire-report are commented out of the basket)
//   FIN    = 14  (7 read-only steps x 2 branches: two searches, an inquiry
//                 list + chained detail, an edit list + chained detail, and a
//                 pending-approval list; the parked write steps are not counted)
//
// We compute TWO tiers per module from the two total-req/s knobs:
//   warmRate = Math.max(1, Math.round(LOW_RPS  * weight / requestsPerJourney))
//   loadRate = Math.max(1, Math.round(HIGH_RPS * weight / requestsPerJourney))
// Math.max(1, ...) guarantees every module still fires even when its share
// rounds below 1 (e.g. CON-G2 at the warm-up tier).
//
// At the defaults (LOW_RPS = 100, HIGH_RPS = 150) this yields:
//   warm-up tier (LOW_RPS = 100 total req/s):
//     G0     : 100 * 0.65 =  65.0 req/s ;  65.0 / 3  = 21.67 -> 22 journeys/s
//     REG    : 100 * 0.18 =  18.0 req/s ;  18.0 / 6  =  3.00 ->  3 journeys/s
//     CON-G2 : 100 * 0.10 =  10.0 req/s ;  10.0 / 16 =  0.62 ->  1 journeys/s (floored)
//     FIN    : 100 * 0.07 =   7.0 req/s ;   7.0 / 14 =  0.50 ->  1 journeys/s (floored)
//   load tier (HIGH_RPS = 150 total req/s):
//     G0     : 150 * 0.65 =  97.5 req/s ;  97.5 / 3  = 32.50 -> 32 journeys/s
//     REG    : 150 * 0.18 =  27.0 req/s ;  27.0 / 6  =  4.50 ->  4 journeys/s
//     CON-G2 : 150 * 0.10 =  15.0 req/s ;  15.0 / 16 =  0.94 ->  1 journeys/s (floored)
//     FIN    : 150 * 0.07 =  10.5 req/s ;  10.5 / 14 =  0.75 ->  1 journeys/s (floored)
//
// Per-scenario stage targets at the defaults: g0 22->32, reg 3->4, cong2 1->1,
// fin 1->1.
//
// FLOOR SKEW at the 150 load tier: cong2 and fin both floor to 1 j/s. Because
// they fire many requests per journey, their floored actual req/s differs from
// their weighted share:
//   CON-G2 floored 1 j/s -> 16 req/s actual vs 15.0 weighted (10% -> ~10.7%)
//   FIN    floored 1 j/s -> 14 req/s actual vs 10.5 weighted ( 7% -> ~9.3%)
// G0 (32 j/s) rounds to 96 req/s actual (vs 97.5 weighted) and REG (4 j/s) to
// 24 req/s actual (vs 27.0 weighted). The realized total at the 150 load tier is
// therefore 96 + 24 + 16 + 14 = 150 req/s. With G3 gone the big floor skew is
// removed; the residual difference is just rounding plus the cong2/fin floor.
// ---------------------------------------------------------------------------

const LOW_RPS = Number(__ENV.LOW_RPS) || 100;    // warm-up total HTTP req/s
const HIGH_RPS = Number(__ENV.HIGH_RPS) || 150;  // load total HTTP req/s

// Hold durations (env tunable). The two ramps (30s up, 1m between tiers) stay
// hardcoded; cool-down is COOLDOWN.
const WARMUP_HOLD = __ENV.WARMUP_HOLD || '3m';
const LOAD_HOLD = __ENV.LOAD_HOLD || '30m';
const COOLDOWN = __ENV.COOLDOWN || '3m';

// Module weights (share of total HTTP requests) and real requests-per-journey.
// G3 is parked pending acc-service routing on the gateway; its 0.07 slice was
// dropped and the remaining four modules renormalized to sum to 1.0, keeping g0
// dominant. FIN stays read-only (7 read steps x 2 branches = 14 reqs).
// CMP is a read-only search-then-detail basket (7 active read steps in cmp.js;
// step 8 searchRemainPayment is parked/commented out and does not run), wired
// at FIN's floor weight (0.07). At both tiers its share floors to 1 journey/s,
// exactly like FIN (100*0.07/7 = 1.0 -> 1 ; 150*0.07/7 = 1.5 -> 2). CMP's
// 1 journey/s is taken out of G0's slice below so the per-tier basket total is
// unchanged (G0 22->32 becomes 21->31); REG, CON-G2, and FIN are untouched.
const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmp: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmp: 7 };

// journeyRate(module, totalRps): convert this module's request-share at the
// given total req/s into a journey/s target rate, never rounding to 0.
function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

const REG_WARM = journeyRate('reg', LOW_RPS);
const REG_LOAD = journeyRate('reg', HIGH_RPS);
const CONG2_WARM = journeyRate('cong2', LOW_RPS);
const CONG2_LOAD = journeyRate('cong2', HIGH_RPS);
const FIN_WARM = journeyRate('fin', LOW_RPS);
const FIN_LOAD = journeyRate('fin', HIGH_RPS);
const CMP_WARM = journeyRate('cmp', LOW_RPS);
const CMP_LOAD = journeyRate('cmp', HIGH_RPS);
// G0 absorbs CMP's journey rate so the per-tier basket total stays unchanged:
// CMP takes the 1 journey/s that was G0's (G0 22->32 becomes 21->31).
const G0_WARM = journeyRate('g0', LOW_RPS) - CMP_WARM;
const G0_LOAD = journeyRate('g0', HIGH_RPS) - CMP_LOAD;

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

export function finScenario(data) {
  finFlow(data.finToken, config);
}

export function cmpScenario(data) {
  cmpFlow(data.cmpToken, config);
}

// ---------------------------------------------------------------------------
// Options — TLS spread first, then one ramping-arrival-rate scenario per module.
// Common stepped shape per scenario (one continuous run):
//   ramp 0 -> warm over 30s, hold warm WARMUP_HOLD, ramp warm -> load over 1m,
//   hold load LOAD_HOLD, ramp -> 0 over COOLDOWN.
// startRate 0, timeUnit 1s. preAllocatedVUs/maxVUs were originally sized for a
// 400 rps LOAD tier and are deliberately left generous at the 150 rps tier so
// VUs are never the bottleneck (oversized ceilings are harmless; k6 only spins
// up what the arrival rate needs). At 150 rps the realized peak journey rates
// are low (G0 30 j/s, REG 4 j/s, the rest floored at 1 j/s):
//   G0  : short journey (~3 GETs + sleeps) at 30 journeys/s -> preAllocate 50,
//         maxVUs 400 (generous; far more than 30 j/s needs).
//   REG : ~6 calls + sleeps at 4 journeys/s -> preAllocate 20, maxVUs 100.
//   CON-G2: long ~16-call journey, each iteration runs many seconds, so even at
//         the floored 1 journey/s several iterations overlap -> preAllocate 30,
//         maxVUs 150 (kept generous, not starved).
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
    fin: {
      executor: 'ramping-arrival-rate',
      exec: 'finScenario',
      startRate: 0,
      timeUnit: '1s',
      // FIN's read journey runs 14 steps across two branches with a sleep
      // between most, so each iteration runs several seconds. Even at the
      // floored journey rate many iterations overlap, so it needs a
      // CON-G2/G3-class ceiling.
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: FIN_WARM, duration: '30s' },
        { target: FIN_WARM, duration: WARMUP_HOLD },
        { target: FIN_LOAD, duration: '1m' },
        { target: FIN_LOAD, duration: LOAD_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
    cmp: {
      executor: 'ramping-arrival-rate',
      exec: 'cmpScenario',
      startRate: 0,
      timeUnit: '1s',
      // CMP's read journey runs 8 search/detail steps with a sleep between
      // most, so each iteration runs several seconds. Even at the floored
      // journey rate many iterations overlap, so it needs a FIN-class ceiling.
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: CMP_WARM, duration: '30s' },
        { target: CMP_WARM, duration: WARMUP_HOLD },
        { target: CMP_LOAD, duration: '1m' },
        { target: CMP_LOAD, duration: LOAD_HOLD },
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
    fin_req_duration: ['p(95)<3000'],
    cmp_req_duration: ['p(95)<3000'],
  },
};

// ---------------------------------------------------------------------------
// setup() — authenticate ONCE, cache tokens, hand them to every scenario as
// the `data` arg (same as smoke). G0 reuses regToken.
// ---------------------------------------------------------------------------
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  const cmpToken = authenticate(config.CMP_USER, config.CMP_PASS, 'CMP', config);
  return { regToken, conG2Token, finToken, cmpToken };
}
