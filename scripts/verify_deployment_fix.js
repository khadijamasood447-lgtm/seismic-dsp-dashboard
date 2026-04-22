const fetch = require('node-fetch');

const BASE_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

async function verify() {
  console.log(`Starting verification for ${BASE_URL}...`);

  const tests = [
    { name: 'Health Check', url: '/api/health', expectedStatus: 200 },
    { name: 'AOI Boundary', url: '/api/aoi/boundary', expectedStatus: 200 },
    { name: 'Reports List', url: '/api/reports', expectedStatus: 200 },
    { name: 'Chat Stream (POST)', url: '/api/chat/stream', method: 'POST', body: { message: 'ping' }, expectedStatus: 200 },
  ];

  for (const test of tests) {
    try {
      const options = {
        method: test.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': 'verification-test',
        },
      };
      if (test.body) options.body = JSON.stringify(test.body);

      const res = await fetch(`${BASE_URL}${test.url}`, options);
      console.log(`[${test.name}] Status: ${res.status} ${res.status === test.expectedStatus ? '✅' : '❌'}`);
      
      if (res.status === 200) {
        const json = await res.json().catch(() => ({}));
        console.log(`[${test.name}] Response:`, JSON.stringify(json).slice(0, 100) + '...');
      }
    } catch (e) {
      console.log(`[${test.name}] Failed: ${e.message} ❌`);
    }
  }
}

verify();
