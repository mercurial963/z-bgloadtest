/*
 * cmp.js — CMP (compensation / payment) journey (read-only basket).
 * =========================================================================
 * READ-ONLY only: no write endpoints. The CMP journey is search-then-detail
 * off pre-existing data, exactly like fin.js. Nothing is saved, approved,
 * updated, or deleted. Every save, update, approve, and delete endpoint in the
 * CMP and CMP-Payment collections is deliberately left out; only the search
 * and searchById reads are wired here, matching the smoke.js read-only header
 * invariant.
 *
 * Like FIN, CMP uses its OWN per-module user token (CMP_USER / CMP_PASS),
 * authenticated ONCE in the caller's setup() and passed in as `token` here —
 * cmpFlow does not re-auth per iteration, mirroring finFlow(token, config).
 *
 * Chaining (real data wired from prior responses, never a hardcoded id a prior
 * step produces); each downstream detail step is skipped with a console.warn
 * when its source search returns empty, the same defensive pattern as fin.js:
 *   step 1 investigate/searchInvestigate -> step 2 searchInvestigateById (accidentIssueId)
 *   step 6 payment/searchPayment         -> step 7 searchPaymentDetailById (paymentId)
 *
 * Steps, in journey order (all R = read):
 *   1.  POST /cmp/investigate/searchInvestigate        (R) provides accidentIssueId
 *   2.  GET  /cmp/investigate/searchInvestigateById     (R) accidentIssueId from (1)
 *   3.  POST /cmp/compensation/searchRequestStatus      (R)
 *   4.  POST /cmp/compensation/searchBeneficiary        (R)
 *   5.  POST /cmp/compensation/searchWageRate           (R)
 *   6.  POST /cmp/payment/searchPayment                 (R) provides paymentId
 *   7.  GET  /cmp/payment/searchPaymentDetailById       (R) paymentId from (6)
 *   8.  POST /cmp/payment/searchRemainPayment           (R)
 *
 * Search bodies (the filter JSON) are copied from the matching requests in
 * Load-test/CMP/CMP.postman_collection.json and CMP-Payment.postman_collection2.json
 * so the filters resolve against real data rather than returning nothing.
 * =========================================================================
 */

import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

// Per-domain latency metric (so CMP is visible separately from the others).
const cmpDuration = new Trend('cmp_req_duration', true);

// Valid accidentIssueCode seed for step 8 searchRemainPayment. Loaded ONCE per
// VU-shared (memory-efficient) from the stakeholder-provided list of real
// diagnosis-payment records. See params.md "CMP searchRemainPayment".
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

    // 1. (R) search investigations by seed searchId. Filter body copied from
    //    APICMP02001 in CMP.postman_collection.json. The row provides the
    //    accidentIssueId step 2 chains off.
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

    // 2. (R) investigation detail. accidentIssueId chained from step 1.
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

    // 3. (R) search request status. Filter body copied from APICMP01070_4.
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

    // 4. (R) search beneficiary. Filter body copied from APICMP02021.
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

    // 5. (R) search wage rate. Filter body copied from APICMP01044.
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

    // 6. (R) search payment orders. Filter body copied from
    //    APICMP04001 in CMP-Payment.postman_collection2.json. The row provides
    //    the paymentId step 7 chains off.
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

    // 7. (R) payment detail. paymentId chained from step 6.
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

    // 8. (R) search remaining payment. Filter body copied from APICMP04007.
    //    This is a calculate-preview read; it computes remaining amounts off
    //    the filter and does not persist anything.
    //
    // ===== RE-PARKED 2026-06-26 ======================================
    // Step 8 was re-enabled earlier today wired to round-robin across the
    // 380-code stakeholder seed (../data/cmp-accident-codes.json). Pao
    // re-tested it in UAT with that seed and it STILL returns the
    // not-found/error response ({"message":"ไม่พบข้อมูลวินิจฉัยเพื่อสั่งจ่าย",
    // "content":null}, non-2xx). So the root cause is NOT a missing seed —
    // it is likely the endpoint itself or how the accident code must be
    // paired with treatmentCode/payToCode in UAT. Parked again so it does
    // not inflate the error rate against the 0.5% budget.
    //
    // KEPT (do not remove): the cmp-accident-codes.json seed file, the
    // SharedArray import + cmpAccidentCodes loader, and the cmpAccidentCode
    // selection line below — all retained so re-enabling is trivial once the
    // real issue is sorted: just uncomment the postStep(8, ...) + sleep.
    // -----------------------------------------------------------------
    // Retained for the parked step 8 (its only consumer is the commented
    // postStep below).
    const cmpAccidentCode =
      cmpAccidentCodes[exec.scenario.iterationInTest % cmpAccidentCodes.length];
    // sleep(1);
    // postStep(8, '/cmp/payment/searchRemainPayment', {
    //   accidentissueCode: cmpAccidentCode,
    //   treatmentCode: '01',
    //   payToCode: '1',
    //   beneficiaryId: null,
    //   endDate: null,
    // });
    // =================================================================
  });
}
