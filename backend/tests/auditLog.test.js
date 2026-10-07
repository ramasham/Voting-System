const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/connection');
const { recordAuditEvent } = require('../src/services/auditLog.service');

test('audit persistence strips phone, OTP and token data from event details', async (t) => {
    let call;
    t.mock.method(pool, 'query', async (...args) => {
        call = args;
        return { rowCount: 1, rows: [] };
    });

    assert.equal(await recordAuditEvent('OTP_FAILED', {
        reason: 'INVALID_OR_EXPIRED',
        phoneNumber: '+962791234567',
        otp: '123456',
        accessToken: 'secret-token',
    }), true);
    assert.equal(call[1][0], 'OTP_FAILED');
    assert.equal(call[1][1], 'visitor');
    assert.equal(call[1][2], null);
    assert.deepEqual(JSON.parse(call[1][4]), { reason: 'INVALID_OR_EXPIRED' });
    assert.doesNotMatch(JSON.stringify(call[1]), /\+962|123456|secret-token/);
});

test('admin audit events persist actor and normalized mutation details', async (t) => {
    let call;
    t.mock.method(pool, 'query', async (...args) => {
        call = args;
        return { rowCount: 1, rows: [] };
    });

    await recordAuditEvent('ADMIN_MUTATION', {
        adminId: 12,
        eventId: 4,
        method: 'PATCH',
        action: '/events/:id/settings',
        password: 'never-persist-this',
    });
    assert.equal(call[1][1], 'admin');
    assert.equal(call[1][2], 12);
    assert.equal(call[1][3], 4);
    assert.deepEqual(JSON.parse(call[1][4]), {
        method: 'PATCH',
        action: '/events/:id/settings',
        eventId: 4,
    });
    assert.doesNotMatch(JSON.stringify(call[1]), /never-persist-this/);
});
