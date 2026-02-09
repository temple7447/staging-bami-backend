const https = require('https');
const { logError, logInfo } = require('./logger');

/**
 * Send a generic message or block-styled message to Slack
 * @param {Object} payload - Slack message payload
 */
const sendSlackMessage = (payload) => {
    const webhookUrl = (process.env.SLACK_WEBHOOK_URL || '').trim();

    if (!webhookUrl || !webhookUrl.startsWith('https://hooks.slack.com/')) {
        logInfo('Slack notification skipped: SLACK_WEBHOOK_URL not configured or invalid');
        return;
    }

    const data = JSON.stringify(payload);

    const url = new URL(webhookUrl);
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            logError('Slack notification failed', new Error(`Status Code: ${res.statusCode}`));
        }
    });

    req.on('error', (error) => {
        logError('Slack notification error', error);
    });

    req.write(data);
    req.end();
};

/**
 * Send OTP alert to Slack
 */
const sendOtpToSlack = (email, code) => {
    const payload = {
        text: `🔑 *New OTP Generated*\nUser: ${email}`,
        attachments: [
            {
                color: '#439FE0',
                fields: [
                    { title: 'User Email', value: email, short: true },
                    { title: 'OTP Code', value: code, short: true },
                    { title: 'Expiry', value: '10 minutes', short: true }
                ]
            }
        ]
    };
    sendSlackMessage(payload);
};

/**
 * Send Transaction alert to Slack
 */
const sendTransactionToSlack = (payment, tenantName, estateName) => {
    const isCompleted = payment.paymentStatus === 'completed';
    const color = isCompleted ? '#36a64f' : '#ff0000';
    const statusEmoji = isCompleted ? '✅' : '❌';

    const payload = {
        text: `${statusEmoji} *New Transaction Recorded*\nEstate: ${estateName || 'N/A'}`,
        attachments: [
            {
                color: color,
                fields: [
                    { title: 'Tenant', value: tenantName || 'N/A', short: true },
                    { title: 'Type', value: payment.paymentType, short: true },
                    { title: 'Amount', value: `₦${payment.amount.toLocaleString()}`, short: true },
                    { title: 'Method', value: payment.paymentMethod, short: true },
                    { title: 'Status', value: payment.paymentStatus, short: true },
                    { title: 'Reference', value: payment.paystackReference || payment.reference || 'N/A', short: true }
                ],
                footer: 'BamiHustle Payment System',
                ts: Math.floor(Date.now() / 1000)
            }
        ]
    };
    sendSlackMessage(payload);
};

/**
 * Send Withdrawal alert to Slack
 */
const sendWithdrawalToSlack = (withdrawal, userEmail, action = 'requested') => {
    const colors = {
        requested: '#439FE0',
        completed: '#36a64f',
        rejected: '#ff0000'
    };

    const statusEmoji = {
        requested: '⏳',
        completed: '🏦',
        rejected: '🚫'
    }[action] || '📢';

    const payload = {
        text: `${statusEmoji} *Withdrawal Update*\nAction: ${action.charAt(0).toUpperCase() + action.slice(1)}`,
        attachments: [
            {
                color: colors[action] || '#cccccc',
                fields: [
                    { title: 'User', value: userEmail, short: true },
                    { title: 'Amount', value: `₦${withdrawal.amount.toLocaleString()}`, short: true },
                    { title: 'Reference', value: withdrawal.reference, short: true },
                    { title: 'Status', value: withdrawal.status, short: true }
                ],
                footer: 'BamiHustle Withdrawal System',
                ts: Math.floor(Date.now() / 1000)
            }
        ]
    };
    sendSlackMessage(payload);
};

/**
 * Send a generic activity alert to Slack
 */
const sendActivityToSlack = (title, details, color = '#cccccc', emoji = '🔔') => {
    const fields = Object.entries(details).map(([key, value]) => ({
        title: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
        value: value?.toString() || 'N/A',
        short: true
    }));

    const payload = {
        text: `${emoji} *${title}*`,
        attachments: [
            {
                color: color,
                fields: fields,
                footer: 'BamiHustle Activity Tracking',
                ts: Math.floor(Date.now() / 1000)
            }
        ]
    };
    sendSlackMessage(payload);
};

module.exports = {
    sendSlackMessage,
    sendOtpToSlack,
    sendTransactionToSlack,
    sendWithdrawalToSlack,
    sendActivityToSlack
};
