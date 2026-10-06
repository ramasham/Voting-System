import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 10,
    duration: '30s',
    thresholds: { http_req_failed: ['rate<0.05'] }
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export default function () {
    const health = http.get(`${baseUrl}/health`);
    check(health, { 'health is 200': (response) => response.status === 200 });

    const results = http.get(`${baseUrl}/api/results`);
    check(results, { 'results is 200': (response) => response.status === 200 });
    sleep(1);
}
