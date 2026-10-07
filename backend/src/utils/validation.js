const ipaddr = require('ipaddr.js');

function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizePhoneNumber(value) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 40) {
    return null;
  }

  const trimmed = value.trim();
  let digits = trimmed.replace(/[\s().-]/g, '');

  if (digits.startsWith('00')) {
    digits = `+${digits.slice(2)}`;
  } else if (/^07[789]\d{7}$/.test(digits)) {
    // Jordanian local numbers such as 079... are stored in E.164 format.
    digits = `+962${digits.slice(1)}`;
  } else if (!digits.startsWith('+')) {
    return null;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(digits)) {
    return null;
  }

  // Do not accept a second identity for a Jordanian mobile with its domestic
  // trunk prefix accidentally retained after the country calling code.
  if (digits.startsWith('+962') && !/^\+9627[789]\d{7}$/.test(digits)) {
    return null;
  }

  return digits;
}

function normalizeAllowedIpRanges(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const ranges = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null;

  if (!ranges || ranges.length === 0 || ranges.length > 50) {
    throw new Error('allowedIpRanges must be a comma-separated string or array of CIDR ranges');
  }

  const normalized = ranges.map((item) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error('Each allowed IP range must be a CIDR string');
    }

    const range = item.trim();
    const [, prefix] = ipaddr.parseCIDR(range);
    if (prefix === 0) {
      throw new Error('Allowed IP ranges must be specific venue networks, not the entire internet');
    }
    return range;
  });

  return normalized.join(',');
}

function parseOptionalDate(value) {
  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Date values must be ISO 8601 strings or null');
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Date values must include an ISO 8601 timezone, such as Z or +03:00');
  }

  const date = new Date(value);
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (Number.isNaN(date.getTime()) || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error('Date value is invalid');
  }

  return date.toISOString();
}

function ipIsAllowed(clientIp, configuredRanges) {
  let address = ipaddr.parse(clientIp);
  if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
    address = address.toIPv4Address();
  }
  if (typeof configuredRanges !== 'string') return false;

  // Validate all ranges before comparing, so malformed configuration never
  // becomes dependent on which valid range happens to appear first.
  const ranges = configuredRanges.split(',').map((range) => {
    let [network, prefix] = ipaddr.parseCIDR(range.trim());
    if (network.kind() === 'ipv6' && network.isIPv4MappedAddress() && prefix >= 96) {
      network = network.toIPv4Address();
      prefix -= 96;
    }
    if (prefix === 0) throw new Error('Unrestricted venue network is not allowed');
    return [network, prefix];
  });
  return ranges.some(([network, prefix]) => (
    address.kind() === network.kind() && address.match(network, prefix)
  ));
}

function validateName(value, fieldName = 'name') {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 255) {
    throw new Error(`${fieldName} must be between 1 and 255 characters`);
  }

  return trimmed;
}

function validateDescription(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string' || value.length > 5000) {
    throw new Error('description must be a string no longer than 5000 characters');
  }

  return value.trim();
}

function validateImageUrl(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string' || value.length > 500) {
    throw new Error('imageUrl must be a URL no longer than 500 characters');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('imageUrl must be an absolute HTTP or HTTPS URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('imageUrl must use HTTP or HTTPS');
  }

  return parsed.toString();
}

module.exports = {
  parsePositiveInteger,
  normalizePhoneNumber,
  normalizeAllowedIpRanges,
  parseOptionalDate,
  validateName,
  validateDescription,
  validateImageUrl,
  ipIsAllowed,
};
