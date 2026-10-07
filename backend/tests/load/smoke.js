import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: Number(__ENV.VUS || 10),
    duration: __ENV.DURATION || '30s',
    thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1000'] }
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const eventId = __ENV.EVENT_ID || 1;

export default function () {
    const responses = http.batch([
        ['GET', `${baseUrl}/ready`],
        ['GET', `${baseUrl}/api/events/${eventId}/categories`],
        ['GET', `${baseUrl}/api/events/${eventId}/exhibitors`],
    ]);
    for (const response of responses) check(response, { 'read is 200': (r) => r.status === 200 });
    sleep(1);
}
