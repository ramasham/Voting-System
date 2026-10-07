function maskPhoneNumber(phoneNumber) {
  return `${phoneNumber.slice(0, 4)}${'*'.repeat(Math.max(0, phoneNumber.length - 6))}${phoneNumber.slice(-2)}`;
}

class DevelopmentConsoleSmsProvider {
  async sendOtp(phoneNumber, otp) {
    console.info(`[development SMS] OTP for ${maskPhoneNumber(phoneNumber)}: ${otp}`);
  }
}

class TwilioSmsProvider {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.from = process.env.TWILIO_FROM_NUMBER;
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    if (!/^AC[0-9a-f]{32}$/i.test(this.accountSid || '') || !this.authToken) {
      throw new Error('Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN for SMS delivery');
    }
    if (!this.from && !this.messagingServiceSid) {
      throw new Error('Configure TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID for SMS delivery');
    }
  }

  async sendOtp(phoneNumber, otp) {
    const body = new URLSearchParams({
      To: phoneNumber,
      Body: `Your Maker Collective voting verification code is ${otp}. It expires in 5 minutes.`,
    });
    if (this.messagingServiceSid) body.set('MessagingServiceSid', this.messagingServiceSid);
    else body.set('From', this.from);

    // Never log the request, provider response body, recipient, or credentials.
    // Provider errors can contain the complete destination phone number.
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SMS provider rejected the request (HTTP ${response.status})`);
    }
    const result = await response.json().catch(() => {
      throw new Error('SMS provider returned an invalid response');
    });
    if (!result.sid || result.error_code || ['failed', 'undelivered', 'canceled'].includes(result.status)) {
      throw new Error('SMS provider did not accept the verification message');
    }
  }
}

function getSmsProvider() {
  const providerName = process.env.SMS_PROVIDER || 'console';
  if (providerName === 'console') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('The console SMS provider cannot be used in production');
    }
    return new DevelopmentConsoleSmsProvider();
  }
  if (providerName === 'twilio') return new TwilioSmsProvider();
  throw new Error('SMS_PROVIDER must be console (development only) or twilio');
}

module.exports = { getSmsProvider };
