const { VoteError, castVote } = require('../services/vote.service');
const { publishResultsUpdated } = require('../services/resultsNotifier');

function restErrorCode(code) {
  if (code === 'PHONE_NOT_VERIFIED') return 'PHONE_VERIFICATION_REQUIRED';
  if (code === 'INVALID_CATEGORY' || code === 'INVALID_EXHIBITOR') {
    return 'INVALID_CATEGORY_EXHIBITOR';
  }
  return code;
}

async function castVoteController(req, res) {
  try {
    const vote = await castVote({
      eventId: req.params.eventId,
      categoryId: req.body?.categoryId,
      exhibitorId: req.body?.exhibitorId,
      visitorId: req.auth.id,
      clientIp: req.ip
    });

    const response = res.status(201).json({ success: true, data: vote });
    publishResultsUpdated(vote.event_id);
    return response;
  } catch (error) {
    if (error instanceof VoteError) {
      return res.status(error.status).json({
        success: false,
        code: restErrorCode(error.code),
        message: error.message
      });
    }

    console.error('Vote creation failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to record vote'
    });
  }
}

module.exports = { castVote: castVoteController };
