import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

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

    if (!t1Id) {
      console.warn('[CON-G2] step 1 (tab1) empty — skipping step 2 detail.');
    } else {
      sleep(1);
      getStep(2, `/coninvoice/pay-instalment-requests/${t1Id}`, 'pay-instalment-requests/{id}');
    }

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

    if (!t2Id) {
      console.warn('[CON-G2] step 3 (tab2) empty — skipping step 4 detail.');
    } else {
      sleep(1);
      getStep(4, `/coninvoice/pay-instalment-requests/${t2Id}`, 'pay-instalment-requests/{id} (tab2)');
    }

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

    sleep(1);
    getStep(
      7,
      `/coninvoice/invoice/year/check/balance/amount?accountBranch=&accountNo=${encodeURIComponent(
        config.CONG2_DEPOSIT_ACCOUNT_NO
      )}`,
      'balance/amount (deposit)'
    );

    sleep(1);
    getStep(
      8,
      `/coninvoice/invoice/year/check/balance/amount?accountNo=${encodeURIComponent(
        config.CONG2_PERIOD_ACCOUNT_NO
      )}&accountBranch=`,
      'balance/amount (period)'
    );

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
