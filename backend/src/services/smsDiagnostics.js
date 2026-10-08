const { getSmsProvider, describeSmsFailure } = require('./smsProvider');
const activeChecks = new Set();
const MAX_ACTIVE_CHECKS = 200;
const TERMINAL_STATES = new Set(['Delivered', 'Failed', 'Cancelled']);

function stopSmsDeliveryChecks() {
  for (const check of activeChecks) clearTimeout(check.timer);
  activeChecks.clear();
}

function logDeliveryStatus(verificationId, status) {
  const detail = status.reason ? ` (${status.reason})` : '';
  console.info(`SMS delivery status (verification ${verificationId}): ${status.state}${detail}`);
}

// Poll only the already accepted message. This never resends or extends an OTP.
function trackSmsDelivery(provider, message, verificationId) {
  if (provider.mode !== 'cloud' || !message || !Number.isSafeInteger(verificationId)) return;
  console.info(`SMS submission accepted (verification ${verificationId}): ${message.state}. Acceptance does not confirm delivery.`);
  if (TERMINAL_STATES.has(message.state)) return;
  if (activeChecks.size >= MAX_ACTIVE_CHECKS) {
    console.info(`SMS delivery check skipped (verification ${verificationId}): diagnostic capacity reached.`);
    return;
  }
  const check = { timer: null };
  activeChecks.add(check);
  function schedule(delay, finalCheck) {
    check.timer = setTimeout(async () => {
      try {
        const status = await provider.getMessageStatus(message.id);
        if (!activeChecks.has(check)) return;
        logDeliveryStatus(verificationId, status);
        if (!finalCheck && !TERMINAL_STATES.has(status.state)) {
          schedule(30000, true);
          return;
        }
      } catch (error) {
        if (activeChecks.has(check)) {
          console.error(`SMS delivery check failed (verification ${verificationId}): ${describeSmsFailure(error)}`);
        }
      }
      activeChecks.delete(check);
    }, delay);
    check.timer.unref?.();
  }
  schedule(15000, false);
}

// A read-only check makes deployment mistakes visible even before registration.
// SMS failure must not prevent the HTTP server from serving the app.
async function checkSmsOnStartup() {
  if (process.env.SMS_PROVIDER !== 'smsgate') return;
  try {
    const provider = getSmsProvider();
    const result = await provider.checkConnection();
    if (result.status === 'registered') {
      console.info(`SMS startup check: SMSGate cloud authentication succeeded; ${result.deviceCount} registered device(s). No SMS was sent. Registration does not confirm phone availability or delivery.`);
      try {
        const latest = await provider.getLatestMessageStatus();
        if (latest) {
          console.info(`SMS latest message status: ${latest.state}${latest.reason ? ` (${latest.reason})` : ''}. This is the account/device's most recent outgoing message.`);
        } else {
          console.info('SMS latest message check: no outgoing messages found for this account/device. A queued OTP will produce an SMS submission accepted log.');
        }
      } catch (error) {
        console.error(`SMS latest message check failed: ${describeSmsFailure(error)}`);
      }
    } else {
      console.info(`SMS startup check: SMSGate phone health is ${result.status}. No SMS was sent.`);
    }
  } catch (error) {
    console.error(`SMS startup check failed: ${describeSmsFailure(error)}`);
  }
}

module.exports = { checkSmsOnStartup, trackSmsDelivery, stopSmsDeliveryChecks };
