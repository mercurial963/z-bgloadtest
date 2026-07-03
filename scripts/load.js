import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';
import { finFlow } from './scenarios/fin.js';
import { cmpFlow } from './scenarios/cmp.js';

const LOW_RPS = Number(__ENV.LOW_RPS) || 100;
const HIGH_RPS = Number(__ENV.HIGH_RPS) || 150;

const WARMUP_HOLD = __ENV.WARMUP_HOLD || '3m';
const LOAD_HOLD = __ENV.LOAD_HOLD || '30m';
const COOLDOWN = __ENV.COOLDOWN || '3m';

const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmp: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmp: 7 };

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
const G0_WARM = journeyRate('g0', LOW_RPS) - CMP_WARM;
const G0_LOAD = journeyRate('g0', HIGH_RPS) - CMP_LOAD;

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
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.01'],
    reg_req_duration: ['p(95)<3000'],
    cong2_req_duration: ['p(95)<3000'],
    g0_req_duration: ['p(95)<3000'],
    fin_req_duration: ['p(95)<3000'],
    cmp_req_duration: ['p(95)<3000'],
  },
};

export function setup() {
  const regToken = authenticate(config.REG_USER, config.REG_PASS, 'REG', config);
  const conG2Token = authenticate(config.CONG2_USER, config.CONG2_PASS, 'CON-G2', config);
  const finToken = authenticate(config.FIN_USER, config.FIN_PASS, 'FIN', config);
  const cmpToken = authenticate(config.CMP_USER, config.CMP_PASS, 'CMP', config);
  return { regToken, conG2Token, finToken, cmpToken };
}
