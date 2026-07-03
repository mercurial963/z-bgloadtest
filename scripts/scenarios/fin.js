import { sleep, group } from 'k6';
import { Trend } from 'k6/metrics';
import { firstRecord, pick, pickOrWarn, makeSteps } from '../lib/http.js';

const finDuration = new Trend('fin_req_duration', true);

const SEED_INVOICE_CODE = '120069100001694';
const SEED_COMMAND_NUMBER = '1001530000002';

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

    function finBranchJourney(branch) {
      group(`FIN-${branch}`, function () {
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

        sleep(1);
        postStep(2, '/fin/revoke-money/invoice/list', {
          searchBy: '0',
          commandNumber: SEED_COMMAND_NUMBER,
          pagination: { pageNumber: 0, pageSize: 10, orders: [] },
          showChequeFail: true,
        });

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

        if (!inqReceiptId) {
          console.warn(
            `[FIN-${branch}] step 3 inquiry empty — skipping step 4 detail.`
          );
        } else {
          sleep(1);
          getStep(4, `/fin/inquiry/receipt/${inqReceiptId}`, 'inquiry/receipt/{receiptId}');
        }

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

        if (!editReceiptId) {
          console.warn(
            `[FIN-${branch}] step 5 edit/receipt/list empty — skipping step 6 detail.`
          );
        } else {
          sleep(1);
          getStep(6, `/fin/edit/receipt/${editReceiptId}`, 'edit/receipt/{receiptId}');
        }

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
