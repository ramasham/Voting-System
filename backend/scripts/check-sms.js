const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { getSmsProvider } = require('../src/services/smsProvider');

async function main() {
  const provider = getSmsProvider();
  const name = process.env.SMS_PROVIDER || 'console';
  if (name === 'console') {
    console.log('SMS_PROVIDER=console: OTPs appear in the backend terminal; no text messages are sent.');
    console.log('To use your Android phone, configure SMS_PROVIDER=smsgate and SMSGATE_* in backend/.env.');
    return;
  }
  if (name === 'smsgate') {
    const result = await provider.checkConnection();
    if (result.status === 'registered') {
      console.log(`SMSGate cloud authentication succeeded: ${result.deviceCount} registered device(s). No message was sent.`);
      console.log('Device registration does not confirm the phone is Online or that SMS delivery works.');
    } else {
      console.log(`SMSGate phone reachable (health: ${result.status}). No message was sent.`);
    }
    if (result.status === 'warn') console.log('Review health warnings in the Android app before testing delivery.');
    console.log('Next: register through the real frontend and confirm the OTP arrives on the recipient phone.');
    return;
  }
  console.log('Twilio configuration is present. Credentials and delivery have not been checked. No message was sent.');
}

main().catch((error) => {
  console.error(`SMS check failed: ${error.message}`);
  process.exitCode = 1;
});
