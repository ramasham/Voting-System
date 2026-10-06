const ipaddr = require('ipaddr.js');

function configuredRanges() {
    const value = process.env.ALLOWED_IP_RANGES;
    if (!value || !value.trim()) throw new Error('ALLOWED_IP_RANGES is not configured');

    return value.split(',').map((range) => {
        const trimmed = range.trim();
        if (!trimmed) throw new Error('ALLOWED_IP_RANGES contains an empty range');
        return ipaddr.parseCIDR(trimmed);
    });
}

function normalizeIp(ip) {
    const address = ipaddr.parse(ip);
    return address.kind() === 'ipv6' && address.isIPv4MappedAddress()
        ? address.toIPv4Address()
        : address;
}

function venueAccess(req, res, next) {
    let ranges;
    try {
        ranges = configuredRanges();
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.error(`[venue-access] configuration error: ${error.message}`);
        }
        return res.status(503).json({
            success: false,
            code: 'VENUE_ACCESS_UNAVAILABLE',
            message: 'Venue access cannot be verified'
        });
    }

    try {
        const clientAddress = normalizeIp(req.ip);
        const allowed = ranges.some(([network, prefix]) =>
            clientAddress.kind() === network.kind() && clientAddress.match(network, prefix)
        );

        if (!allowed) {
            if (process.env.NODE_ENV !== 'production') console.info('[venue-access] request denied');
            return res.status(403).json({
                success: false,
                code: 'OUTSIDE_VENUE',
                message: 'Voting is only available inside the venue'
            });
        }

        if (process.env.NODE_ENV !== 'production') console.info('[venue-access] request allowed');
        return next();
    } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.error(`[venue-access] client IP could not be verified: ${error.message}`);
        }
        return res.status(403).json({
            success: false,
            code: 'OUTSIDE_VENUE',
            message: 'Voting is only available inside the venue'
        });
    }
}

module.exports = venueAccess;
