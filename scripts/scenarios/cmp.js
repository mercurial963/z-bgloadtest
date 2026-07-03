import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

const cmpDuration = new Trend('cmp_req_duration', true);

const cmpAccidentCodes = new SharedArray('cmpAccidentCodes', () =>
  JSON.parse(open('../data/cmp-accident-codes.json'))
);

export function cmpFlow(token, config) {
  const HOST = config.HOST;
  group('CMP', function () {
    const { postStep, getStep } = makeSteps({
      token,
      label: 'CMP',
      tagPrefix: 'CMP',
      host: HOST,
      trend: cmpDuration,
    });

    const inv = postStep(1, '/cmp/investigate/searchInvestigate', {
      operation: 'AND',
      pagination: {
        pageNumber: 0,
        pageSize: 10,
        orders: [{ direction: 'ASC', property: 'string' }],
      },
      condition: {
        searchFrom: '2',
        searchId: '12006800012',
      },
    });
    const invRec = inv.status === 200 ? firstRecord(inv.json()) : null;
    const accidentIssueId = pickOrWarn(
      invRec,
      ['accidentIssueId', 'id'],
      'CMP step 2 investigate/searchInvestigateById (accidentIssueId)'
    );

    if (!accidentIssueId) {
      console.warn(
        '[CMP] step 1 searchInvestigate empty — skipping step 2 searchInvestigateById.'
      );
    } else {
      sleep(1);
      getStep(
        2,
        `/cmp/investigate/searchInvestigateById?accidentIssueId=${accidentIssueId}`,
        'investigate/searchInvestigateById'
      );
    }

    sleep(1);
    postStep(3, '/cmp/compensation/searchRequestStatus', {
      operation: 'AND',
      pagination: {
        pageNumber: 0,
        pageSize: 10,
        orders: [{ direction: 'ASC', property: 'string' }],
      },
      condition: {
        searchFrom: '2',
        accidentIssueType: '1',
        searchId: '12006800176',
      },
    });

    sleep(1);
    postStep(4, '/cmp/compensation/searchBeneficiary', {
      operation: 'AND',
      pagination: {
        pageNumber: 0,
        pageSize: 10,
        orders: [{ direction: 'ASC', property: 'string' }],
      },
      condition: {
        searchFrom: '2',
        accidentIssueCode: '12006800585',
      },
    });

    sleep(1);
    postStep(5, '/cmp/compensation/searchWageRate', {
      operation: 'AND',
      pagination: {
        pageNumber: 0,
        pageSize: 10,
        orders: [{ direction: 'DESC', property: 'string' }],
      },
      condition: {
        accidentIssueCode: '12006800003',
      },
    });

    sleep(1);
    const pay = postStep(6, '/cmp/payment/searchPayment', {
      operation: 'OR',
      pagination: {
        pageNumber: 0,
        pageSize: 10,
        orders: [{ direction: 'DESC', property: 'string' }],
      },
      condition: {
        searchFrom: 1,
        searchId: '12006900158',
        isMylist: false,
      },
    });
    const payRec = pay.status === 200 ? firstRecord(pay.json()) : null;
    const paymentId = pickOrWarn(
      payRec,
      ['paymentId', 'id'],
      'CMP step 7 payment/searchPaymentDetailById (paymentId)'
    );

    if (!paymentId) {
      console.warn(
        '[CMP] step 6 searchPayment empty — skipping step 7 searchPaymentDetailById.'
      );
    } else {
      sleep(1);
      getStep(
        7,
        `/cmp/payment/searchPaymentDetailById?paymentId=${paymentId}`,
        'payment/searchPaymentDetailById'
      );
    }

    const cmpAccidentCode =
      cmpAccidentCodes[exec.scenario.iterationInTest % cmpAccidentCodes.length];
  });
}
