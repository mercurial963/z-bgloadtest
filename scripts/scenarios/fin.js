/*
 * fin.js — FIN (cashier / receipt) journey (read-only basket).
 * =========================================================================
 * READ-ONLY only: no write endpoints. The FIN journey is now list-then-detail
 * off pre-existing data, exactly like cong2.js/g3.js. No receipt is recorded,
 * cancelled, or approved. This matches the smoke.js read-only header invariant.
 *
 * The write journey (record receipt, revoke, receive-other, cancel, approval)
 * was scoped then PARKED. It pins to a single non-replenishing seed (one
 * invoiceCode, one commandNumber), so concurrent load collides on already-paid
 * / lock conflicts. Real write-load needs a per-iteration writable seed pool
 * from the stakeholder. Parked until that lands.
 *
 * The journey runs for two branches, 1000 then 1200. Only ssoBranch on the
 * per-branch list lookups varies; everything else is identical.
 *
 * Chaining (real data wired from prior responses, never a hardcoded id a prior
 * step produces); each downstream step is skipped with a console.warn when its
 * source returns empty, the same defensive pattern as g3.js:
 *   step 3 inquiry/receipt/list  -> step 4 inquiry detail receiptId
 *                                 -> step 7 pending-approval referenceCode (receiptNo)
 *   step 5 edit/receipt/list     -> step 6 edit detail receiptId
 *
 * Steps, in journey order (all R = read):
 *   1.  POST /fin/receive-money/invoice/list   (R) seed invoiceCode
 *   2.  POST /fin/revoke-money/invoice/list     (R) seed commandNumber
 *   3.  POST /fin/inquiry/receipt/list          (R) ssoBranch per-branch; provides receiptId + receiptNo
 *   4.  GET  /fin/inquiry/receipt/{receiptId}   (R) receiptId from (3)
 *   5.  POST /fin/edit/receipt/list             (R) ssoBranch per-branch; provides receiptId
 *   6.  POST /fin/edit/receipt/{receiptId}      (R) receiptId from (5)  [VERB FLAG]
 *   7.  POST /fin/pending-approval/list         (R) referenceCode from (3) receiptNo
 * =========================================================================
 */

import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

// Per-domain latency metric (so FIN is visible separately from the others).
const finDuration = new Trend('fin_req_duration', true);

// Seed data from user.md. Kept exactly as given. The first invoiceCode and the
// worked-example commandNumber drive the two search steps each iteration.
const SEED_INVOICE_CODE = '120069100001694';
const SEED_COMMAND_NUMBER = '1001530000002';

// The two branches the journey runs for. Only ssoBranch on the per-branch list
// lookups (steps 3, 5) varies.
const BRANCHES = ['1000', '1200'];

export function finFlow(token, config) {
  const HOST = config.HOST;
  group('FIN', function () {
    const { postStep, getStep } = makeSteps({
      token,
      label: 'FIN',
      tagPrefix: 'FIN',
      host: HOST,
      trend: finDuration,
    });

    for (const branch of BRANCHES) {
      finBranchJourney(branch);
    }

    // One full 7-step read pass for a single branch. ssoBranch (steps 3, 5) is
    // parameterized on `branch`; everything else is identical between branches.
    function finBranchJourney(branch) {
      group(`FIN-${branch}`, function () {
        // 1. (R) search contribution invoices by seed invoiceCode.
        postStep(1, '/fin/receive-money/invoice/list', {
          typeFilter: 'ใบแจ้งเงินสมทบ',
          invoiceCode: SEED_INVOICE_CODE,
          operation: 'AND',
          pagination: {
            pageNumber: 0,
            pageSize: 10,
            orders: [{ direction: 'DESC', property: 'dueDate' }],
          },
        });

        // 2. (R) search exceed-rights money by seed commandNumber.
        sleep(1);
        postStep(2, '/fin/revoke-money/invoice/list', {
          searchBy: '0',
          commandNumber: SEED_COMMAND_NUMBER,
          pagination: { pageNumber: 0, pageSize: 10, orders: [] },
          showChequeFail: true,
        });

        // 3. (R) inquiry receipt list. ssoBranch is per-branch; empty receiptNo
        //    surfaces this branch's existing receipts. The row provides the
        //    receiptId step 4 chains off and the receiptNo step 7 reuses.
        sleep(1);
        const inq = postStep(3, '/fin/inquiry/receipt/list', {
          receiptNo: '',
          ssoBranch: branch,
          pagination: { pageNumber: 0, pageSize: 10, orders: [] },
        });
        const inqRec = inq.status === 200 ? firstRecord(inq.json()) : null;
        const inqReceiptId = pickOrWarn(
          inqRec,
          ['receiptId', 'id'],
          `FIN-${branch} step 4 inquiry/receipt/{receiptId} (receiptId)`
        );
        const inqReceiptNo = pick(inqRec, ['receiptNo']);

        // 4. (R) receipt detail. receiptId chained from step 3.
        if (!inqReceiptId) {
          console.warn(
            `[FIN-${branch}] step 3 inquiry empty — skipping step 4 detail.`
          );
        } else {
          sleep(1);
          getStep(4, `/fin/inquiry/receipt/${inqReceiptId}`, 'inquiry/receipt/{receiptId}');
        }

        // 5. (R) edit receipt list. ssoBranch is per-branch; empty receiptNo
        //    lists this branch's receipts. The row provides the receiptId step
        //    6 chains off.
        sleep(1);
        const editList = postStep(5, '/fin/edit/receipt/list', {
          receiptNo: '',
          ssoBranch: branch,
          pagination: { pageNumber: 0, pageSize: 10, orders: [] },
        });
        const editRec = editList.status === 200 ? firstRecord(editList.json()) : null;
        const editReceiptId = pickOrWarn(
          editRec,
          ['receiptId', 'id'],
          `FIN-${branch} step 6 edit/receipt/{receiptId} (receiptId)`
        );

        // 6. (R) edit receipt detail. receiptId chained from step 5.
        //    VERB FLAG: user.md specified POST, but the v2 Postman collection
        //    shows GET. Smoke run resolved this to GET; settled, see step 4.
        if (!editReceiptId) {
          console.warn(
            `[FIN-${branch}] step 5 edit/receipt/list empty — skipping step 6 detail.`
          );
        } else {
          sleep(1);
          getStep(6, `/fin/edit/receipt/${editReceiptId}`, 'edit/receipt/{receiptId}');
        }

        // 7. (R) pending approval list. referenceCode reuses the step 3 inquiry
        //    receiptNo when present, else empty so the list still runs.
        sleep(1);
        if (!inqReceiptNo) {
          console.warn(
            `[FIN-${branch}] step 3 yielded no receiptNo — step 7 pending-approval runs with empty referenceCode.`
          );
        }
        postStep(7, '/fin/pending-approval/list', {
          referenceCode: inqReceiptNo || '',
          typeId: '0',
          pagination: { pageNumber: 0, pageSize: 10, orders: [] },
        });
      });
    }
  });
}
