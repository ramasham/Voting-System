const { castVote, getVisitorVotes, VoteError } = require('../services/vote.service');
const { recordAuditEvent } = require('../services/auditLog.service');

function fail(req, res, error, auditVote = false) {
  if (auditVote) {
    void recordAuditEvent('VOTE_REJECTED', {
      eventId: req.params.eventId,
      categoryId: req.body?.categoryId,
      exhibitorId: req.body?.exhibitorId,
      reason: error instanceof VoteError ? error.code : 'VOTE_FAILED',
    });
  }
  if (error instanceof VoteError) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }

  console.error('Vote request failed:', error.message);
  return res.status(500).json({ success: false, message: 'Unable to process votes' });
}

async function castVoteController(req, res) {
  try {
    const vote = await castVote({
      eventId: req.params.eventId,
      categoryId: req.body?.categoryId,
      exhibitorId: req.body?.exhibitorId,
      visitorId: req.auth.id,
      clientIp: req.ip,
      coordinates: req.body?.location,
    });
    if (!vote.replayed) {
      await recordAuditEvent('VOTE_SUCCESS', {
        eventId: vote.event_id,
        categoryId: vote.category_id,
        exhibitorId: vote.exhibitor_id,
      });
    }

    return res.status(vote.replayed ? 200 : 201).json({ success: true, data: vote });
  } catch (error) {
    return fail(req, res, error, true);
  }
}

async function getVotes(req, res) {
  try {
    const votes = await getVisitorVotes({ eventId: req.params.eventId, visitorId: req.auth.id });
    return res.status(200).json({ success: true, data: votes });
  } catch (error) {
    return fail(req, res, error);
  }
}

module.exports = { castVote: castVoteController, getVotes };
