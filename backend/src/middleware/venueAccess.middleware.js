const ipaddr = require('ipaddr.js');
const pool = require('../../db/connection');
const { parsePositiveInteger } = require('../utils/validation');

function normalizeIp(ip) {
    const address = ipaddr.parse(ip);

    if (
        address.kind() === 'ipv6' &&
        address.isIPv4MappedAddress()
    ) {
        return address.toIPv4Address();
    }

    return address;
}

function ipIsAllowed(clientIp, configuredRanges) {
    const clientAddress = normalizeIp(clientIp);

    const ranges = configuredRanges
        .split(',')
        .map((range) => range.trim())
        .filter(Boolean);

    return ranges.some((range) => {
        const [networkAddress, prefixLength] =
            ipaddr.parseCIDR(range);

        return (
            clientAddress.kind() === networkAddress.kind() &&
            clientAddress.match(networkAddress, prefixLength)
        );
    });
}

async function venueAccess(req, res, next) {
    const eventId = parsePositiveInteger(req.params.eventId);

    if (!eventId) {
        return res.status(400).json({
            success: false,
            code: 'INVALID_EVENT_ID',
            message: 'A valid eventId is required for venue access'
        });
    }

    try {
        const result = await pool.query(
            `
                SELECT allowed_ip_ranges, location_enabled
                FROM event_settings
                WHERE event_id = $1
            `,
            [eventId]
        );

        if (result.rowCount === 0) {
            return res.status(503).json({
                success: false,
                code: 'VENUE_ACCESS_NOT_CONFIGURED',
                message: 'Venue access is not configured for this event'
            });
        }

        const {
            allowed_ip_ranges: allowedRanges,
            location_enabled: locationEnabled
        } = result.rows[0];

        if (locationEnabled) {
            return res.status(503).json({
                success: false,
                code: 'LOCATION_CHECK_UNAVAILABLE',
                message:
                    'Location verification is enabled but is not configured by this server'
            });
        }

        if (!allowedRanges || allowedRanges.trim() === '') {
            return res.status(503).json({
                success: false,
                code: 'VENUE_ACCESS_NOT_CONFIGURED',
                message: 'Allowed venue IP ranges have not been configured'
            });
        }

        const clientIp = req.ip;

        if (!clientIp || !ipIsAllowed(clientIp, allowedRanges)) {
            return res.status(403).json({
                success: false,
                code: 'OUTSIDE_VENUE',
                message: 'Voting is only available inside the venue'
            });
        }

        if (process.env.NODE_ENV !== 'production') {
            console.info('[venue-access] request allowed');
        }

        return next();
    } catch (error) {
        console.error('Venue access check failed:', error.message);

        return res.status(503).json({
            success: false,
            code: 'VENUE_ACCESS_UNAVAILABLE',
            message: 'Unable to verify venue access right now'
        });
    }
}

module.exports = venueAccess;
module.exports.ipIsAllowed = ipIsAllowed;