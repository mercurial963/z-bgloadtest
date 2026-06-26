/*
 * k6 SOAK TEST — WCF pre-go-live PRODUCTION (steady-state endurance harness)
 * =========================================================================
 * Target host : https://wcfapi.sso.go.th  (PRODUCTION, pre-go-live)
 *               No live users / no real data at risk. Do NOT point at UAT.
 *
 * Purpose     : Hold NORMAL target load (150 req/s, the same weighted basket
 *               load.js drives) STEADY for a long window (2h by default) to
 *               surface slow-burn failures a short run never reaches: memory
 *               leaks, connection-pool / file-handle exhaustion, and gradual
 *               latency degradation. This is endurance, not stress — the offered
 *               rate is the normal load tier, never elevated. For peak/ceiling
 *               work use load.js (-e HIGH_RPS=400). This file never overwrites
 *               load.js or smoke.js.
 *
 * Profile     : SINGLE steady tier in one continuous run (~2h 6m at defaults).
 *               Each scenario walks three stages:
 *                 1. ramp 0 -> load rate over WARMUP (default 1m, short warm-up)
 *                 2. hold load rate for LOAD_HOLD (default 2h — the soak)
 *                 3. ramp -> 0 over COOLDOWN (default 5m, cool down)
 *               There is no separate low/high tier (that two-tier shape is
 *               load.js's job). Soak runs ONE rate, the normal 150 req/s load
 *               level, for the whole hold. All three durations are env tunable.
 *
 * Run         :
 *   cd scripts && set -a; source .env; set +a
 *   k6 run --config config.json soak.js                 # 2h hold (default)
 *   k6 run --config config.json -e LOAD_HOLD=4h soak.js # longer soak
 *   k6 run --config config.json -e LOAD_HOLD=30m soak.js # short dry-run
 *   k6 run --config config.json -e RPS=200 soak.js      # heavier steady rate
 *   k6 run --config config.json -e WARMUP=2m -e COOLDOWN=2m soak.js
 *
 * Executors   : One `ramping-arrival-rate` scenario per module (same as
 *               load.js). Arrival-rate executors hold a target ITERATIONS
 *               (journeys) per second and spin up VUs as needed, so the offered
 *               load stays rate-driven and does not collapse if latency drifts
 *               over the long hold — exactly what a soak needs to observe.
 *
 * Auth        : Bearer JWT. Authenticated ONCE in setup() (one token per module
 *               user, same as load.js / smoke) and the returned object is handed
 *               to every scenario function as its `data` arg. Tokens are
 *               requested at the 6h max TTL (see auth.js) so they outlive the
 *               default 2h hold without a re-auth mid-run.
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
// Identical model to load.js, but with ONE tier instead of two. The traffic mix
// is specified per HTTP request across the live modules: G0 65%, REG 18%,
// CON-G2 10%, FIN 7% (G3 parked, its 7% dropped and the rest renormalized to
// 1.0). Arrival-rate executors are driven by ITERATIONS (journeys) per second,
// so we convert each module's request-share into a journey rate by dividing by
// the real number of HTTP requests one journey of that module fires.
//
// requestsPerJourney (counted from the scenario code, healthy/seeded path):
//   G0     = 3   (3 unconditional GETs in g0Flow)
//   REG    = 6   (step 1 + chained steps 2-6, all reads)
//   CON-G2 = 16  (12 unconditional steps + 4 chained detail steps)
//   FIN    = 14  (7 read-only steps x 2 branches)
//   CMP    = 8   (read-only search-then-detail basket)
//
// One journey rate per module, derived from the single steady total req/s knob:
//   loadRate = Math.max(1, Math.round(RPS * weight / requestsPerJourney))
// Math.max(1, ...) guarantees every module still fires even when its share
// rounds below 1 (CON-G2 and FIN floor to 1 j/s at 150 req/s).
//
// At the default (RPS = 150) this yields the same steady tier as load.js's
// load tier:
//   G0     : 150 * 0.65 =  97.5 req/s ;  97.5 / 3  = 32.50 -> 32 journeys/s
//   REG    : 150 * 0.18 =  27.0 req/s ;  27.0 / 6  =  4.50 ->  4 journeys/s
//   CON-G2 : 150 * 0.10 =  15.0 req/s ;  15.0 / 16 =  0.94 ->  1 journeys/s (floored)
//   FIN    : 150 * 0.07 =  10.5 req/s ;  10.5 / 14 =  0.75 ->  1 journeys/s (floored)
//   CMP    : 150 * 0.07 =  10.5 req/s ;  10.5 / 8  =  1.31 ->  1 journeys/s (floored)
// CMP's 1 journey/s is taken out of G0's slice below (G0 32 -> 31) so the basket
// total is unchanged, exactly as load.js does it. Realized total at the default:
// G0 93 + REG 24 + CON-G2 16 + FIN 14 + CMP 8 = 155 req/s actual, the same
// floor-skewed ~150 the load tier produces.
// ---------------------------------------------------------------------------

const RPS = Number(__ENV.RPS) || 150;  // steady soak total HTTP req/s (normal load level)

// Phase durations (env tunable). The soak's defining knob is LOAD_HOLD=2h.
// WARMUP and COOLDOWN stay short so the run is almost entirely steady-state.
const WARMUP = __ENV.WARMUP || '1m';
const LOAD_HOLD = __ENV.LOAD_HOLD || '2h';
const COOLDOWN = __ENV.COOLDOWN || '5m';

// Module weights (share of total HTTP requests) and real requests-per-journey —
// identical to load.js so a soak run is directly comparable to a load run. G3 is
// parked pending acc-service routing; its 0.07 slice was dropped and the rest
// renormalized to 1.0. CMP is wired at FIN's floor weight (0.07).
const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmp: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmp: 8 };

// journeyRate(module, totalRps): convert this module's request-share at the
// given total req/s into a journey/s target rate, never rounding to 0.
function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

const REG_RATE = journeyRate('reg', RPS);
const CONG2_RATE = journeyRate('cong2', RPS);
const FIN_RATE = journeyRate('fin', RPS);
const CMP_RATE = journeyRate('cmp', RPS);
// G0 absorbs CMP's journey rate so the basket total stays unchanged:
// CMP takes the 1 journey/s that was G0's (G0 32 -> 31).
const G0_RATE = journeyRate('g0', RPS) - CMP_RATE;

// ---------------------------------------------------------------------------
// Scenario functions. Each reads its token off the setup() return passed in as
// `data` (same access pattern as load.js / smoke). G0 reuses regToken.
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
// Common steady shape per scenario (one continuous run):
//   ramp 0 -> load over WARMUP, hold load LOAD_HOLD, ramp -> 0 over COOLDOWN.
// startRate 0, timeUnit 1s. preAllocatedVUs/maxVUs mirror load.js's generous
// ceilings; at 150 rps the realized journey rates are low and VUs are never the
// bottleneck (oversized ceilings are harmless; k6 only spins up what the arrival
// rate needs). They are kept generous here because a 2h hold can drift latency
// upward, and a rising per-journey duration means each journey/s needs MORE
// concurrent VUs over time — the headroom keeps the offered rate honest.
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
        { target: G0_RATE, duration: WARMUP },
        { target: G0_RATE, duration: LOAD_HOLD },
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
        { target: REG_RATE, duration: WARMUP },
        { target: REG_RATE, duration: LOAD_HOLD },
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
        { target: CONG2_RATE, duration: WARMUP },
        { target: CONG2_RATE, duration: LOAD_HOLD },
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
        { target: FIN_RATE, duration: WARMUP },
        { target: FIN_RATE, duration: LOAD_HOLD },
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
        { target: CMP_RATE, duration: WARMUP },
        { target: CMP_RATE, duration: LOAD_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
  },
  thresholds: {
    // Same acceptance gates as load.js so a soak run is directly comparable.
    http_req_duration: ['p(95)<3000'],
    // Error rate < 0.5% (the stakeholder acceptance criterion). load.js carries
    // the looser rate<0.01; soak holds the strict 0.5% gate over the long run.
    http_req_failed: ['rate<0.005'],
    // Auth p95 < 2s — auth requests are tagged `auth:<LABEL>` in auth.js, so the
    // sub-metric below gates the token endpoint specifically.
    'http_req_duration{name:auth:REG}': ['p(95)<2000'],
    'http_req_duration{name:auth:CON-G2}': ['p(95)<2000'],
    'http_req_duration{name:auth:FIN}': ['p(95)<2000'],
    'http_req_duration{name:auth:CMP}': ['p(95)<2000'],
    // Per-module visibility (same per-domain metrics as load.js).
    reg_req_duration: ['p(95)<3000'],
    cong2_req_duration: ['p(95)<3000'],
    g0_req_duration: ['p(95)<3000'],
    fin_req_duration: ['p(95)<3000'],
    cmp_req_duration: ['p(95)<3000'],
  },
};

// ---------------------------------------------------------------------------
// setup() — authenticate ONCE, cache tokens, hand them to every scenario as
// the `data` arg (same as load.js / smoke). G0 reuses regToken. Tokens are
// requested at the 6h max TTL (auth.js) so they survive the 2h default hold.
// ---------------------------------------------------------------------------
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  const cmpToken = authenticate(config.CMP_USER, config.CMP_PASS, 'CMP', config);
  return { regToken, conG2Token, finToken, cmpToken };
}
