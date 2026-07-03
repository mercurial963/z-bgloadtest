import http from 'k6/http';
import { check } from 'k6';

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

export function pick(record, keys) {
  if (!record) return null;
  for (const k of keys) {
    if (record[k] !== undefined && record[k] !== null && record[k] !== '') {
      return record[k];
    }
  }
  return null;
}

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

export function makeSteps({ token, label, tagPrefix, host, trend }) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const authGet = {
    headers: { Authorization: `Bearer ${token}` },
  };

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

  function bodyHead(res, max = 120) {
    const b = res && res.body != null ? String(res.body) : '';
    const flat = b.replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
  }

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
    const parsed = safeJson(res, `${n} ${stepLabel}`);
    check(res, {
      [`[${label}] ${n} ${stepLabel} status 200`]: (r) => r.status === 200,
      [`[${label}] ${n} ${stepLabel} valid JSON`]: () => parsed !== null,
    });
    return res;
  }

  return { headers, authGet, postStep, getStep };
}
