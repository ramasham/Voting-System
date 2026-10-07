import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Use a disposable event and one real, OTP-verified visitor token per VU.
// Tokens must be prepared outside the run; the test never bypasses OTP.
const voters = new SharedArray('verified voters', () => JSON.parse(open(__ENV.VOTERS_FILE)));
const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:3000';
export const options = {
    vus: Number(__ENV.VUS || 1000),
    iterations: Number(__ENV.VUS || 1000),
    thresholds: { http_req_failed: ['rate<0.01'], checks: ['rate>0.99'], http_req_duration: ['p(95)<2000'] },
};

export default function () {
    const voter = voters[__VU - 1];
    if (!voter || voter.selections.length !== 3) throw new Error('Provide one token and three selections per VU');
    const params = { headers: { Authorization: `Bearer ${voter.token}`, 'Content-Type': 'application/json' } };
    for (const selection of voter.selections) {
        const response = http.post(`${baseUrl}/api/events/${voter.eventId}/votes`, JSON.stringify(selection), params);
        check(response, { 'vote committed': (r) => r.status === 201 || r.status === 200 });
        sleep(0.1);
    }
    const receipt = http.get(`${baseUrl}/api/events/${voter.eventId}/votes`, params);
    check(receipt, { 'three saved votes': (r) => r.status === 200 && r.json('data').length === 3 });
}
