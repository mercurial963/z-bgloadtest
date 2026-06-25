/*
 * g3.js — G3 (Accounting) journey (read-only basket from wcf-acc collection).
 * =========================================================================
 * Walks the read half of Load-test/G3/wcf-acc.postman_collection-v2.json. The
 * collection is organised by resource folder; where a folder numbers its
 * children ("1. ...", "2. ...") those numbers are the documented execution
 * order, and the Thai labels "(ใช้ id จากข้อ 1)" = "uses the id from step 1"
 * tell us which detail/history calls chain off the preceding search.
 *
 * READ-ONLY only: every real write is SKIPPED and left commented + labeled
 * below so the functional write-pass can pick them up later. Where the
 * collection hardcodes a record id that a search step produces, the id is
 * chained from that search response; dependent steps are skipped with a
 * console.warn when the search is empty.
 *
 * Implemented (read-only) steps, in journey order:
 *   account-profile (รหัสบัญชี)
 *     1.  GET  /account-profile?accountProfileCode=11100000   search; provides id
 *     2.  GET  /account-profile/{id}                          detail; id from (1)
 *     3.  GET  /account-profile/{id}/history                  history; id from (1)
 *     4.  GET  /account-profile/parents                       control-account list
 *   account-item (รหัสรายการ)
 *     5.  GET  /account-item?accountItemCode=ADJO&...          search; provides accountItemId
 *     6.  GET  /account-item/{accountItemId}                  detail; id from (5)
 *     7.  GET  /account-item/{accountItemId}/history          history; id from (5)
 *     8.  GET  /account-item/{accountItemId}/1000             sso pairing; id from (5)
 *   remain-balance (บัตรบัญชีนายจ้าง)
 *     9.  GET  /remain-balance/passbook?...                   passbook by accountNo
 *     10. GET  /remain-balance/passbook-list?...              passbook list
 *     11. GET  /remain-balance/passbook-history/{id}          passbook history (literal id)
 *   sso-bank-transfer-central (โอนเงินเข้าส่วนกลาง)
 *     12. GET  /sso-bank-transfer-central?...                 transfer list; provides jobCode
 *     13. GET  /sso-bank-transfer-central/{jobCode}/detail    detail; jobCode chained from (12)
 *   item-ledger (รายการประจำวัน)
 *     14. GET  /item-ledger?...                                search; provides accountLedgerId
 *     15. GET  /item-ledger/{accountLedgerId}                 detail; id chained from (14)
 *   account-closed (ปิดบัญชี)
 *     16. GET  /account-closed/sso-yearly?...                 yearly close docs
 *     17. GET  /account-closed/sso-monthly?...                monthly close (nationwide)
 *     18. GET  /account-closed/sso-monthly-history?...        close history
 *     19. GET  /account-closed?...                            close info
 *   ledger / masterdata
 *     20. GET  /inquiry-general-ledger?...                    general-ledger inquiry
 *     21. GET  /account-type                                  account categories
 *   report/* (รายงาน — read-only report-fetch POSTs, filter body in -> report out)
 *     22. POST /report/acc5059
 *     23. POST /report/acc5032
 *     24. POST /report/acc5031
 *     25. POST /report/acc5030
 *     26. POST /report/acc5031   (collection lists acc5031 twice; kept faithfully)
 *     27. POST /report/acc5029
 *     28. POST /report/acc5028
 *     29. POST /report/acc5022
 *     30. POST /report/acc5021
 *     31. POST /report/acc5020
 *     32. POST /report/acc5003
 *     33. POST /report/acc5001
 *
 * EXCLUDED (writes / off-limits) — see inline comments at the point each would
 * have run, plus the deliverable report. Summary:
 *   - PUT /account-profile/{id}          (แก้ไขข้อมูลรหัสบัญชี — update)
 *   - PUT /account-item/{accountItemId}  (แก้ไขรหัสรายการ — update)
 *   - POST /item-ledger                  (สร้างรายการประจำวัน — create)
 *   - GET /loadfile/accbk01-export-excel (Excel file download/export — flagged)
 * =========================================================================
 */

import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

// Per-domain latency metric (so G3 is visible separately from the others).
const g3Duration = new Trend('g3_req_duration', true);

export function g3Flow(token, config) {
  const HOST = config.HOST;
  group('G3', function () {
    const { postStep, getStep } = makeSteps({
      token,
      label: 'G3',
      tagPrefix: 'G3',
      host: HOST,
      trend: g3Duration,
    });

    // === account-profile (รหัสบัญชี) ===================================
    // 1. search account profiles by code (this is the folder's documented
    //    step "1."; it produces the id the detail/history steps chain off).
    const ap = getStep(
      1,
      '/acc/api/account-profile?accountProfileCode=11100000',
      'account-profile (search)'
    );
    const apRec = ap.status === 200 ? firstRecord(ap.json()) : null;
    const apId = pickOrWarn(
      apRec,
      ['accountProfileId', 'id', 'accountProfileCode'],
      'G3 steps 2-3 account-profile/{id}'
    );

    // WRITE — excluded from read-only load basket; belongs in the separate functional pass.
    // 2. PUT /account-profile/{id}  (แก้ไขข้อมูลรหัสบัญชี — updates the profile)

    // 2. account-profile detail (id chained from step 1)
    if (!apId) {
      console.warn('[G3] step 1 account-profile search empty — skipping steps 2-3.');
    } else {
      sleep(1);
      getStep(2, `/acc/api/account-profile/${apId}`, 'account-profile/{id} (detail)');
      // 3. account-profile edit history (id chained from step 1)
      sleep(1);
      getStep(3, `/acc/api/account-profile/${apId}/history`, 'account-profile/{id}/history');
    }

    // 4. control-account (บัญชีคุม) list — independent read.
    sleep(1);
    getStep(4, '/acc/api/account-profile/parents', 'account-profile/parents');

    // === account-item (รหัสรายการ) ====================================
    // 5. search account items by code ADJO (folder step "1."; provides the
    //    accountItemId that steps 6-8 chain off — "(ใช้ id จากข้อ 1)").
    sleep(1);
    const ai = getStep(
      5,
      '/acc/api/account-item?accountItemCode=ADJO&accountItemName=&accountLedgerType=&itemGroup=&page=0&size=20&sort=string&sort=ASC',
      'account-item (search ADJO)'
    );
    const aiRec = ai.status === 200 ? firstRecord(ai.json()) : null;
    const accountItemId = pickOrWarn(
      aiRec,
      ['accountItemId', 'id'],
      'G3 steps 6-8 account-item/{accountItemId}'
    );

    // WRITE — excluded from read-only load basket; belongs in the separate functional pass.
    // PUT /account-item/{accountItemId}  (แก้ไขรหัสรายการ — updates the item + its account relations)

    if (!accountItemId) {
      console.warn('[G3] step 5 account-item search empty — skipping steps 6-8.');
    } else {
      // 6. account-item detail (id from step 5)
      sleep(1);
      getStep(6, `/acc/api/account-item/${accountItemId}`, 'account-item/{id} (detail)');
      // 7. account-item edit history (id from step 5)
      sleep(1);
      getStep(7, `/acc/api/account-item/${accountItemId}/history`, 'account-item/{id}/history');
      // 8. account-item + contra pairing by สปส. branch 1000 (id from step 5)
      sleep(1);
      getStep(8, `/acc/api/account-item/${accountItemId}/1000`, 'account-item/{id}/{ssoCode}');
    }

    // === remain-balance (บัตรบัญชีนายจ้าง) ============================
    // Account-scoped passbook lookups. accountNo/accountBranch are the
    // collection's literal filter values — no prior kept step produces them,
    // so they stay literal (flagged in the deliverable), like CON-G2's
    // account-scoped balance calls.
    sleep(1);
    getStep(
      9,
      '/acc/api/remain-balance/passbook?accountBranch=000000&accountNo=1000244105&page=0&size=20&sort=ASC',
      'remain-balance/passbook'
    );
    sleep(1);
    getStep(
      10,
      '/acc/api/remain-balance/passbook-list?accountBranch=000000&accountNo=2000233104&yearCon=2&page=0&size=20',
      'remain-balance/passbook-list'
    );
    // 11. passbook history by literal passbookId (no kept list produces it).
    sleep(1);
    getStep(11, '/acc/api/remain-balance/passbook-history/24367009', 'remain-balance/passbook-history/{id}');

    // EXCLUDED (file export) — GET /loadfile/accbk01-export-excel?filename=...&jobCode=...
    // downloads a generated Excel artifact; kept out of the load basket and flagged.

    // === sso-bank-transfer-central (โอนเงินเข้าส่วนกลาง) ==============
    // 12. transfer list (provides jobCode for the detail call).
    sleep(1);
    const tc = getStep(
      12,
      '/acc/api/sso-bank-transfer-central?jobCode=&createdDate=&status=&page=0&size=20&sort=ASC',
      'sso-bank-transfer-central (list)'
    );
    const tcRec = tc.status === 200 ? firstRecord(tc.json()) : null;
    const jobCode = pick(tcRec, ['jobCode', 'id']) || '1000AC250327B01';
    // 13. transfer detail (jobCode chained from step 12; falls back to the
    //     collection's literal jobCode if the list yielded none).
    sleep(1);
    getStep(
      13,
      `/acc/api/sso-bank-transfer-central/${jobCode}/detail`,
      'sso-bank-transfer-central/{jobCode}/detail'
    );

    // === item-ledger (รายการประจำวัน) =================================
    // WRITE — excluded from read-only load basket; belongs in the separate functional pass.
    // POST /item-ledger  (สร้างรายการประจำวัน — creates a daily ledger entry)
    //
    // 14. search daily ledger entries (folder step "2."; provides accountLedgerId).
    sleep(1);
    const il = getStep(
      14,
      '/acc/api/item-ledger?ssoBranchCode=1000&transactionDateFrom=&transactionDateTo=&accountLedgerType=&accountDocumentCode=&itemLedgerStatus=&accountFiPeriod=&accountFiYear=2569&createdDate=&page=0&size=20&sort=ASC',
      'item-ledger (search)'
    );
    const ilRec = il.status === 200 ? firstRecord(il.json()) : null;
    const accountLedgerId = pick(ilRec, ['accountLedgerId', 'id']) || '9103735';
    // 15. ledger detail (id chained from step 14; falls back to collection literal).
    sleep(1);
    getStep(15, `/acc/api/item-ledger/${accountLedgerId}`, 'item-ledger/{id} (detail)');

    // === account-closed (ปิดบัญชี) ====================================
    sleep(1);
    getStep(16, '/acc/api/account-closed/sso-yearly?fiYear=2567&ssoBranchCode=1000', 'account-closed/sso-yearly');
    sleep(1);
    getStep(17, '/acc/api/account-closed/sso-monthly?fiYear=2567&monthDigit=01', 'account-closed/sso-monthly');
    sleep(1);
    getStep(
      18,
      '/acc/api/account-closed/sso-monthly-history?fiYear=2567&monthDigit=01&ssoBranchCode=1000',
      'account-closed/sso-monthly-history'
    );
    sleep(1);
    getStep(19, '/acc/api/account-closed?fiYear=2567&ssoBranchCode=1000', 'account-closed (info)');

    // === ledger inquiry + masterdata ==================================
    sleep(1);
    getStep(
      20,
      '/acc/api/inquiry-general-ledger?accountProfileId=11210600&fiYear=2567&month=JANUARY&ssoCode=1000&reportFlag=EXCEL&download=false',
      'inquiry-general-ledger'
    );
    sleep(1);
    getStep(21, '/acc/api/account-type', 'account-type');

    // === report/* (รายงาน) ===========================================
    // Read-only report-fetch POSTs: filter body in, report payload out (no
    // state mutation), same shape as CON-G2's /list POSTs. The collection's
    // literal filter bodies are kept verbatim.
    sleep(1);
    postStep(22, '/acc/api/report/acc5059', { ssoCode: '1000', reportFlag: 'PDF', download: true });
    sleep(1);
    postStep(23, '/acc/api/report/acc5032', {
      accountProfileId: 11210600,
      fiYear: 2567,
      month: 'JANUARY',
      ssoCode: '1000',
      reportFlag: 'PDF',
      download: true,
    });
    sleep(1);
    postStep(24, '/acc/api/report/acc5031', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: 'string',
      transactionDateFrom: '2023-01-01',
      transactionDateTo: '2023-01-01',
    });
    sleep(1);
    postStep(25, '/acc/api/report/acc5030', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: '1000',
      transactionDateFrom: '2023-01-01',
      transactionDateTo: '2023-01-01',
    });
    // Collection lists acc5031 a second time with a real ssoCode; kept faithfully.
    sleep(1);
    postStep(26, '/acc/api/report/acc5031', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: '1000',
      transactionDateFrom: '2023-01-01',
      transactionDateTo: '2023-01-01',
    });
    sleep(1);
    postStep(27, '/acc/api/report/acc5029', { accountLedgerId: 9463903, reportFlag: 'PDF', download: true });
    sleep(1);
    postStep(28, '/acc/api/report/acc5028', {
      accountBranch: '000000',
      companyAccountNo: '2000233104',
      yearCon: '2',
      reportFlag: 'PDF',
      download: true,
    });
    sleep(1);
    postStep(29, '/acc/api/report/acc5022', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: '1002',
      year: 2567,
      month: 'JANUARY',
      isAll: false,
      closeType: 'BEFORE_CLOSE',
    });
    sleep(1);
    postStep(30, '/acc/api/report/acc5021', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: '1002',
      year: 2567,
      month: 'JANUARY',
      isAll: false,
      isBeforeClose: 'Y',
    });
    sleep(1);
    postStep(31, '/acc/api/report/acc5020', {
      reportFlag: 'PDF',
      download: true,
      ssoCode: '1002',
      year: 2024,
      month: 'JANUARY',
      reportType: 'BEFORE',
      isAll: false,
    });
    sleep(1);
    postStep(32, '/acc/api/report/acc5003', {
      ssoCode: '3000',
      transactionDate: '2021-03-31',
      reportFlag: 'PDF',
      download: true,
    });
    sleep(1);
    postStep(33, '/acc/api/report/acc5001', {
      receiptDate: '2021-03-26',
      ssoCode: '1009',
      reportFlag: 'PDF',
      download: true,
    });
  });
}
