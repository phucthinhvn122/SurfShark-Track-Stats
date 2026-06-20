// load/activate.k6.js
//
// k6 load test for the activation API. Models the real async flow:
//   POST /activate  -> 202 { requestId }
//   poll GET /status/:id until terminal (success|failed)
//
// Usage:
//   BASE_URL=https://api.surfshark-activate.app k6 run load/activate.k6.js
//   k6 run -e BASE_URL=http://localhost:3001 -e STAGE=1k load/activate.k6.js
//
// Seed enough UNUSED keys first (admin bulk-create) and pass them via KEYS env
// (comma-separated) or rely on the default demo keys for a smoke run.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3001';
const KEYS = (__ENV.KEYS || 'VPN-A9X2-K8LM').split(',');

const activateLatency = new Trend('activate_latency_ms');
const e2eLatency = new Trend('activation_e2e_ms');
const successRate = new Rate('activation_success');

// Staged ramp: 100 -> 1k -> 10k virtual users (tune per environment/budget).
const STAGES = {
  '100': [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 100 },
    { duration: '20s', target: 0 },
  ],
  '1k': [
    { duration: '1m', target: 1000 },
    { duration: '3m', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  '10k': [
    { duration: '2m', target: 10000 },
    { duration: '5m', target: 10000 },
    { duration: '1m', target: 0 },
  ],
};

export const options = {
  stages: STAGES[__ENV.STAGE || '100'],
  thresholds: {
    activate_latency_ms: ['p(95)<500'], // POST /activate must stay < 500ms
    http_req_failed: ['rate<0.01'], // < 1% transport errors
    activation_success: ['rate>0.95'],
  },
};

export default function () {
  const username = `load_${__VU}_${__ITER}`;
  const license = KEYS[Math.floor(Math.random() * KEYS.length)];

  const t0 = Date.now();
  const res = http.post(`${BASE}/activate`, JSON.stringify({ username, license }), {
    headers: { 'Content-Type': 'application/json' },
  });
  activateLatency.add(res.timings.duration);
  check(res, { 'activate accepted (202)': (r) => r.status === 202 });

  const body = res.json();
  const requestId = body && body.data && body.data.requestId;
  if (!requestId) {
    successRate.add(false);
    return;
  }

  // poll status (cap at ~30s)
  let state = 'processing';
  for (let i = 0; i < 20 && state === 'processing'; i++) {
    sleep(1.5);
    const s = http.get(`${BASE}/status/${requestId}`);
    const sb = s.json();
    state = (sb && sb.data && sb.data.state) || 'processing';
  }
  e2eLatency.add(Date.now() - t0);
  successRate.add(state === 'success');
  check(null, { 'activation reached terminal state': () => state !== 'processing' });
}
