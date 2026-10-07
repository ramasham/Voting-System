const { recordAuditEvent } = require('../services/auditLog.service');

function auditAdminMutation(req, res, next) {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();

    res.once('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 400) return;
        const action = req.path.replace(/\/\d+(?=\/|$)/g, '/:id');
        const match = req.path.match(/^\/events\/(\d+)(?:\/|$)/);
        void recordAuditEvent('ADMIN_MUTATION', {
            adminId: req.auth?.id,
            eventId: match ? Number(match[1]) : null,
            method: req.method,
            action,
        });
    });
    return next();
}

module.exports = auditAdminMutation;
