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
    headers: { Authorization: `Basic ${basic}` },
    tags: { name: `auth:${label}` },
  });

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
