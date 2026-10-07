const { OTP_TTL_SECONDS } = require('./otp');

function otpMessage(otp) {
  return `Your Maker Collective voting verification code is ${otp}. It expires in ${OTP_TTL_SECONDS} seconds.`;
}

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
      Body: otpMessage(otp),
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

// Local mode talks directly to Android; cloud mode reaches it through SMSGate.
class AndroidSmsGatewayProvider {
  constructor() {
    this.mode = process.env.SMSGATE_MODE || 'local';
    if (!['local', 'cloud'].includes(this.mode)) {
      throw new Error('SMSGATE_MODE must be local or cloud');
    }
    this.username = process.env.SMSGATE_USERNAME;
    this.password = process.env.SMSGATE_PASSWORD;
    if (!this.username || !this.password || this.username.includes(':')) {
      throw new Error('Configure SMSGATE_USERNAME and SMSGATE_PASSWORD from the Android app');
    }

    let url;
    try {
      url = new URL(process.env.SMSGATE_BASE_URL || (this.mode === 'cloud' ? 'https://api.sms-gate.app/3rdparty/v1' : ''));
    } catch {
      throw new Error('Configure SMSGATE_BASE_URL with the SMSGate API address');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('SMSGATE_BASE_URL must be an HTTP(S) address without credentials, query, or fragment');
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('SMSGATE_BASE_URL must use HTTPS in production');
    }
    if (this.mode === 'cloud' && url.protocol !== 'https:') {
      throw new Error('SMSGATE_BASE_URL must use HTTPS in cloud mode');
    }
    this.baseUrl = url.href.replace(/\/$/, '');
    this.deviceId = process.env.SMSGATE_DEVICE_ID || undefined;
    if (this.deviceId && (this.mode !== 'cloud' || this.deviceId.length > 128 || /\s/.test(this.deviceId))) {
      throw new Error('SMSGATE_DEVICE_ID must be a cloud device identifier');
    }

    const simNumber = process.env.SMSGATE_SIM_NUMBER;
    if (simNumber && !/^[1-3]$/.test(simNumber)) {
      throw new Error('SMSGATE_SIM_NUMBER must be 1, 2, or 3');
    }
    this.simNumber = simNumber ? Number(simNumber) : undefined;
  }

  async request(path, payload) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
    } catch {
      throw new Error('Unable to reach SMSGate. Check the phone is Online and reachable from the backend');
    }
    // Provider responses may include recipients, OTPs, or credentials.
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`SMSGate rejected the request (HTTP ${response.status})`);
    }
    return response.json().catch(() => {
      throw new Error('SMSGate returned an invalid response');
    });
  }

  async sendOtp(phoneNumber, otp) {
    const result = await this.request(this.mode === 'cloud' ? '/messages' : '/message', {
      textMessage: { text: otpMessage(otp) },
      phoneNumbers: [phoneNumber],
      ttl: OTP_TTL_SECONDS,
      priority: 100,
      withDeliveryReport: true,
      ...(this.simNumber ? { simNumber: this.simNumber } : {}),
      ...(this.deviceId ? { deviceId: this.deviceId } : {}),
    });
    if (!result || typeof result.id !== 'string' || !result.id ||
        !['Pending', 'Processed', 'Sent', 'Delivered'].includes(result.state)) {
      throw new Error('SMSGate did not accept the verification message');
    }
  }

  async checkConnection() {
    if (this.mode === 'cloud') {
      const devices = await this.request('/devices');
      if (!Array.isArray(devices) || devices.some(device => !device || typeof device.id !== 'string')) {
        throw new Error('SMSGate returned an invalid device list');
      }
      const available = devices.filter(device => !this.deviceId || device.id === this.deviceId);
      if (!available.length) {
        throw new Error('No matching Android device is registered. Enable Cloud Server and go Online in SMSGate');
      }
      return { status: 'registered', deviceCount: available.length };
    }
    const result = await this.request('/health');
    if (!result || !['pass', 'warn'].includes(result.status)) {
      throw new Error('SMSGate reports an unhealthy or invalid response. Check the Android app');
    }
    return { status: result.status };
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
  if (providerName === 'smsgate') return new AndroidSmsGatewayProvider();
  throw new Error('SMS_PROVIDER must be console (development only), twilio, or smsgate');
}

module.exports = { getSmsProvider };
