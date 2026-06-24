/*
 * config.js — env reader + required-var guard for the WCF k6 smoke/load suite.
 * =========================================================================
 * The .env file is the SINGLE SOURCE OF TRUTH. There are NO in-code fallback
 * defaults. Every config value is read straight from __ENV.
 *
 * The required-var guard runs at MODULE INIT (the IIFE below executes the moment
 * this module is imported). smoke.js imports this module FIRST, before k6
 * evaluates `export const options`, so a missing VUS/ITERATIONS fails clearly
 * and immediately rather than feeding NaN into options.
 *
 * Special case: CONG2_BALANCE_ACCOUNT_BRANCH is intentionally allowed to be the
 * EMPTY string (the annual balance call uses an empty branch). It must be
 * DEFINED (present in .env, even as ""), but an empty value is valid — so it's
 * validated for being defined, not for being non-empty.
 * =========================================================================
 */

// Vars that must be present AND non-empty.
const REQUIRED_VARS = [
  'HOST',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REG_USER',
  'REG_PASS',
  'CONG2_USER',
  'CONG2_PASS',
  'VUS',
  'ITERATIONS',
  'CONG2_BALANCE_ACCOUNT_NO',
  'CONG2_DEPOSIT_ACCOUNT_NO',
  'CONG2_PERIOD_ACCOUNT_NO',
  'CONG2_AUDIT_ACCOUNT_NO',
  'CONG2_RETRO_ACCOUNT_NO',
];

// Vars that must be DEFINED but may be the empty string (unset is still an error).
const REQUIRED_DEFINED_VARS = ['CONG2_BALANCE_ACCOUNT_BRANCH'];

// Run the guard at module init. Importing this module triggers validation.
(function validateEnv() {
  const missing = [];
  for (const name of REQUIRED_VARS) {
    const v = __ENV[name];
    if (v === undefined || v === '') missing.push(name);
  }
  for (const name of REQUIRED_DEFINED_VARS) {
    // Empty string is valid; only a truly unset (undefined) var is missing.
    if (__ENV[name] === undefined) missing.push(`${name} (must be defined; empty value is allowed)`);
  }
  if (missing.length) {
    throw new Error(
      'Missing required environment variable(s): ' +
        missing.join(', ') +
        '. The .env file is the single source of truth — set these and re-run ' +
        '(e.g. `k6 run -e VAR=... scripts/smoke.js` or via your .env loader). No in-code defaults exist.'
    );
  }
})();

// ---------------------------------------------------------------------------
// Configuration (read straight from __ENV — no fallbacks)
// ---------------------------------------------------------------------------
const HOST = __ENV.HOST;

export const config = {
  HOST,

  // Auth: HTTP Basic client credentials + password grant.
  AUTH_BASE: `${HOST}/ips/api`,
  CLIENT_ID: __ENV.CLIENT_ID,
  CLIENT_SECRET: __ENV.CLIENT_SECRET,

  // Per-module users.
  REG_USER: __ENV.REG_USER,
  REG_PASS: __ENV.REG_PASS,
  CONG2_USER: __ENV.CONG2_USER,
  CONG2_PASS: __ENV.CONG2_PASS,

  // CON-G2 balance check accountNo + branch. Branch is intentionally allowed empty.
  CONG2_BALANCE_ACCOUNT_NO: __ENV.CONG2_BALANCE_ACCOUNT_NO,
  CONG2_BALANCE_ACCOUNT_BRANCH: __ENV.CONG2_BALANCE_ACCOUNT_BRANCH,

  // Per-step CON-G2 account numbers.
  CONG2_DEPOSIT_ACCOUNT_NO: __ENV.CONG2_DEPOSIT_ACCOUNT_NO,
  CONG2_PERIOD_ACCOUNT_NO: __ENV.CONG2_PERIOD_ACCOUNT_NO,
  CONG2_AUDIT_ACCOUNT_NO: __ENV.CONG2_AUDIT_ACCOUNT_NO,
  // Retro account is shared across steps 15-18 (same employer, same year/typeDocCode
  // filter), so step 18's askContribute lookup reuses it rather than getting its own.
  CONG2_RETRO_ACCOUNT_NO: __ENV.CONG2_RETRO_ACCOUNT_NO,

  // Smoke profile knobs (presence enforced by the init guard above).
  VUS: Number(__ENV.VUS),
  ITERATIONS: Number(__ENV.ITERATIONS),
};

// ---------------------------------------------------------------------------
// Shared TLS options for the prod entrypoints.
// Prod serves a cert signed by an internal CA (SSO_CA, not in any public trust
// store), so insecureSkipTLSVerify accepts the internal SSO_CA cert. We PIN
// TLS 1.2 (min AND max both tls1.2) and supply an explicit TLS 1.2 cipher list
// so Go negotiates a cipher the server accepts rather than failing with
// `tls: server chose an unconfigured cipher suite`.
// Host pinning is NOT here — it stays in scripts/config.json (passed via
// --config config.json), which pins both wcf.sso.go.th and wcfapi.sso.go.th.
// Spread into each entrypoint's exported `options`.
// ---------------------------------------------------------------------------
export const tlsOptions = {
  insecureSkipTLSVerify: true,
  tlsVersion: { min: 'tls1.2', max: 'tls1.2' },
  tlsCipherSuites: [
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_RSA_WITH_AES_128_GCM_SHA256',
  ],
};
