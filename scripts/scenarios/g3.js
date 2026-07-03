import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

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

    if (!apId) {
      console.warn('[G3] step 1 account-profile search empty — skipping steps 2-3.');
    } else {
      sleep(1);
      getStep(2, `/acc/api/account-profile/${apId}`, 'account-profile/{id} (detail)');
      sleep(1);
      getStep(3, `/acc/api/account-profile/${apId}/history`, 'account-profile/{id}/history');
    }

    sleep(1);
    getStep(4, '/acc/api/account-profile/parents', 'account-profile/parents');

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

    if (!accountItemId) {
      console.warn('[G3] step 5 account-item search empty — skipping steps 6-8.');
    } else {
      sleep(1);
      getStep(6, `/acc/api/account-item/${accountItemId}`, 'account-item/{id} (detail)');
      sleep(1);
      getStep(7, `/acc/api/account-item/${accountItemId}/history`, 'account-item/{id}/history');
      sleep(1);
      getStep(8, `/acc/api/account-item/${accountItemId}/1000`, 'account-item/{id}/{ssoCode}');
    }

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
    sleep(1);
    getStep(11, '/acc/api/remain-balance/passbook-history/24367009', 'remain-balance/passbook-history/{id}');

    sleep(1);
    const tc = getStep(
      12,
      '/acc/api/sso-bank-transfer-central?jobCode=&createdDate=&status=&page=0&size=20&sort=ASC',
      'sso-bank-transfer-central (list)'
    );
    const tcRec = tc.status === 200 ? firstRecord(tc.json()) : null;
    const jobCode = pick(tcRec, ['jobCode', 'id']) || '1000AC250327B01';
    sleep(1);
    getStep(
      13,
      `/acc/api/sso-bank-transfer-central/${jobCode}/detail`,
      'sso-bank-transfer-central/{jobCode}/detail'
    );

    sleep(1);
    const il = getStep(
      14,
      '/acc/api/item-ledger?ssoBranchCode=1000&transactionDateFrom=&transactionDateTo=&accountLedgerType=&accountDocumentCode=&itemLedgerStatus=&accountFiPeriod=&accountFiYear=2569&createdDate=&page=0&size=20&sort=ASC',
      'item-ledger (search)'
    );
    const ilRec = il.status === 200 ? firstRecord(il.json()) : null;
    const accountLedgerId = pick(ilRec, ['accountLedgerId', 'id']) || '9103735';
    sleep(1);
    getStep(15, `/acc/api/item-ledger/${accountLedgerId}`, 'item-ledger/{id} (detail)');

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

    sleep(1);
    getStep(
      20,
      '/acc/api/inquiry-general-ledger?accountProfileId=11210600&fiYear=2567&month=JANUARY&ssoCode=1000&reportFlag=EXCEL&download=false',
      'inquiry-general-ledger'
    );
    sleep(1);
    getStep(21, '/acc/api/account-type', 'account-type');

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
