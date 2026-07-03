import { config, tlsOptions } from './lib/config.js';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';
import { finFlow } from './scenarios/fin.js';
import { cmpFlow } from './scenarios/cmp.js';

const RPS = Number(__ENV.RPS) || 150;

const WARMUP = __ENV.WARMUP || '1m';
const LOAD_HOLD = __ENV.LOAD_HOLD || '2h';
const COOLDOWN = __ENV.COOLDOWN || '5m';

const WEIGHTS = { g0: 0.65, reg: 0.18, cong2: 0.10, fin: 0.07, cmp: 0.07 };
const REQS_PER_JOURNEY = { g0: 3, reg: 6, cong2: 16, fin: 14, cmp: 8 };

function journeyRate(module, totalRps) {
  const requestShare = totalRps * WEIGHTS[module];
  return Math.max(1, Math.round(requestShare / REQS_PER_JOURNEY[module]));
}

const REG_RATE = journeyRate('reg', RPS);
const CONG2_RATE = journeyRate('cong2', RPS);
const FIN_RATE = journeyRate('fin', RPS);
const CMP_RATE = journeyRate('cmp', RPS);
const G0_RATE = journeyRate('g0', RPS) - CMP_RATE;

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
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.005'],
    'http_req_duration{name:auth:REG}': ['p(95)<2000'],
    'http_req_duration{name:auth:CON-G2}': ['p(95)<2000'],
    'http_req_duration{name:auth:FIN}': ['p(95)<2000'],
    'http_req_duration{name:auth:CMP}': ['p(95)<2000'],
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
