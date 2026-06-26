/*
 * k6 STRESS TEST — WCF pre-go-live PRODUCTION (stepped ramp-to-ceiling harness)
 * =========================================================================
 * Target host : https://wcfapi.sso.go.th  (PRODUCTION, pre-go-live)
 *               No live users / no real data at risk. Do NOT point at UAT.
 *
 * What a stress test is:
 *               A stress test deliberately pushes the system PAST its normal
 *               load to find the breaking point and observe the FAILURE MODE.
 *               Normal target load is 150 req/s (see soak.js / load.js's load
 *               tier). The ORIGINAL scope — and the peak this system is meant to
 *               survive — is 400 req/s. This script drives toward that 400 req/s
 *               ceiling so we can watch HOW the system behaves as it approaches
 *               and holds peak: graceful slowdown (rising p95, still 200s),
 *               hard errors (5xx from the app), or gateway refusals (429/503
 *               from the edge). The point is to OBSERVE degradation, not to
 *               assert a clean pass. This file never overwrites load.js,
 *               soak.js, or smoke.js.
 *
 * Profile     : STEPPED RAMP toward the 400 peak in ONE continuous run, so we
 *               see WHERE it degrades rather than slamming 400 instantly. Each
 *               scenario walks the same stepped shape:
 *                 1. ramp 0 -> step-1 rate over RAMP (default 1m)
 *                 2. hold step-1 rate for STEP_HOLD (default 10m)  [STEP1_RPS=150]
 *                 3. ramp step-1 -> step-2 rate over RAMP          [STEP2_RPS=250]
 *                 4. hold step-2 rate for STEP_HOLD
 *                 5. ramp step-2 -> peak rate over RAMP            [RPS=400]
 *                 6. hold peak rate for PEAK_HOLD (default 10m, peak hold)
 *                 7. ramp -> 0 over COOLDOWN (default 3m, cool down)
 *               At defaults the run is ~1+10+1+10+1+10+3 = ~36 min. All step rates
 *               and all durations are env tunable.
 *
 * Rate math   : Identical weighted-basket model to load.js / soak.js — weighting
 *               is on HTTP REQUESTS, not journeys — applied at EACH step rate.
 *               The same journeyRate() conversion scales every step the same way
 *               load.js scales its tiers, just walked up to the 400 ceiling.
 *
 * Executors   : One `ramping-arrival-rate` scenario per module (same as load.js /
 *               soak.js). Arrival-rate executors hold a target ITERATIONS
 *               (journeys) per second and spin up VUs as needed, so the offered
 *               load stays rate-driven and does NOT collapse when a module's
 *               latency rises under stress — exactly what we need to read the
 *               failure mode at the ceiling.
 *
 * Auth        : Bearer JWT. Authenticated ONCE in setup() (one token per module
 *               user, same as load.js / soak.js / smoke) and the returned object
 *               is handed to every scenario function as its `data` arg. Tokens
 *               are requested at the 6h max TTL (auth.js) so they outlive the run.
 *
 * Thresholds  : SAME gates as load.js / soak.js (overall p95 < 3s, auth p95 < 2s,
 *               error rate < 0.5%) so the report still shows pass/fail markers —
 *               but set NON-ABORTING (no abortOnFail). A stress test must run to
 *               completion and reveal the ceiling; we do not want k6 to bail the
 *               instant it crosses a gate. The markers tell us at which step the
 *               SLOs broke; the run keeps going past them on purpose.
 *
 * Run         :
 *   cd scripts && set -a; source .env; set +a
 *   k6 run --config config.json stress.js                  # ramp to 400 peak (default)
 *   k6 run --config config.json -e RPS=500 stress.js       # push the peak higher
 *   k6 run --config config.json \
 *     -e STEP1_RPS=200 -e STEP2_RPS=300 -e RPS=400 stress.js  # custom step rates
 *   k6 run --config config.json \
 *     -e STEP_HOLD=3m -e PEAK_HOLD=10m -e RAMP=30s -e COOLDOWN=2m stress.js
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
import { cmtFlow } from './scenarios/cmt.js';

// ---------------------------------------------------------------------------
// RATE MATH — weighting is on HTTP REQUESTS, not journeys.
// =========================================================================
// Identical model to load.js / soak.js, but walked up THREE steps toward the
// 400 ceiling instead of one or two tiers. The traffic mix is specified per HTTP
// request across the live modules: G0 65%, REG 18%, CON-G2 10%, FIN 7% (G3
// parked, its 7% dropped and the rest renormalized to 1.0). Arrival-rate
// executors are driven by ITERATIONS (journeys) per second, so we convert each
// module's request-share into a journey rate by dividing by the real number of
// HTTP requests one journey of that module fires.
//
// requestsPerJourney (counted from the scenario code, healthy/seeded path):
//   G0     = 3   (3 unconditional GETs in g0Flow)
//   REG    = 6   (step 1 + chained steps 2-6, all reads)
//   CON-G2 = 16  (12 unconditional steps + 4 chained detail steps)
//   FIN    = 14  (7 read-only steps x 2 branches)
//   CMT    = 8   (read-only search-then-detail basket)
//
// One journey rate per module PER STEP, derived from that step's total req/s:
//   stepRate = Math.max(1, Math.round(stepRps * weight / requestsPerJourney))
// Math.max(1, ...) guarantees every module still fires even when its share
// rounds below 1.
//
// At the PEAK step (RPS = 400) this yields:
//   G0     : 400 * 0.65 = 260.0 req/s ; 260.0 / 3  = 86.67 -> 87 journeys/s
//   REG    : 400 * 0.18 =  72.0 req/s ;  72.0 / 6  = 12.00 -> 12 journeys/s
//   CON-G2 : 400 * 0.10 =  40.0 req/s ;  40.0 / 16 =  2.50 ->  3 journeys/s
//   FIN    : 400 * 0.07 =  28.0 req/s ;  28.0 / 14 =  2.00 ->  2 journeys/s
//   CMT    : 400 * 0.07 =  28.0 req/s ;  28.0 / 8  =  3.50 ->  4 journeys/s
// CMT's journey rate is taken out of G0's slice below (G0 87 -> 83) so the basket
// total stays unchanged, exactly as load.js / soak.js do it. At the 400 ceiling
// the per-journey floors are no longer skewing the mix (CON-G2/FIN/CMT all clear
// 1 j/s comfortably), so realized total tracks the weighted 400 closely.
// ---------------------------------------------------------------------------

// Peak total HTTP req/s — the 400 ceiling this stress test is built to drive.
const RPS = Number(__ENV.RPS) || 400;        // peak (step 3) total HTTP req/s
const STEP1_RPS = Number(__ENV.STEP1_RPS) || 150;  // step 1 — normal load level
const STEP2_RPS = Number(__ENV.STEP2_RPS) || 250;  // step 2 — past normal, below peak

// Phase durations (env tunable). RAMP is the time spent climbing between steps;
// STEP_HOLD is how long each intermediate step holds; PEAK_HOLD is the short
// hold at the 400 ceiling; COOLDOWN ramps back to 0.
const RAMP = __ENV.RAMP || '1m';
const STEP_HOLD = __ENV.STEP_HOLD || '10m';
const PEAK_HOLD = __ENV.PEAK_HOLD || '10m';
const COOLDOWN = __ENV.COOLDOWN || '3m';

// Module weights (share of total HTTP requests) and real requests-per-journey —
// identical to load.js / soak.js so a stress run is directly comparable. G3 is
// parked pending acc-service routing; its 0.07 slice was dropped and the rest
// renormalized to 1.0. CMT is wired at FIN's floor weight (0.07).
const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmt: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmt: 8 };

// journeyRate(module, totalRps): convert this module's request-share at the
// given total req/s into a journey/s target rate, never rounding to 0.
function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

// Per-module journey rates at each of the three steps. G0 absorbs CMT's journey
// rate at every step so the per-step basket total stays unchanged, exactly as
// load.js / soak.js do it.
const REG_S1 = journeyRate('reg', STEP1_RPS);
const REG_S2 = journeyRate('reg', STEP2_RPS);
const REG_PEAK = journeyRate('reg', RPS);
const CONG2_S1 = journeyRate('cong2', STEP1_RPS);
const CONG2_S2 = journeyRate('cong2', STEP2_RPS);
const CONG2_PEAK = journeyRate('cong2', RPS);
const FIN_S1 = journeyRate('fin', STEP1_RPS);
const FIN_S2 = journeyRate('fin', STEP2_RPS);
const FIN_PEAK = journeyRate('fin', RPS);
const CMT_S1 = journeyRate('cmt', STEP1_RPS);
const CMT_S2 = journeyRate('cmt', STEP2_RPS);
const CMT_PEAK = journeyRate('cmt', RPS);
const G0_S1 = journeyRate('g0', STEP1_RPS) - CMT_S1;
const G0_S2 = journeyRate('g0', STEP2_RPS) - CMT_S2;
const G0_PEAK = journeyRate('g0', RPS) - CMT_PEAK;

// ---------------------------------------------------------------------------
// Scenario functions. Each reads its token off the setup() return passed in as
// `data` (same access pattern as load.js / soak.js / smoke). G0 reuses regToken.
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

export function cmtScenario(data) {
  cmtFlow(data.cmtToken, config);
}

// ---------------------------------------------------------------------------
// Options — TLS spread first, then one ramping-arrival-rate scenario per module.
// Common stepped-ramp shape per scenario (one continuous run):
//   ramp 0 -> step1 over RAMP, hold step1 STEP_HOLD,
//   ramp step1 -> step2 over RAMP, hold step2 STEP_HOLD,
//   ramp step2 -> peak over RAMP, hold peak PEAK_HOLD, ramp -> 0 over COOLDOWN.
// startRate 0, timeUnit 1s. preAllocatedVUs/maxVUs mirror load.js / soak.js's
// generous ceilings. These ceilings were ORIGINALLY sized for a 400 rps tier, so
// they are correctly sized for this stress test's 400 peak — VUs should not be
// the bottleneck (we want to find the SERVER's ceiling, not the generator's).
// Under stress, per-journey latency rises, and a rising per-journey duration
// means each journey/s needs MORE concurrent VUs — the headroom keeps the
// offered rate honest right up to the breaking point.
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
        { target: G0_S1, duration: RAMP },
        { target: G0_S1, duration: STEP_HOLD },
        { target: G0_S2, duration: RAMP },
        { target: G0_S2, duration: STEP_HOLD },
        { target: G0_PEAK, duration: RAMP },
        { target: G0_PEAK, duration: PEAK_HOLD },
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
        { target: REG_S1, duration: RAMP },
        { target: REG_S1, duration: STEP_HOLD },
        { target: REG_S2, duration: RAMP },
        { target: REG_S2, duration: STEP_HOLD },
        { target: REG_PEAK, duration: RAMP },
        { target: REG_PEAK, duration: PEAK_HOLD },
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
        { target: CONG2_S1, duration: RAMP },
        { target: CONG2_S1, duration: STEP_HOLD },
        { target: CONG2_S2, duration: RAMP },
        { target: CONG2_S2, duration: STEP_HOLD },
        { target: CONG2_PEAK, duration: RAMP },
        { target: CONG2_PEAK, duration: PEAK_HOLD },
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
        { target: FIN_S1, duration: RAMP },
        { target: FIN_S1, duration: STEP_HOLD },
        { target: FIN_S2, duration: RAMP },
        { target: FIN_S2, duration: STEP_HOLD },
        { target: FIN_PEAK, duration: RAMP },
        { target: FIN_PEAK, duration: PEAK_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
    cmt: {
      executor: 'ramping-arrival-rate',
      exec: 'cmtScenario',
      startRate: 0,
      timeUnit: '1s',
      // CMT's read journey runs 8 search/detail steps with a sleep between
      // most, so each iteration runs several seconds. Even at the floored
      // journey rate many iterations overlap, so it needs a FIN-class ceiling.
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: CMT_S1, duration: RAMP },
        { target: CMT_S1, duration: STEP_HOLD },
        { target: CMT_S2, duration: RAMP },
        { target: CMT_S2, duration: STEP_HOLD },
        { target: CMT_PEAK, duration: RAMP },
        { target: CMT_PEAK, duration: PEAK_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
  },
  thresholds: {
    // SAME acceptance gates as load.js / soak.js so a stress run is directly
    // comparable and the summary still shows pass/fail markers — but every gate
    // is NON-ABORTING (abortOnFail:false). A stress test must run to completion
    // past the SLOs so we can read WHERE the ceiling is; we do not let k6 bail
    // the instant a gate trips. The markers tell us at which step each SLO broke.
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    // Error rate < 0.5% (the stakeholder acceptance criterion). Same strict gate
    // soak.js carries; non-aborting here so a burst of errors at peak does not
    // kill the run before we see the failure mode.
    http_req_failed: [{ threshold: 'rate<0.005', abortOnFail: false }],
    // Auth p95 < 2s — auth requests are tagged `auth:<LABEL>` in auth.js, so the
    // sub-metric below gates the token endpoint specifically.
    'http_req_duration{name:auth:REG}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:CON-G2}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:FIN}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:CMT}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    // Per-module visibility (same per-domain metrics as load.js / soak.js).
    reg_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    cong2_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    g0_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    fin_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    cmt_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
  },
};

// ---------------------------------------------------------------------------
// setup() — authenticate ONCE, cache tokens, hand them to every scenario as
// the `data` arg (same as load.js / soak.js / smoke). G0 reuses regToken. Tokens
// are requested at the 6h max TTL (auth.js) so they survive the full ramp.
// ---------------------------------------------------------------------------
export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  const cmtToken = authenticate(config.CMT_USER, config.CMT_PASS, 'CMT', config);
  return { regToken, conG2Token, finToken, cmtToken };
}
