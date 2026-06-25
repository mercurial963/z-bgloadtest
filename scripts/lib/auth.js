/*
 * auth.js — Bearer JWT auth helper.
 * =========================================================================
 * HTTP Basic client credentials + password grant. Authenticated ONCE in
 * setup() and the token is cached + reused across iterations (no re-auth per
 * loop). On failure the test is aborted with a readable label.
 * =========================================================================
 */

import http from 'k6/http';
import { check } from 'k6';
import encoding from 'k6/encoding';
import exec from 'k6/execution';

// Authenticate a single user against the password grant and return its token.
// `config` supplies AUTH_BASE / CLIENT_ID / CLIENT_SECRET.
export function authenticate(username, password, label, config) {
  const basic = encoding.b64encode(`${config.CLIENT_ID}:${config.CLIENT_SECRET}`);
  const url =
    `${config.AUTH_BASE}/auth/user/token` +
    `?grant_type=password&username=${encodeURIComponent(username)}` +
    `&password=${encodeURIComponent(password)}`;

  const res = http.post(url, null, {
    headers: {
      Authorization: `Basic ${basic}`,
      // Ask the server for a 6-hour token (21600s), its maximum TTL, so tokens
      // do not expire partway through a long load run.
      'X-Token-Ttl-Seconds': '21600',
    },
    tags: { name: `auth:${label}` },
  });

  // Guard the request itself BEFORE touching the body. A network/TLS failure
  // (DNS, connection refused, TLS handshake) returns res.error set, status 0,
  // and a null body — calling r.json() on that throws an opaque GoError. Detect
  // it here and abort with a readable, operator-facing reason instead.
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
