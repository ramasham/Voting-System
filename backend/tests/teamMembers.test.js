const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/connection');
const content = require('../src/controllers/adminContent.controller');
const { validateTeamMembers } = require('../src/utils/validation');

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('team names preserve Arabic, punctuation, and order while trimming whitespace', () => {
  assert.deepEqual(validateTeamMembers(['  عضو تجريبي  ', "Test O'Neil, Jr."]), [
    'عضو تجريبي', "Test O'Neil, Jr.",
  ]);
  assert.deepEqual(validateTeamMembers(undefined), []);
  assert.deepEqual(validateTeamMembers([]), []);
  assert.equal(validateTeamMembers(Array(30).fill('A'.repeat(255))).length, 30);
});

for (const [label, teamMembers] of [
  ['a string instead of an array', 'One member'],
  ['null', null],
  ['a non-string member', ['Valid name', 12]],
  ['a blank member', ['   ']],
  ['an oversized name', ['A'.repeat(256)]],
  ['too many members', Array(31).fill('Test member')],
  ['a multiline name', ['First\nSecond']],
  ['a null character', ['First\0Second']],
]) {
  test(`invalid team members (${label}) are rejected before creating or updating a project`, async (t) => {
    const connect = t.mock.method(pool, 'connect', async () => {
      throw new Error('Validation must run before any database writes');
    });
    for (const handler of [content.createExhibitor, content.updateExhibitor]) {
      const res = response();
      await handler({
        params: { eventId: '1', exhibitorId: '2' },
        body: { name: 'Test project', categoryIds: [1], teamMembers },
      }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
    }
    assert.equal(connect.mock.callCount(), 0);
  });
}
