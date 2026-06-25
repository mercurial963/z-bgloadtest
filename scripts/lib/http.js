/*
 * http.js — shared response-probing + per-domain request helpers.
 * =========================================================================
 * The collections ship no saved responses, so we probe the common shapes
 * defensively (firstRecord / pick). makeSteps() builds the per-domain
 * postStep/getStep check() wrappers bound to a token + the domain's Trend.
 * =========================================================================
 */

import http from 'k6/http';
import { check } from 'k6';

// Pull the first usable record out of a list response, probing common shapes.
export function firstRecord(body) {
  if (!body) return null;
  if (Array.isArray(body) && body.length) return body[0];
  if (Array.isArray(body.content) && body.content.length) return body.content[0];
  if (body.data) {
    if (Array.isArray(body.data) && body.data.length) return body.data[0];
    if (Array.isArray(body.data.content) && body.data.content.length) return body.data.content[0];
  }
  if (Array.isArray(body.items) && body.items.length) return body.items[0];
  if (Array.isArray(body.records) && body.records.length) return body.records[0];
  return null;
}

// Pull the first present value among candidate keys off a record (defensive:
// the collections ship no saved responses, so we probe the common field names).
export function pick(record, keys) {
  if (!record) return null;
  for (const k of keys) {
    if (record[k] !== undefined && record[k] !== null && record[k] !== '') {
      return record[k];
    }
  }
  return null;
}

// Stringify a record for diagnostics, truncating if it's huge so a single
// fat response can't flood the console.
function truncatedJson(record, max = 2000) {
  let s;
  try {
    s = JSON.stringify(record);
  } catch (e) {
    return `<unserializable: ${e && e.message}>`;
  }
  if (s === undefined) return String(record);
  if (s.length > max) return `${s.slice(0, max)}… [truncated ${s.length - max} chars]`;
  return s;
}

// pick() with a self-diagnosing miss path. On success it behaves EXACTLY like
// pick() (returns the first present candidate value). On a miss (no candidate
// found, or the record itself is null/empty), it logs a warning that names the
// candidate fields it tried AND the actual Object.keys() of the record it got
// (plus the raw record, truncated), so the operator can read off the real field
// name to add to the candidate list. `label` is a human-readable step tag.
export function pickOrWarn(record, candidates, label) {
  const value = pick(record, candidates);
  if (value !== null) return value;

  const tried = candidates.join(', ');
  if (!record) {
    console.warn(
      `[${label}] no usable record to extract from (firstRecord was null/empty). ` +
        `Looked for field(s): [${tried}].`
    );
  } else {
    const keys = Object.keys(record);
    console.warn(
      `[${label}] none of the expected field(s) [${tried}] were present. ` +
        `Record actually had keys: [${keys.join(', ')}]. ` +
        `Add the real field name to the candidate list. Raw record: ${truncatedJson(record)}`
    );
  }
  return null;
}

// Build per-domain postStep/getStep helpers bound to a token, a domain label
// prefix (e.g. 'CON-G2'), a tag prefix (e.g. 'CON-G2'), the host, and the
// domain Trend. Keeps the long ordered walks readable while preserving the
// exact tags, checks, and trend.add() behavior of the monolith.
export function makeSteps({ token, label, tagPrefix, host, trend }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const authGet = {
    headers: { Authorization: `Bearer ${token}` },
  };

  // Detect a request that failed at the transport layer (DNS, connection
  // refused, TLS handshake, timeout). Such a response has res.error set,
  // status 0, and a null body — calling r.json() on it throws an opaque
  // GoError that aborts the whole iteration. Mirror auth.js: log a readable
  // warning, register a FAILED check so it surfaces in the k6 summary, and
  // return WITHOUT touching the body so the iteration continues. Returns true
  // when the response is a transport failure (caller should bail early).
  function guardFailed(res, stepLabel, url) {
    if (res.error_code || res.error || res.status === 0 || res.body === null) {
      const reason = res.error || `HTTP ${res.status}` || 'unknown error';
      console.warn(
        `[${label}] ${stepLabel} request failed: ${reason} ` +
          `(url=${url} status=${res.status} error_code=${res.error_code || 0})`
      );
      check(res, {
        [`[${label}] ${stepLabel} request succeeded (transport)`]: () => false,
      });
      return true;
    }
    return false;
  }

  // First ~120 chars of a body, for diagnostics. Bodies can be huge HTML error
  // pages, so we truncate hard and flatten newlines so the warning stays on one
  // readable line.
  function bodyHead(res, max = 120) {
    const b = res && res.body != null ? String(res.body) : '';
    const flat = b.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
  }

  // Defensive JSON read. A non-2xx response (404, 500, an HTML error page) or a
  // 2xx with a non-JSON body (e.g. a '%'-prefixed body) must NOT call r.json()
  // and abort the iteration with a GoError. Guard on status first, then wrap the
  // parse: on either failure, warn with label + step + status + truncated body
  // and return null so firstRecord/pick/pickOrWarn downstream warn-skip the
  // chained step instead of crashing. Returns the parsed body on the happy path
  // (2xx + valid JSON), exactly as r.json() would have.
  function safeJson(res, stepLabel) {
    if (res.status < 200 || res.status >= 300) {
      console.warn(
        `[${label}] ${stepLabel} non-2xx response (status=${res.status}); ` +
          `skipping json parse. Body head: ${bodyHead(res)}`
      );
      return null;
    }
    try {
      return res.json();
    } catch (e) {
      console.warn(
        `[${label}] ${stepLabel} body is not valid JSON (status=${res.status}); ` +
          `skipping json parse. Body head: ${bodyHead(res)}`
      );
      return null;
    }
  }

  function postStep(n, path, body) {
    const res = http.post(`${host}${path}`, JSON.stringify(body), {
      headers,
      tags: { name: `${tagPrefix} ${n} ${path}` },
    });
    trend.add(res.timings.duration);
    if (guardFailed(res, `${n} ${path}`, `${host}${path}`)) {
      return res;
    }
    // Parse defensively ONCE (non-2xx or non-JSON body -> warn + null, never a
    // GoError), then assert on the already-parsed value so the check never
    // re-parses and re-throws.
    const parsed = safeJson(res, `${n} ${path}`);
    check(res, {
      [`[${label}] ${n} ${path} status 200`]: (r) => r.status === 200,
      [`[${label}] ${n} ${path} valid JSON`]: () => parsed !== null,
    });
    return res;
  }

  function getStep(n, urlSuffix, stepLabel) {
    const res = http.get(`${host}${urlSuffix}`, {
      ...authGet,
      tags: { name: `${tagPrefix} ${n} ${stepLabel}` },
    });
    trend.add(res.timings.duration);
    if (guardFailed(res, `${n} ${stepLabel}`, `${host}${urlSuffix}`)) {
      return res;
    }
    // Parse defensively ONCE (non-2xx or non-JSON body -> warn + null, never a
    // GoError), then assert on the already-parsed value so the check never
    // re-parses and re-throws.
    const parsed = safeJson(res, `${n} ${stepLabel}`);
    check(res, {
      [`[${label}] ${n} ${stepLabel} status 200`]: (r) => r.status === 200,
      [`[${label}] ${n} ${stepLabel} valid JSON`]: () => parsed !== null,
    });
    return res;
  }

  return { headers, authGet, postStep, getStep };
}
