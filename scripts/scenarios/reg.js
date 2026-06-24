/*
 * reg.js — REG company lookup journey (ordered per Load-test/REG/workflow.md).
 * =========================================================================
 * workflow.md lays out the REG003001 user journey as 6 ordered steps; request
 * shapes are taken from REG.postman_collection.json. All 6 are reads (POST
 * search / GET detail) — there are NO write steps in this journey to skip.
 *
 *   1. POST /reg/company/list                 search companies
 *   2. GET  /reg/company/detail/{uuid}        company detail; uuid chained from (1)
 *   3. POST /reg/company/business-group/list  business types; accountNo chained
 *   4. POST /reg/company/branch               employer branches; accountNo chained
 *   5. POST /reg/company/detail               company detail (by accountNo/branchNo)
 *   6. POST /reg/company/business-group/list  business types again (workflow repeats)
 *
 * Chaining: the collection hardcodes accountNo in steps 3-6. We chain accountNo
 * (and branchNo where present) from the step-1 list record / step-2 detail
 * instead of hardcoding. Each dependent step is skipped with a console.warn if
 * the prior response yielded nothing usable.
 * =========================================================================
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn } from '../lib/http.js';

// Per-domain latency metric (so REG vs CON-G2 are visible separately).
const regDuration = new Trend('reg_req_duration', true);

export function regFlow(token, config) {
  const HOST = config.HOST;
  group('REG', function () {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // --- Step 1: search companies ----------------------------------------
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
    // branchNo is only a fallback for step 5; a miss there is non-fatal and we
    // don't want a warn for it, so it uses plain pick(). uuid/accountNo gate
    // dependent steps, so their misses are self-diagnosing via pickOrWarn().
    const branchNo = pick(record, ['branchNo', 'accountBranch']);

    if (!record) {
      console.warn(
        '[REG] step 1 list returned no usable record (empty list / seeded data pending from ops) — skipping dependent steps 2-6.'
      );
      return;
    }

    // --- Step 2: company detail by uuid ----------------------------------
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

    // --- Steps 3-6 key off accountNo ------------------------------------
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

    // --- Step 3: business-group list (chain accountNo) -------------------
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

    // --- Step 4: company branches (chain accountNo) ----------------------
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
    // Prefer a branchNo discovered from the branch list; else the step-1 value.
    // pickOrWarn surfaces the real branch field names if neither candidate hits
    // (the chain still falls back to the step-1 branchNo / '000000').
    const branchRecord = branchRes.status === 200 ? firstRecord(branchRes.json()) : null;
    const detailBranchNo =
      pickOrWarn(branchRecord, ['branchNo', 'accountBranch'], 'REG step 5 detail (branchNo from step 4)') ||
      branchNo ||
      '000000';

    // --- Step 5: company detail by accountNo/branchNo --------------------
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

    // --- Step 6: business-group list again (workflow repeats it) ---------
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
