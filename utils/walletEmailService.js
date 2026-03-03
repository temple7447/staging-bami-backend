const { sendEmail } = require('./emailService');

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

const sendWalletCreatedEmail = async (user) => {
  try {
    await sendEmail({
      email: user.email,
      subject: '🎉 Your BamiHustle Wallet Has Been Created!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .highlight { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            .btn { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Wallet Created!</h1>
            </div>
            <div class="content">
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Great news! Your BamiHustle wallet has been successfully created.</p>
              
              <div class="highlight">
                <h3 style="margin-top: 0;">Wallet Details</h3>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Role:</strong> ${user.role}</p>
                <p><strong>Initial Balance:</strong> ${formatCurrency(0)}</p>
              </div>
              
              <p>You can now:</p>
              <ul>
                <li>Receive payments and deposits</li>
                <li>Track your earnings and spending</li>
                <li>Request withdrawals to your bank account</li>
              </ul>
              
              <p>To get started, simply log in to your BamiHustle dashboard.</p>
              
              <div class="footer">
                <p>This is an automated message from BamiHustle. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} BamiHustle. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Wallet Email] Wallet created email sent to ${user.email}`);
    return true;
  } catch (error) {
    console.error(`[Wallet Email] Failed to send wallet created email to ${user.email}:`, error.message);
    return false;
  }
};

const sendDepositEmail = async (user, amount, transaction, description = 'Deposit') => {
  try {
    await sendEmail({
      email: user.email,
      subject: `💰 Deposit Confirmed - ${formatCurrency(amount)}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .amount-box { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 36px; font-weight: bold; color: #11998e; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💰 Deposit Confirmed!</h1>
            </div>
            <div class="content">
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Your wallet has been credited successfully!</p>
              
              <div class="amount-box">
                <div class="amount">${formatCurrency(amount)}</div>
                <p>has been deposited to your wallet</p>
              </div>
              
              <div class="details">
                <h3 style="margin-top: 0;">Transaction Details</h3>
                <p><strong>Transaction Type:</strong> ${description}</p>
                <p><strong>Transaction ID:</strong> ${transaction._id || 'N/A'}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Reference:</strong> ${transaction.reference || 'N/A'}</p>
              </div>
              
              <p><strong>Your new wallet balance:</strong> ${formatCurrency(transaction.newBalance || 0)}</p>
              
              <div class="footer">
                <p>This is an automated message from BamiHustle. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} BamiHustle. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Wallet Email] Deposit email sent to ${user.email} - ${formatCurrency(amount)}`);
    return true;
  } catch (error) {
    console.error(`[Wallet Email] Failed to send deposit email to ${user.email}:`, error.message);
    return false;
  }
};

const sendWithdrawalEmail = async (user, amount, transaction, bankDetails = null) => {
  try {
    await sendEmail({
      email: user.email,
      subject: `💸 Withdrawal Initiated - ${formatCurrency(amount)}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .amount-box { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 36px; font-weight: bold; color: #eb3349; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>💸 Withdrawal Initiated</h1>
            </div>
            <div class="content">
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Your withdrawal request has been initiated.</p>
              
              <div class="amount-box">
                <div class="amount">${formatCurrency(amount)}</div>
                <p>withdrawal request submitted</p>
              </div>
              
              <div class="details">
                <h3 style="margin-top: 0;">Transaction Details</h3>
                <p><strong>Transaction Type:</strong> Withdrawal</p>
                <p><strong>Transaction ID:</strong> ${transaction._id || 'N/A'}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Reference:</strong> ${transaction.reference || 'N/A'}</p>
                ${bankDetails ? `<p><strong>Bank:</strong> ${bankDetails.bankName || 'N/A'}</p>
                <p><strong>Account Number:</strong> ${bankDetails.accountNumber || 'N/A'}</p>
                <p><strong>Account Name:</strong> ${bankDetails.accountName || 'N/A'}</p>` : ''}
              </div>
              
              <p><strong>Your new wallet balance:</strong> ${formatCurrency(transaction.newBalance || 0)}</p>
              
              <p><em>Note: Withdrawal processing typically takes 1-3 business days.</em></p>
              
              <div class="footer">
                <p>This is an automated message from BamiHustle. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} BamiHustle. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Wallet Email] Withdrawal email sent to ${user.email} - ${formatCurrency(amount)}`);
    return true;
  } catch (error) {
    console.error(`[Wallet Email] Failed to send withdrawal email to ${user.email}:`, error.message);
    return false;
  }
};

const sendTransactionNotificationEmail = async (user, transaction, type, amount, description = '') => {
  try {
    const isCredit = ['deposit', 'credit', 'payout', 'refund'].includes(type.toLowerCase());
    const icon = isCredit ? '💰' : '💸';
    const color = isCredit ? '#11998e' : '#eb3349';
    const gradient = isCredit ? 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' : 'linear-gradient(135deg, #eb3349 0%, #f45c43 100%)';
    
    await sendEmail({
      email: user.email,
      subject: `${icon} Transaction Notification - ${formatCurrency(amount)}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: ${gradient}; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .amount-box { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 36px; font-weight: bold; color: ${color}; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>${icon} ${isCredit ? 'Payment Received' : 'Payment Sent'}</h1>
            </div>
            <div class="content">
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>${description || `A ${type} transaction has been processed on your wallet.`}</p>
              
              <div class="amount-box">
                <div class="amount">${isCredit ? '+' : '-'}${formatCurrency(amount)}</div>
                <p>${isCredit ? 'credited to' : 'debited from'} your wallet</p>
              </div>
              
              <div class="details">
                <h3 style="margin-top: 0;">Transaction Details</h3>
                <p><strong>Transaction Type:</strong> ${type}</p>
                <p><strong>Transaction ID:</strong> ${transaction._id || 'N/A'}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Reference:</strong> ${transaction.reference || 'N/A'}</p>
                <p><strong>Status:</strong> ${transaction.status || 'completed'}</p>
              </div>
              
              <p><strong>Current wallet balance:</strong> ${formatCurrency(transaction.newBalance || 0)}</p>
              
              <div class="footer">
                <p>This is an automated message from BamiHustle. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} BamiHustle. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Wallet Email] Transaction notification sent to ${user.email} - ${type}: ${formatCurrency(amount)}`);
    return true;
  } catch (error) {
    console.error(`[Wallet Email] Failed to send transaction email to ${user.email}:`, error.message);
    return false;
  }
};

const sendWalletPayoutEmail = async (user, amount, estateName, type = 'payout') => {
  try {
    await sendEmail({
      email: user.email,
      subject: `🎉 Monthly ${type === 'payout' ? 'Payout' : 'Payment'} Received - ${formatCurrency(amount)}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
            .amount-box { background: white; padding: 25px; border-radius: 8px; margin: 20px 0; text-align: center; }
            .amount { font-size: 36px; font-weight: bold; color: #f5576c; }
            .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 Payment Received!</h1>
            </div>
            <div class="content">
              <p>Hello <strong>${user.name}</strong>,</p>
              <p>Great news! You've received a monthly ${type === 'payout' ? 'payout' : 'payment'} from BamiHustle.</p>
              
              <div class="amount-box">
                <div class="amount">${formatCurrency(amount)}</div>
                <p>has been credited to your wallet</p>
              </div>
              
              <div class="details">
                <h3 style="margin-top: 0;">Payment Details</h3>
                <p><strong>Type:</strong> Monthly ${type === 'payout' ? 'Vendor/Manager Payout' : 'Payment'}</p>
                <p><strong>Estate:</strong> ${estateName || 'N/A'}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
              </div>
              
              <p>Thank you for your continued partnership with BamiHustle!</p>
              
              <div class="footer">
                <p>This is an automated message from BamiHustle. Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} BamiHustle. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
    });
    console.log(`[Wallet Email] Payout email sent to ${user.email} - ${formatCurrency(amount)}`);
    return true;
  } catch (error) {
    console.error(`[Wallet Email] Failed to send payout email to ${user.email}:`, error.message);
    return false;
  }
};

module.exports = {
  sendWalletCreatedEmail,
  sendDepositEmail,
  sendWithdrawalEmail,
  sendTransactionNotificationEmail,
  sendWalletPayoutEmail
};
