/*
 * g0.js — G0 home-page burst (masterdata reference reads on login).
 * =========================================================================
 * Per Load-test/G0/login/home-page.http: after login the home page fires a
 * small basket of INDEPENDENT reference reads. There is no chaining and no
 * field extraction — it is just three GETs that always run together.
 *
 *   1. GET /ums/users/profile          user profile
 *   2. GET /nms/notifications?status=N  fetch notifications (status=N)
 *   3. GET /ums/users/page-accesses    user page-access rights
 *
 * Auth: the source notes any user's token works, and params.md says G0 reuses
 * the REG user (picked arbitrarily, masterdata is public). So G0 does NOT mint
 * its own token — smoke.js passes the cached REG token in.
 *
 * The source .http file pointed at uat/dev hosts and had a stray quote in the
 * notifications query (status=N'); both are corrected here — everything points
 * at config.HOST (prod) and the filter is the clean literal status=N.
 * =========================================================================
 */

import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

// Per-domain latency metric (so G0 is visible separately from REG / CON-G2).
const g0Duration = new Trend('g0_req_duration', true);

export function g0Flow(token, config) {
  const HOST = config.HOST;
  group('G0', function () {
    const headers = { Authorization: `Bearer ${token}` };

    // --- 1: user profile -------------------------------------------------
    const profileRes = http.get(`${HOST}/ums/users/profile`, {
      headers,
      tags: { name: 'G0 1 /ums/users/profile' },
    });
    g0Duration.add(profileRes.timings.duration);
    check(profileRes, {
      '[G0] 1 profile status 200': (r) => r.status === 200,
    });

    // --- 2: fetch notifications (status=N) -------------------------------
    const notiRes = http.get(`${HOST}/nms/notifications?status=N`, {
      headers,
      tags: { name: 'G0 2 /nms/notifications' },
    });
    g0Duration.add(notiRes.timings.duration);
    check(notiRes, {
      '[G0] 2 notifications status 200': (r) => r.status === 200,
    });

    // --- 3: user page-accesses -------------------------------------------
    const accessRes = http.get(`${HOST}/ums/users/page-accesses`, {
      headers,
      tags: { name: 'G0 3 /ums/users/page-accesses' },
    });
    g0Duration.add(accessRes.timings.duration);
    check(accessRes, {
      '[G0] 3 page-accesses status 200': (r) => r.status === 200,
    });
  });
}
