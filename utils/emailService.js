const nodemailer = require('nodemailer');

// Create reusable transporter object using Gmail SMTP
const createTransporter = () => {
  return nodemailer.createTransporter({
    service: process.env.EMAIL_SERVICE,
    port: process.env.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    }
  });
};

// Send email function
exports.sendEmail = async (options) => {
  try {
    const transporter = createTransporter();

    const message = {
      from: `${options.fromName || 'BamiHustle'} <${process.env.EMAIL_FROM}>`,
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html || options.message
    };

    const info = await transporter.sendMail(message);
    
    console.log('Email sent successfully:', info.messageId);
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Email could not be sent');
  }
};

// Welcome email template
exports.sendWelcomeEmail = async (user, temporaryPassword = null) => {
  const message = temporaryPassword 
    ? `
      <h2>Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your admin account has been created successfully.</p>
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
    html: message
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
    html: message
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
    html: message
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
    html: htmlMessage
  });
};