function maskPhoneNumber(phoneNumber) {
  return `${phoneNumber.slice(0, 4)}${'*'.repeat(Math.max(0, phoneNumber.length - 6))}${phoneNumber.slice(-2)}`;
}

class DevelopmentConsoleSmsProvider {
  async sendOtp(phoneNumber, otp) {
    console.info(`[development SMS] OTP for ${maskPhoneNumber(phoneNumber)}: ${otp}`);
  }
}

function getSmsProvider() {
  const providerName = process.env.SMS_PROVIDER || 'console';

  if (providerName === 'console' && process.env.NODE_ENV === 'production') {
    throw new Error('The console SMS provider cannot be used in production');
  }

  if (providerName === 'console') {
    return new DevelopmentConsoleSmsProvider();
  }

  throw new Error(`SMS provider "${providerName}" is not configured`);
}

module.exports = { getSmsProvider };
