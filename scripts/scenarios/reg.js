import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn } from '../lib/http.js';

const regDuration = new Trend('reg_req_duration', true);

export function regFlow(token, config) {
  const HOST = config.HOST;
  group('REG', function () {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const listBody = JSON.stringify({
      pagination: {
        pageNumber: 1,
        pageSize: 20,
        orders: [{ direction: 'ASC', property: 'updatedDate' }],
      },
      accountNoLike: null,
      commercialIdLike: null,
      companyNameLike: null,
      ssoResponsibilityLike: '1001',
    });

    const listRes = http.post(`${HOST}/reg/company/list`, listBody, {
      headers,
      tags: { name: 'REG 1 /reg/company/list' },
    });
    regDuration.add(listRes.timings.duration);

    const listOk = check(listRes, {
      '[REG] 1 list status 200': (r) => r.status === 200,
      '[REG] 1 list valid JSON': (r) => r.json() !== null,
      '[REG] 1 list returned >=1 record': (r) => firstRecord(r.json()) !== null,
    });

    const record = listOk ? firstRecord(listRes.json()) : null;
    const branchNo = pick(record, ['branchNo', 'accountBranch']);

    if (!record) {
      console.warn(
        '[REG] step 1 list returned no usable record (empty list / seeded data pending from ops) — skipping dependent steps 2-6.'
      );
      return;
    }

    const uuid = pickOrWarn(record, ['uuid', 'companyUuid', 'id'], 'REG step 2 detail/{uuid} (uuid)');
    if (!uuid) {
      console.warn('[REG] step 1 record has no uuid — skipping step 2 detail.');
    } else {
      sleep(1);
      const detailRes = http.get(`${HOST}/reg/company/detail/${uuid}`, {
        headers: { Authorization: `Bearer ${token}` },
        tags: { name: 'REG 2 /reg/company/detail/{uuid}' },
      });
      regDuration.add(detailRes.timings.duration);
      check(detailRes, {
        '[REG] 2 detail status 200': (r) => r.status === 200,
        '[REG] 2 detail valid JSON': (r) => r.json() !== null,
      });
    }

    const accountNo = pickOrWarn(
      record,
      ['accountNo', 'companyAccountNo'],
      'REG steps 3-6 (accountNo)'
    );
    if (!accountNo) {
      console.warn(
        '[REG] step 1 record has no accountNo — skipping steps 3-6 (they key off accountNo).'
      );
      return;
    }

    sleep(1);
    const bgBody = JSON.stringify({ accountNo });
    const bgRes = http.post(`${HOST}/reg/company/business-group/list`, bgBody, {
      headers,
      tags: { name: 'REG 3 /reg/company/business-group/list' },
    });
    regDuration.add(bgRes.timings.duration);
    check(bgRes, {
      '[REG] 3 business-group/list status 200': (r) => r.status === 200,
      '[REG] 3 business-group/list valid JSON': (r) => r.json() !== null,
    });

    sleep(1);
    const branchBody = JSON.stringify({
      accountNo,
      ssoResponsibility: '3101',
      removeMainBranch: true,
      pagination: {
        pageNumber: 0,
        pageSize: 20,
        orders: [{ direction: 'DESC', property: 'accountNo' }],
      },
    });
    const branchRes = http.post(`${HOST}/reg/company/branch`, branchBody, {
      headers,
      tags: { name: 'REG 4 /reg/company/branch' },
    });
    regDuration.add(branchRes.timings.duration);
    check(branchRes, {
      '[REG] 4 branch status 200': (r) => r.status === 200,
      '[REG] 4 branch valid JSON': (r) => r.json() !== null,
    });
    const branchRecord = branchRes.status === 200 ? firstRecord(branchRes.json()) : null;
    const detailBranchNo =
      pickOrWarn(branchRecord, ['branchNo', 'accountBranch'], 'REG step 5 detail (branchNo from step 4)') ||
      branchNo ||
      '000000';

    sleep(1);
    const detailPostBody = JSON.stringify({ accountNo, branchNo: detailBranchNo });
    const detailPostRes = http.post(`${HOST}/reg/company/detail`, detailPostBody, {
      headers,
      tags: { name: 'REG 5 /reg/company/detail' },
    });
    regDuration.add(detailPostRes.timings.duration);
    check(detailPostRes, {
      '[REG] 5 detail(POST) status 200': (r) => r.status === 200,
      '[REG] 5 detail(POST) valid JSON': (r) => r.json() !== null,
    });

    sleep(1);
    const bg2Res = http.post(`${HOST}/reg/company/business-group/list`, bgBody, {
      headers,
      tags: { name: 'REG 6 /reg/company/business-group/list' },
    });
    regDuration.add(bg2Res.timings.duration);
    check(bg2Res, {
      '[REG] 6 business-group/list status 200': (r) => r.status === 200,
      '[REG] 6 business-group/list valid JSON': (r) => r.json() !== null,
    });
  });
}
