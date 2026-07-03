const REQUIRED_VARS = [
  'HOST',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'REG_USER',
  'REG_PASS',
  'CONG2_USER',
  'CONG2_PASS',
  'G3_USER',
  'G3_PASS',
  'FIN_USER',
  'FIN_PASS',
  'CMP_USER',
  'CMP_PASS',
  'VUS',
  'ITERATIONS',
  'CONG2_BALANCE_ACCOUNT_NO',
  'CONG2_DEPOSIT_ACCOUNT_NO',
  'CONG2_PERIOD_ACCOUNT_NO',
  'CONG2_AUDIT_ACCOUNT_NO',
  'CONG2_RETRO_ACCOUNT_NO',
];

const REQUIRED_DEFINED_VARS = ['CONG2_BALANCE_ACCOUNT_BRANCH'];

(function validateEnv() {
  const missing = [];
  for (const name of REQUIRED_VARS) {
    const v = __ENV[name];
    if (v === undefined || v === '') missing.push(name);
  }
  for (const name of REQUIRED_DEFINED_VARS) {
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

const HOST = __ENV.HOST;

export const config = {
  HOST,

  AUTH_BASE: `${HOST}`,
  CLIENT_ID: __ENV.CLIENT_ID,
  CLIENT_SECRET: __ENV.CLIENT_SECRET,

  REG_USER: __ENV.REG_USER,
  REG_PASS: __ENV.REG_PASS,
  CONG2_USER: __ENV.CONG2_USER,
  CONG2_PASS: __ENV.CONG2_PASS,
  G3_USER: __ENV.G3_USER,
  G3_PASS: __ENV.G3_PASS,
  FIN_USER: __ENV.FIN_USER,
  FIN_PASS: __ENV.FIN_PASS,
  CMP_USER: __ENV.CMP_USER,
  CMP_PASS: __ENV.CMP_PASS,

  CONG2_BALANCE_ACCOUNT_NO: __ENV.CONG2_BALANCE_ACCOUNT_NO,
  CONG2_BALANCE_ACCOUNT_BRANCH: __ENV.CONG2_BALANCE_ACCOUNT_BRANCH,

  CONG2_DEPOSIT_ACCOUNT_NO: __ENV.CONG2_DEPOSIT_ACCOUNT_NO,
  CONG2_PERIOD_ACCOUNT_NO: __ENV.CONG2_PERIOD_ACCOUNT_NO,
  CONG2_AUDIT_ACCOUNT_NO: __ENV.CONG2_AUDIT_ACCOUNT_NO,
  CONG2_RETRO_ACCOUNT_NO: __ENV.CONG2_RETRO_ACCOUNT_NO,

  VUS: Number(__ENV.VUS),
  ITERATIONS: Number(__ENV.ITERATIONS),
};

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
