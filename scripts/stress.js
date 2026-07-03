import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';
import { finFlow } from './scenarios/fin.js';
import { cmpFlow } from './scenarios/cmp.js';

const RPS = Number(__ENV.RPS) || 400;
const STEP1_RPS = Number(__ENV.STEP1_RPS) || 150;
const STEP2_RPS = Number(__ENV.STEP2_RPS) || 250;

const RAMP = __ENV.RAMP || '1m';
const STEP_HOLD = __ENV.STEP_HOLD || '10m';
const PEAK_HOLD = __ENV.PEAK_HOLD || '10m';
const COOLDOWN = __ENV.COOLDOWN || '3m';

const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmp: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmp: 8 };

function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

const REG_S1 = journeyRate('reg', STEP1_RPS);
const REG_S2 = journeyRate('reg', STEP2_RPS);
const REG_PEAK = journeyRate('reg', RPS);
const CONG2_S1 = journeyRate('cong2', STEP1_RPS);
const CONG2_S2 = journeyRate('cong2', STEP2_RPS);
const CONG2_PEAK = journeyRate('cong2', RPS);
const FIN_S1 = journeyRate('fin', STEP1_RPS);
const FIN_S2 = journeyRate('fin', STEP2_RPS);
const FIN_PEAK = journeyRate('fin', RPS);
const CMP_S1 = journeyRate('cmp', STEP1_RPS);
const CMP_S2 = journeyRate('cmp', STEP2_RPS);
const CMP_PEAK = journeyRate('cmp', RPS);
const G0_S1 = journeyRate('g0', STEP1_RPS) - CMP_S1;
const G0_S2 = journeyRate('g0', STEP2_RPS) - CMP_S2;
const G0_PEAK = journeyRate('g0', RPS) - CMP_PEAK;

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
    cmp: {
      executor: 'ramping-arrival-rate',
      exec: 'cmpScenario',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 150,
      stages: [
        { target: CMP_S1, duration: RAMP },
        { target: CMP_S1, duration: STEP_HOLD },
        { target: CMP_S2, duration: RAMP },
        { target: CMP_S2, duration: STEP_HOLD },
        { target: CMP_PEAK, duration: RAMP },
        { target: CMP_PEAK, duration: PEAK_HOLD },
        { target: 0, duration: COOLDOWN },
      ],
    },
  },
  thresholds: {
    http_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    http_req_failed: [{ threshold: 'rate<0.005', abortOnFail: false }],
    'http_req_duration{name:auth:REG}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:CON-G2}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:FIN}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    'http_req_duration{name:auth:CMP}': [{ threshold: 'p(95)<2000', abortOnFail: false }],
    reg_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    cong2_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    g0_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    fin_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    cmp_req_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
  },
};

export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  const cmpToken = authenticate(config.CMP_USER, config.CMP_PASS, 'CMP', config);
  return { regToken, conG2Token, finToken, cmpToken };
}
