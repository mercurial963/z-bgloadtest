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

  function postStep(n, path, body) {
    const res = http.post(`${host}${path}`, JSON.stringify(body), {
      headers,
      tags: { name: `${tagPrefix} ${n} ${path}` },
    });
    trend.add(res.timings.duration);
    check(res, {
      [`[${label}] ${n} ${path} status 200`]: (r) => r.status === 200,
      [`[${label}] ${n} ${path} valid JSON`]: (r) => r.json() !== null,
    });
    return res;
  }

  function getStep(n, urlSuffix, stepLabel) {
    const res = http.get(`${host}${urlSuffix}`, {
      ...authGet,
      tags: { name: `${tagPrefix} ${n} ${stepLabel}` },
    });
    trend.add(res.timings.duration);
    check(res, {
      [`[${label}] ${n} ${stepLabel} status 200`]: (r) => r.status === 200,
      [`[${label}] ${n} ${stepLabel} valid JSON`]: (r) => r.json() !== null,
    });
    return res;
  }

  return { headers, authGet, postStep, getStep };
}
