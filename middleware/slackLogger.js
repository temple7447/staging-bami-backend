const { sendActivityToSlack } = require('../utils/slackService');

/**
 * Global middleware to log API activity to Slack
 */
const slackLogger = (req, res, next) => {
    // Only log API routes
    if (!req.path.startsWith('/api')) {
        return next();
    }

    // Skip noise (health checks, status checks)
    const skipPaths = ['/api/health', '/api/status', '/api/notifications/count'];
    if (skipPaths.some(path => req.path.includes(path))) {
        return next();
    }

    const start = Date.now();

    // Intercept response finish
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { method, path } = req;
        const { statusCode } = res;

        // Determine color based on status
        let color = '#36a64f'; // Success
        let emoji = '✅';

        if (statusCode >= 400 && statusCode < 500) {
            color = '#FF9800'; // Warning
            emoji = '⚠️';
        } else if (statusCode >= 500) {
            color = '#ff0000'; // Error
            emoji = '🚨';
        }

        // Capture user if authenticated
        const userIdentifier = req.user ? (req.user.name || req.user.email) : 'Anonymous';

        // Send to Slack
        sendActivityToSlack(`${method} ${path}`, {
            status: statusCode,
            user: userIdentifier,
            duration: `${duration}ms`,
            ip: req.ip || 'N/A'
        }, color, emoji);
    });

    next();
};

module.exports = slackLogger;
