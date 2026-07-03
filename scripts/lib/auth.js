import http from 'k6/http';
import { check } from 'k6';
import encoding from 'k6/encoding';
import exec from 'k6/execution';


export function authenticate(username, password, label, config) {
  const basic = encoding.b64encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`);
  const url =
    `${config.AUTH_BASE}/auth/user/token` +
    `?grant_type=password&username=${encodeURIComponent(username)}` +
    `&password=${encodeURIComponent(password)}`;

  const res = http.post(url, null, {
    headers: {
      Authorization: `Basic ${basic}`,
      'X-Token-Ttl-Seconds': '21600',
    },
    tags: { name: `auth:${label}` },
  });

  if (res.error_code || res.error || res.status === 0 || res.body === null) {
    const reason = res.error || `HTTP ${res.status}` || 'unknown error';
    console.error(
      `[${label}] auth request failed: ${reason} ` +
        `(url=${url} status=${res.status} error_code=${res.error_code || 0})`
    );
    exec.test.abort(
      `[${label}] auth request failed: ${reason} (status ${res.status})`
    );
  }

  const ok = check(res, {
    [`[${label}] auth status 200`]: (r) => r.status === 200,
    [`[${label}] auth returned access_token`]: (r) => {
      const b = r.json();
      return b && typeof b.access_token === 'string' && b.access_token.length > 0;
    },
  });

  if (!ok) {
    exec.test.abort(`[${label}] authentication failed (status ${res.status})`);
  }
  return res.json().access_token;
}
