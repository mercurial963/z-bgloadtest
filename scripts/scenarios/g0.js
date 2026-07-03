import http from 'k6/http';
import { check, group } from 'k6';
import { Trend } from 'k6/metrics';

const g0Duration = new Trend('g0_req_duration', true);

export function g0Flow(token, config) {
  const HOST = config.HOST;
  group('G0', function () {
    const headers = { Authorization: `Bearer ${token}` };

    const profileRes = http.get(`${HOST}/ums/users/profile`, {
      headers,
      tags: { name: 'G0 1 /ums/users/profile' },
    });
    g0Duration.add(profileRes.timings.duration);
    check(profileRes, {
      '[G0] 1 profile status 200': (r) => r.status === 200,
    });

    const notiRes = http.get(`${HOST}/nms/notifications?status=N`, {
      headers,
      tags: { name: 'G0 2 /nms/notifications' },
    });
    g0Duration.add(notiRes.timings.duration);
    check(notiRes, {
      '[G0] 2 notifications status 200': (r) => r.status === 200,
    });

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
