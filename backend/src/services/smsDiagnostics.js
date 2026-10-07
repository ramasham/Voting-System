const { getSmsProvider, describeSmsFailure } = require('./smsProvider');

// A read-only check makes deployment mistakes visible even before registration.
// SMS failure must not prevent the HTTP server from serving the app.
async function checkSmsOnStartup() {
  if (process.env.SMS_PROVIDER !== 'smsgate') return;
  try {
    const result = await getSmsProvider().checkConnection();
    if (result.status === 'registered') {
      console.info(`SMS startup check: SMSGate cloud authentication succeeded; ${result.deviceCount} registered device(s). No SMS was sent. Registration does not confirm phone availability or delivery.`);
    } else {
      console.info(`SMS startup check: SMSGate phone health is ${result.status}. No SMS was sent.`);
    }
  } catch (error) {
    console.error(`SMS startup check failed: ${describeSmsFailure(error)}`);
  }
}

module.exports = { checkSmsOnStartup };
