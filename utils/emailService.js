const { MailtrapClient } = require('mailtrap');

const ensureMailtrapConfigured = () => {
  const missing = [];
  if (!process.env.MAILTRAP_TOKEN) missing.push('MAILTRAP_TOKEN');
  if (!process.env.MAILTRAP_SENDER_EMAIL) missing.push('MAILTRAP_SENDER_EMAIL');
  if (missing.length) throw new Error(`Missing Mailtrap env vars: ${missing.join(', ')}`);
};

// Expose a status check for startup/health logs
const getMailtrapStatus = () => {
  const missing = [];
  if (!process.env.MAILTRAP_TOKEN) missing.push('MAILTRAP_TOKEN');
  if (!process.env.MAILTRAP_SENDER_EMAIL) missing.push('MAILTRAP_SENDER_EMAIL');
  return { ok: missing.length === 0, missing };
};

const getClient = () => {
  ensureMailtrapConfigured();
  return new MailtrapClient({ token: process.env.MAILTRAP_TOKEN });
};

const FROM = {
  email: process.env.MAILTRAP_SENDER_EMAIL || 'noreply@bamihustle.com',
  name: process.env.MAILTRAP_SENDER_NAME || 'BamiHustle',
};

// Helper to format currency (Nigeria Naira)
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

// Send email via Mailtrap API
exports.getMailtrapStatus = getMailtrapStatus;

exports.sendEmail = async (options) => {
  try {
    // Validate required fields
    if (!options.email) {
      throw new Error('Recipient email is required');
    }
    if (!options.subject) {
      throw new Error('Email subject is required');
    }
    if (!options.html && !options.message) {
      throw new Error('Email body (html or message) is required');
    }
    
    const client = getClient();
    const payload = {
      from: { 
        email: options.from || FROM.email, 
        name: options.fromName || FROM.name 
      },
      to: [{ email: options.email }],
      subject: options.subject,
      text: options.message,
      html: options.html || options.message,
    };
    const resp = await client.send(payload);
    return { success: true, messageId: resp?.message_ids?.[0] || null };
  } catch (error) {
    console.error('Mailtrap send error:', error?.response?.data || error.message || error);
    throw new Error('Email could not be sent');
  }
};

// Welcome email template
exports.sendWelcomeEmail = async (user, temporaryPassword = null) => {
  const message = temporaryPassword 
    ? `
      <h2>Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your account has been created successfully.</p>
      <p><strong>Login Details:</strong></p>
      <p>Email: ${user.email}</p>
      <p>Temporary Password: ${temporaryPassword}</p>
      <p><strong>Important:</strong> Please change your password after your first login for security reasons.</p>
      <p>Login at: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login</p>
      <p>Best regards,<br>BamiHustle Team</p>
    `
    : `
      <h2>Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your account has been created successfully!</p>
      <p>You can now login with your credentials.</p>
      <p>Login at: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login</p>
      <p>Best regards,<br>BamiHustle Team</p>
    `;

  return await this.sendEmail({
    email: user.email,
    subject: 'Welcome to BamiHustle!',
    html: message,
  });
};

// Password reset email (link-based)
exports.sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;

  const message = `
    <h2>Password Reset Request</h2>
    <p>Hello ${user.name},</p>
    <p>You are receiving this email because you (or someone else) has requested a password reset for your account.</p>
    <p>Please click the link below to reset your password:</p>
    <p><a href="${resetUrl}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
    <p>This link will expire in 10 minutes.</p>
    <p>If you did not request this reset, please ignore this email.</p>
    <p>Best regards,<br>BamiHustle Team</p>
  `;

  return await this.sendEmail({
    email: user.email,
    subject: 'Password Reset Request',
    html: message,
  });
};

// OTP password reset email (6-digit)
exports.sendPasswordResetOtpEmail = async (user, code) => {
  const message = `
    <h2>Password Reset Code</h2>
    <p>Hello ${user.name},</p>
    <p>Your password reset code is:</p>
    <p style="font-size: 24px; letter-spacing: 4px;"><strong>${code}</strong></p>
    <p>This code expires in 10 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
    <p>Best regards,<br>BamiHustle Team</p>
  `;

  return await exports.sendEmail({
    email: user.email,
    subject: 'Your Password Reset Code',
    html: message,
  });
};

// Email verification email
exports.sendVerificationEmail = async (user, verificationToken) => {
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${verificationToken}`;

  const message = `
    <h2>Email Verification</h2>
    <p>Hello ${user.name},</p>
    <p>Thank you for registering with BamiHustle!</p>
    <p>Please click the link below to verify your email address:</p>
    <p><a href="${verifyUrl}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
    <p>If you did not create this account, please ignore this email.</p>
    <p>Best regards,<br>BamiHustle Team</p>
  `;

  return await this.sendEmail({
    email: user.email,
    subject: 'Email Verification',
    html: message,
  });
};

// Tenant welcome with credentials and key details
exports.sendTenantWelcomeEmail = async (user, temporaryPassword, tenant, estate) => {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
  const rentAmountFormatted = formatCurrency(tenant?.rentAmount || 0);
  
  const message = `
    <h2>Welcome to ${estate?.name || 'BamiHustle'}</h2>
    <p>Hello ${user.name},</p>
    <p>Your tenant portal account has been created. Use the details below to login:</p>
    <ul>
      <li><strong>Email:</strong> ${user.email}</li>
      <li><strong>Temporary Password:</strong> ${temporaryPassword}</li>
    </ul>
    <p><strong>Unit Details:</strong></p>
    <ul>
      <li>Estate: ${estate?.name || '-'}</li>
      <li>Unit: ${tenant?.unitLabel || '-'}</li>
      <li>Rent Amount: ${rentAmountFormatted}</li>
      <li>Next Due Date: ${tenant?.nextDueDate ? new Date(tenant.nextDueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' }) : '-'}</li>
    </ul>
    <p>Login: <a href="${loginUrl}">${loginUrl}</a></p>
    <p><strong>Important:</strong> Please change your password after first login.</p>
    <p>Best regards,<br>BamiHustle Team</p>
  `;

  return await exports.sendEmail({
    email: user.email,
    subject: 'Your Tenant Portal Account',
    html: message,
  });
};

// Admin notification email
exports.sendAdminNotificationEmail = async (adminEmail, subject, message) => {
  const htmlMessage = `
    <h2>${subject}</h2>
    <p>${message}</p>
    <p>This is an automated notification from BamiHustle.</p>
    <p>Best regards,<br>BamiHustle System</p>
  `;

  return await this.sendEmail({
    email: adminEmail,
    subject: `[BamiHustle] ${subject}`,
    html: htmlMessage,
  });
};

// Tenant rent due reminder email
exports.sendRentReminder = async (tenant, estate, daysRemaining) => {
  const formattedDate = new Date(tenant.nextDueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
  const rentAmountFormatted = formatCurrency(tenant.rentAmount);
  
  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #007bff;">Rent Payment Reminder</h2>
      <p>Hello ${tenant.tenantName},</p>
      <p>This is a friendly reminder that your rent payment is due in <strong>${daysRemaining} day(s)</strong>.</p>
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Payment Details:</strong></p>
        <p><strong>Estate:</strong> ${estate.name}</p>
        <p><strong>Unit:</strong> ${tenant.unitLabel}</p>
        <p><strong>Rent Amount:</strong> ${rentAmountFormatted}</p>
        <p><strong>Due Date:</strong> ${formattedDate}</p>
      </div>
      <p>Please ensure your payment is made on or before the due date to avoid any penalties.</p>
      <p>If you have already made this payment, please disregard this reminder.</p>
      <p>For any queries, please contact your estate management.</p>
      <p>Best regards,<br><strong>BamiHustle Management System</strong></p>
    </div>
  `;

  return await this.sendEmail({
    email: tenant.tenantEmail,
    subject: `Rent Payment Reminder - ${daysRemaining} Day(s) Until Due Date`,
    html: message
  });
};

// Admin rent due reminder email
exports.sendAdminRentReminder = async (adminEmail, tenant, estate, daysRemaining) => {
  const formattedDate = new Date(tenant.nextDueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
  const rentAmountFormatted = formatCurrency(tenant.rentAmount);
  
  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #ffc107;">Upcoming Rent Payment Alert</h2>
      <p>Hello Admin,</p>
      <p>The following tenant has an upcoming rent payment due in <strong>${daysRemaining} day(s)</strong>.</p>
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <p><strong>Tenant Details:</strong></p>
        <p><strong>Name:</strong> ${tenant.tenantName}</p>
        <p><strong>Email:</strong> ${tenant.tenantEmail || 'N/A'}</p>
        <p><strong>Phone:</strong> ${tenant.tenantPhone || 'N/A'}</p>
        <p><strong>Estate:</strong> ${estate.name}</p>
        <p><strong>Unit:</strong> ${tenant.unitLabel}</p>
        <p><strong>Rent Amount:</strong> ${rentAmountFormatted}</p>
        <p><strong>Due Date:</strong> ${formattedDate}</p>
        <p><strong>Status:</strong> ${tenant.status}</p>
      </div>
      <p>This is an automated alert from BamiHustle Management System.</p>
      <p>Best regards,<br><strong>BamiHustle System</strong></p>
    </div>
  `;

  return await this.sendEmail({
    email: adminEmail,
    subject: `[BamiHustle Alert] Upcoming Rent Payment - ${daysRemaining} Day(s) - ${tenant.tenantName}`,
    html: message
  });
};
