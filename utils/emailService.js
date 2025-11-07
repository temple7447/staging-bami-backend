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
  email: process.env.MAILTRAP_SENDER_EMAIL,
  name: process.env.MAILTRAP_SENDER_NAME || 'BamiHustle',
};

// Send email via Mailtrap API
exports.getMailtrapStatus = getMailtrapStatus;

exports.sendEmail = async (options) => {
  try {
    const client = getClient();
    const payload = {
      from: { email: FROM.email, name: options.fromName || FROM.name },
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

// Password reset email
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
      <li>Rent Amount: ${tenant?.rentAmount != null ? tenant.rentAmount : '-'}</li>
      <li>Next Due Date: ${tenant?.nextDueDate ? new Date(tenant.nextDueDate).toDateString() : '-'}</li>
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
