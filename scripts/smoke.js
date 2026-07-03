import { config, tlsOptions } from './lib/config.js';
import { sleep } from 'k6';
import { authenticate } from './lib/auth.js';
import { regFlow } from './scenarios/reg.js';
import { conG2Flow } from './scenarios/cong2.js';
import { g0Flow } from './scenarios/g0.js';
import { finFlow } from './scenarios/fin.js';
import { cmpFlow } from './scenarios/cmp.js';

export const options = {
  ...tlsOptions,
  vus: config.VUS,
  iterations: config.ITERATIONS,
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

export default function (data) {
  regFlow(data.regToken, config);
  sleep(1);
  conG2Flow(data.conG2Token, config);
  sleep(1);
  g0Flow(data.regToken, config);
  sleep(1);
  finFlow(data.finToken, config);
  sleep(1);
  cmpFlow(data.cmpToken, config);
  sleep(1);
}
