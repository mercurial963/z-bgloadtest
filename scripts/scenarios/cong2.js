/*
 * cong2.js — CON-G2 contribution / invoice journey (15th-of-month employer view).
 * =========================================================================
 * Walks the contribution half of WCF2-G2-Loadtest.postman_collection-v2.json in
 * the order its requests appear (stakeholder confirmed the collection is already
 * in execution order). The เร่งรัดหนี้ (debt-tracking) half of the collection has
 * been DROPPED per Pao's decision — only the "check what's owed, see the
 * invoice/balance" contribution journey remains.
 *
 * READ-ONLY only: every write/approve/init/save/generate-pdf/print/download/
 * update request is SKIPPED (noted inline). Where the collection hardcodes a
 * record id that a list step just produced, the id is chained from that list
 * response; dependent steps are skipped with a console.warn when the list is
 * empty.
 *
 * Account-scoped balance/check params: several steps key off a hardcoded
 * accountNo that NO prior list in the kept set produces, so they cannot be
 * chained — they stay as the collection's literal values (the annual balance
 * pair is env-overridable). These are flagged in the deliverable, not silently
 * trusted. They are filters/lookups, not record ids stitched from a response.
 *
 * Implemented (read-only) steps, in collection order:
 *   1.  POST pay-instalment-requests/list        (tab1: wait to approve)
 *   2.  GET  pay-instalment-requests/{id}         id chained from (1)
 *   3.  POST pay-instalment-requests/list         (tab2: all)
 *   4.  GET  pay-instalment-requests/{id}         id chained from (3)
 *   5.  GET  invoice/year/check/balance/amount    (annual, accountNo env)
 *   6.  GET  invoice/year/select                  (annual, accountNo env)
 *   7.  GET  invoice/year/check/balance/amount    (deposit)
 *   8.  GET  invoice/year/check/balance/amount    (period)
 *   9.  POST invoices/hire-report/list
 *   10. GET  invoices/hire-report/report/{id}     reportId chained from (9)
 *   11. GET  invoices/hire-report/create-invoice-init?hireReportId={id} chained
 *   12. POST invoices/contribution-audits/list
 *   13. GET  invoice/year/check/balance/amount    (audit)
 *   14. GET  invoices/contribution-audits/{id}    invoiceId chained from (12)
 *   15. POST invoices/retroactive-records/check-invoice  (read-only check)
 *   16. GET  invoice/year/check/balance/amount    (retro)
 *   17. GET  invoice/year/select                  (retro)
 *   18. POST invoice/askContribute/list
 *   19. GET  invoice/askContribute/select         invoiceId chained from (18)
 *
 * SKIPPED (writes / side-effecting), in collection order:
 *   - invoices/deposit/init (POST)        + .../{id}/generate-pdf (POST)
 *   - invoices/period/init (POST)         + .../{id}/generate-pdf (POST)
 *   - invoices/hire-report/create-invoice (POST) + .../{id}/generate-pdf (POST)
 *     and invoices/hire-report/invoice/{id} (GET) — depends on a created invoice
 *   - invoices/contribution-audits save (POST) + .../{id}/generate-pdf (POST)
 *
 * DROPPED (entire เร่งรัดหนี้ / debt-tracking half — old steps 20-35):
 *   debt-tracking/invoice/list, debt-tracking/company, debt-tracking/status,
 *   debt/company-assay, debt/alert-doc, debt/wait-write-off, debt/bankrupt,
 *   con-debt/no-dun-debt, debt/alert-doc-all, debt/document, debt/by-phone,
 *   debt/invite-doc, debt-tracking/company/calculated-*, lastest-tracking, and
 *   all their logs/{id}, print-logs/{id}, select, generate-pdf, update siblings.
 * =========================================================================
 */

import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

// Per-domain latency metric (so REG vs CON-G2 are visible separately).
const conG2Duration = new Trend('cong2_req_duration', true);

export function conG2Flow(token, config) {
  const HOST = config.HOST;
  group('CON-G2', function () {
    const { postStep, getStep } = makeSteps({
      token,
      label: 'CON-G2',
      tagPrefix: 'CON-G2',
      host: HOST,
      trend: conG2Duration,
    });

    // 1. pay-instalment requests, tab1 "wait to approve"
    const t1 = postStep(1, '/coninvoice/pay-instalment-requests/list', {
      currentTab: 'wait to approve',
      operation: 'AND',
      pagination: { pageNumber: 0, pageSize: 50 },
      approveStatus: 'N',
      approvalStatus: 'N',
    });
    const t1Rec = t1.status === 200 ? firstRecord(t1.json()) : null;
    const t1Id = pickOrWarn(
      t1Rec,
      ['instalmentsReqId', 'id', 'payInstalmentRequestId', 'requestId'],
      'CON-G2 step 2 pay-instalment-requests/{id} (tab1 id)'
    );

    // 2. detail of a tab1 row (id chained from step 1)
    if (!t1Id) {
      console.warn('[CON-G2] step 1 (tab1) empty — skipping step 2 detail.');
    } else {
      sleep(1);
      getStep(2, `/coninvoice/pay-instalment-requests/${t1Id}`, 'pay-instalment-requests/{id}');
    }

    // 3. pay-instalment requests, tab2 "all"
    sleep(1);
    const t2 = postStep(3, '/coninvoice/pay-instalment-requests/list', {
      currentTab: 'all',
      operation: 'AND',
      pagination: { pageNumber: 0, pageSize: 100 },
    });
    const t2Rec = t2.status === 200 ? firstRecord(t2.json()) : null;
    const t2Id = pickOrWarn(
      t2Rec,
      ['instalmentsReqId', 'id', 'payInstalmentRequestId', 'requestId'],
      'CON-G2 step 4 pay-instalment-requests/{id} (tab2 id)'
    );

    // 4. detail of a tab2 row (id chained from step 3)
    if (!t2Id) {
      console.warn('[CON-G2] step 3 (tab2) empty — skipping step 4 detail.');
    } else {
      sleep(1);
      getStep(4, `/coninvoice/pay-instalment-requests/${t2Id}`, 'pay-instalment-requests/{id} (tab2)');
    }

    // 5-6. ออกใบเงินสมทบประจำปี (annual). accountNo env-overridable for headline.
    //      SKIPPED: none (group is read-only).
    sleep(1);
    getStep(
      5,
      `/coninvoice/invoice/year/check/balance/amount?accountNo=${encodeURIComponent(
        config.CONG2_BALANCE_ACCOUNT_NO
      )}&accountBranch=${encodeURIComponent(config.CONG2_BALANCE_ACCOUNT_BRANCH)}`,
      'balance/amount (annual)'
    );
    sleep(1);
    getStep(
      6,
      `/coninvoice/invoice/year/select?accountNo=${encodeURIComponent(
        config.CONG2_BALANCE_ACCOUNT_NO
      )}&accountBranch=${encodeURIComponent(config.CONG2_BALANCE_ACCOUNT_BRANCH)}&year=2568`,
      'invoice/year/select (annual)'
    );

    // 7. ออกใบแจ้งประเมินเงินฝาก — read-only balance only.
    //    SKIPPED: invoices/deposit/init (POST), deposit/{id}/generate-pdf (POST).
    sleep(1);
    getStep(
      7,
      `/coninvoice/invoice/year/check/balance/amount?accountBranch=&accountNo=${encodeURIComponent(
        config.CONG2_DEPOSIT_ACCOUNT_NO
      )}`,
      'balance/amount (deposit)'
    );

    // 8. ออกใบแจ้งเงินสมทบประจำงวด — read-only balance only.
    //    SKIPPED: invoices/period/init (POST), period/{id}/generate-pdf (POST).
    sleep(1);
    getStep(
      8,
      `/coninvoice/invoice/year/check/balance/amount?accountNo=${encodeURIComponent(
        config.CONG2_PERIOD_ACCOUNT_NO
      )}&accountBranch=`,
      'balance/amount (period)'
    );

    // 9-11. บันทึกแบบแสดงค่าจ้าง — list -> report -> create-invoice-init (all GET/list).
    //    SKIPPED: hire-report/create-invoice (POST), generate-pdf (POST), and
    //    invoices/hire-report/invoice/{id} (GET, depends on a created invoice).
    sleep(1);
    const hr = postStep(9, '/coninvoice/invoices/hire-report/list', {
      accountNoBegins: '',
      accountNoEnd: '',
      ssoBranchCode: '',
      accountBranch: '',
      year: '2568',
      pagination: { pageNumber: 0, pageSize: 10 },
    });
    const hrRec = hr.status === 200 ? firstRecord(hr.json()) : null;
    const hireReportId = pickOrWarn(
      hrRec,
      ['hireReportId', 'id', 'invoiceId'],
      'CON-G2 steps 10-11 hire-report/{id} (hireReportId)'
    );
    if (!hireReportId) {
      console.warn('[CON-G2] step 9 hire-report/list empty — skipping steps 10-11.');
    } else {
      sleep(1);
      getStep(10, `/coninvoice/invoices/hire-report/report/${hireReportId}`, 'hire-report/report/{id}');
      sleep(1);
      getStep(
        11,
        `/coninvoice/invoices/hire-report/create-invoice-init?hireReportId=${hireReportId}`,
        'hire-report/create-invoice-init'
      );
    }

    // 12-14. ออกใบแจ้งจากตรวจสอบบัญชี — list -> balance -> detail.
    //    SKIPPED: contribution-audits save (POST), generate-pdf (POST).
    sleep(1);
    const ca = postStep(12, '/coninvoice/invoices/contribution-audits/list', {
      beginAccountNo: '1170014259',
      pagination: { pageNumber: 0, pageSize: 10 },
    });
    const caRec = ca.status === 200 ? firstRecord(ca.json()) : null;
    const caId = pickOrWarn(
      caRec,
      ['companyAuditId', 'invoiceId', 'id'],
      'CON-G2 step 14 contribution-audits/{id} (companyAuditId)'
    );
    sleep(1);
    getStep(
      13,
      `/coninvoice/invoice/year/check/balance/amount?accountNo=${encodeURIComponent(
        config.CONG2_AUDIT_ACCOUNT_NO
      )}&accountBranch=000000`,
      'balance/amount (audit)'
    );
    if (!caId) {
      console.warn('[CON-G2] step 12 contribution-audits/list empty — skipping step 14 detail.');
    } else {
      sleep(1);
      getStep(14, `/coninvoice/invoices/contribution-audits/${caId}`, 'contribution-audits/{id}');
    }

    // 15-17. บันทึกย้อนหลัง — check-invoice (read) -> balance -> year/select.
    sleep(1);
    postStep(15, '/coninvoice/invoices/retroactive-records/check-invoice', {
      accountNo: config.CONG2_RETRO_ACCOUNT_NO,
      accountBranch: '000000',
      year: '2568',
      typeDocCode: '1',
    });
    sleep(1);
    getStep(
      16,
      `/coninvoice/invoice/year/check/balance/amount?accountNo=${encodeURIComponent(
        config.CONG2_RETRO_ACCOUNT_NO
      )}`,
      'balance/amount (retro)'
    );
    sleep(1);
    getStep(
      17,
      `/coninvoice/invoice/year/select?accountNo=${encodeURIComponent(
        config.CONG2_RETRO_ACCOUNT_NO
      )}&year=2568`,
      'invoice/year/select (retro)'
    );

    // 18-19. สอบถามข้อมูลงานสมทบ — askContribute list -> select.
    //    The collection hardcodes invoiceId/accountNo/accountBranch in select;
    //    chain them from the askContribute list row where available.
    sleep(1);
    const ac = postStep(18, '/coninvoice/invoice/askContribute/list', {
      pagination: { pageNumber: 0, pageSize: 10 },
      accountNo: config.CONG2_RETRO_ACCOUNT_NO,
      year: '2568',
      typeDocCode: '1',
    });
    const acRec = ac.status === 200 ? firstRecord(ac.json()) : null;
    const acInvoiceId = pickOrWarn(
      acRec,
      ['invoiceId', 'id'],
      'CON-G2 step 19 askContribute/select (invoiceId)'
    );
    const acAccountNo = pick(acRec, ['accountNo']) || '1000048101';
    const acBranch = pick(acRec, ['accountBranch', 'branchNo']) || '000000';
    if (!acInvoiceId) {
      console.warn('[CON-G2] step 18 askContribute/list empty — skipping step 19 select.');
    } else {
      sleep(1);
      getStep(
        19,
        `/coninvoice/invoice/askContribute/select?invoiceId=${acInvoiceId}&accountNo=${acAccountNo}&accountBranch=${acBranch}`,
        'askContribute/select'
      );
    }
  });
}
