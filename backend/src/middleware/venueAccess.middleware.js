const ipaddr = require('ipaddr.js');

function normalizeIp(ip) {
    const address = ipaddr.parse(ip);

    if (address.kind() === 'ipv6' && address.isIPv4MappedAddress()) {
        return address.toIPv4Address();
    }

    return address;
}

function isIpAllowed(clientIp) {
    const allowedRanges = process.env.ALLOWED_IP_RANGES
        .split(',')
        .map(range => range.trim());

    const clientAddress = normalizeIp(clientIp);

    return allowedRanges.some(range => {
        const [networkAddress, prefixLength] = ipaddr.parseCIDR(range);

        if (clientAddress.kind() !== networkAddress.kind()) {
            return false;
        }

        return clientAddress.match(networkAddress, prefixLength);
    });
}

function venueAccess(req, res, next) {
    try {
        const clientIp = req.ip;

        console.log('Client IP:', clientIp);
        console.log('Allowed ranges:', process.env.ALLOWED_IP_RANGES);

        if (!isIpAllowed(clientIp)) {
            return res.status(403).json({
                success: false,
                code: 'OUTSIDE_VENUE',
                message: 'Voting is only available inside the venue'
            });
        }

        next();
    } catch (error) {
        console.error('Venue access error:', error);

        return res.status(403).json({
            success: false,
            code: 'INVALID_IP',
            message: 'Unable to verify venue access'
        });
    }
}

module.exports = venueAccess;