const { MailtrapClient } = require('mailtrap');
const PDFDocument = require('pdfkit');

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
  // Create a NEW instance each time to avoid token caching issues
  return new MailtrapClient({ token: process.env.MAILTRAP_TOKEN });
};

const FROM = {
  email: process.env.MAILTRAP_SENDER_EMAIL || 'noreply@bamihost.com',
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

// Helper to format currency for PDF (PDFKit doesn't support ₦ symbol)
const formatCurrencyForPDF = (amount) => {
  const formatted = new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
  return `N ${formatted}`; // Using 'N' instead of '₦' for PDF compatibility
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

    // Debug: Log token info (first 8 chars for security)
    console.log('[EMAIL DEBUG] Token prefix:', process.env.MAILTRAP_TOKEN?.substring(0, 8) || 'MISSING');
    console.log('[EMAIL DEBUG] Sending to:', options.email);
    console.log('[EMAIL DEBUG] Subject:', options.subject);

    const client = getClient();

    // Support multiple recipients (comma separated string or array)
    let recipients = [];
    if (Array.isArray(options.email)) {
      recipients = options.email.map(email => ({ email }));
    } else if (typeof options.email === 'string') {
      recipients = options.email.split(',').map(email => ({ email: email.trim() }));
    } else {
      recipients = [{ email: options.email }];
    }

    const payload = {
      from: {
        email: options.from || FROM.email,
        name: options.fromName || FROM.name
      },
      to: recipients,
      subject: options.subject,
      text: options.message,
      html: options.html || options.message,
    };

    if (options.attachments) {
      payload.attachments = options.attachments;
    }

    const resp = await client.send(payload);
    console.log('[EMAIL DEBUG] Success! Message ID:', resp?.message_ids?.[0]);
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

// Tenant rent due reminder email (handles both upcoming and overdue)
exports.sendRentReminder = async (tenant, estate, daysRemaining) => {
  const formattedDate = new Date(tenant.nextDueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
  const rentAmountFormatted = formatCurrency(tenant.rentAmount);

  const isOverdue = daysRemaining < 0;
  const daysOverdue = Math.abs(daysRemaining);

  const message = isOverdue ? `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #dc3545;">⚠️ URGENT: Rent Payment Overdue</h2>
      <p>Hello ${tenant.tenantName},</p>
      <p style="color: #dc3545; font-weight: bold;">Your rent payment is now <strong>${daysOverdue} day(s) OVERDUE</strong>.</p>
      <div style="background-color: #fff3cd; border-left: 4px solid #dc3545; padding: 20px; margin: 20px 0;">
        <p><strong>Payment Details:</strong></p>
        <p><strong>Estate:</strong> ${estate.name}</p>
        <p><strong>Unit:</strong> ${tenant.unitLabel}</p>
        <p><strong>Rent Amount:</strong> ${rentAmountFormatted}</p>
        <p><strong>Due Date:</strong> ${formattedDate}</p>
        <p style="color: #dc3545;"><strong>Days Overdue:</strong> ${daysOverdue}</p>
      </div>
      <p><strong>IMMEDIATE ACTION REQUIRED:</strong> Please make this payment as soon as possible to avoid additional penalties and legal action.</p>
      <p>If you have made this payment, please contact estate management immediately with proof of payment.</p>
      <p>For payment arrangements or queries, please contact your estate management urgently.</p>
      <p>Best regards,<br><strong>BamiHustle Management System</strong></p>
    </div>
  ` : `
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

  const subject = isOverdue
    ? `⚠️ URGENT: Rent Payment ${daysOverdue} Day(s) OVERDUE`
    : `Rent Payment Reminder - ${daysRemaining} Day(s) Until Due Date`;

  return await this.sendEmail({
    email: tenant.tenantEmail,
    subject,
    html: message
  });
};

// Admin rent due reminder email (handles both upcoming and overdue)
exports.sendAdminRentReminder = async (adminEmail, tenant, estate, daysRemaining) => {
  const formattedDate = new Date(tenant.nextDueDate).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
  const rentAmountFormatted = formatCurrency(tenant.rentAmount);

  const isOverdue = daysRemaining < 0;
  const daysOverdue = Math.abs(daysRemaining);

  const message = isOverdue ? `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #dc3545;">⚠️ OVERDUE RENT PAYMENT ALERT</h2>
      <p>Hello Admin,</p>
      <p style="color: #dc3545; font-weight: bold;">The following tenant's rent payment is now <strong>${daysOverdue} day(s) OVERDUE</strong>.</p>
      <div style="background-color: #fff3cd; border-left: 4px solid #dc3545; padding: 20px; margin: 20px 0;">
        <p><strong>Tenant Details:</strong></p>
        <p><strong>Name:</strong> ${tenant.tenantName}</p>
        <p><strong>Email:</strong> ${tenant.tenantEmail || 'N/A'}</p>
        <p><strong>Phone:</strong> ${tenant.tenantPhone || 'N/A'}</p>
        <p><strong>Estate:</strong> ${estate.name}</p>
        <p><strong>Unit:</strong> ${tenant.unitLabel}</p>
        <p><strong>Rent Amount:</strong> ${rentAmountFormatted}</p>
        <p><strong>Due Date:</strong> ${formattedDate}</p>
        <p style="color: #dc3545;"><strong>Days Overdue:</strong> ${daysOverdue}</p>
        <p><strong>Status:</strong> ${tenant.status}</p>
      </div>
      <p><strong>Recommended Action:</strong> Please follow up with the tenant immediately regarding this overdue payment.</p>
      <p>This is an automated alert from BamiHustle Management System.</p>
      <p>Best regards,<br><strong>BamiHustle System</strong></p>
    </div>
  ` : `
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

  const subject = isOverdue
    ? `[BamiHustle Alert] ⚠️ OVERDUE: ${daysOverdue} Day(s) - ${tenant.tenantName}`
    : `[BamiHustle Alert] Upcoming Rent Payment - ${daysRemaining} Day(s) - ${tenant.tenantName}`;

  return await this.sendEmail({
    email: adminEmail,
    subject,
    html: message
  });
};

// Business Owner welcome email with credentials and assigned estates
exports.sendBusinessOwnerWelcomeEmail = async (user, temporaryPassword, assignedEstates = []) => {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

  const estatesList = assignedEstates.length > 0
    ? assignedEstates.map(estate => `<li>${estate.name} (${estate.totalUnits} units)</li>`).join('')
    : '<li>No estates assigned yet</li>';

  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #007bff;">Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your <strong>Business Owner</strong> account has been successfully created.</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🔐 Login Credentials</h3>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Temporary Password:</strong> <span style="background: #fff; padding: 5px 10px; border: 1px solid #ddd; font-family: monospace;">${temporaryPassword}</span></p>
        ${user.phone ? `<p><strong>Phone:</strong> ${user.phone}</p>` : ''}
      </div>

      <div style="background-color: #e7f3ff; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🏘️ Your Estates</h3>
        <ul style="margin: 10px 0;">
          ${estatesList}
        </ul>
      </div>

      <p><a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Login to Dashboard</a></p>
      
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0;"><strong>⚠️ Important Security Notice:</strong></p>
        <p style="margin: 5px 0 0 0;">Please change your password immediately after your first login for security reasons.</p>
      </div>

      <p>As a business owner, you have full access to manage your assigned estates, tenants, units, and view comprehensive analytics.</p>
      
      <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
      
      <p>Best regards,<br><strong>BamiHustle Team</strong></p>
    </div>
  `;

  return await exports.sendEmail({
    email: user.email,
    subject: 'Welcome to BamiHustle - Your Business Owner Account',
    html: message,
  });
};

// Vendor welcome email with credentials
exports.sendVendorWelcomeEmail = async (user, temporaryPassword, additionalInfo = {}) => {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #007bff;">Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your <strong>Vendor</strong> account has been successfully created.</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🔐 Login Credentials</h3>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Temporary Password:</strong> <span style="background: #fff; padding: 5px 10px; border: 1px solid #ddd; font-family: monospace;">${temporaryPassword}</span></p>
        ${user.phone ? `<p><strong>Phone:</strong> ${user.phone}</p>` : ''}
      </div>

      ${additionalInfo.businessType ? `
      <div style="background-color: #e7f3ff; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">📋 Vendor Information</h3>
        <p><strong>Business Type:</strong> ${additionalInfo.businessType}</p>
        ${additionalInfo.businessName ? `<p><strong>Business Name:</strong> ${additionalInfo.businessName}</p>` : ''}
        ${additionalInfo.specialization ? `<p><strong>Specialization:</strong> ${additionalInfo.specialization}</p>` : ''}
      </div>
      ` : ''}

      <p><a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Login to Portal</a></p>
      
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0;"><strong>⚠️ Important Security Notice:</strong></p>
        <p style="margin: 5px 0 0 0;">Please change your password immediately after your first login for security reasons.</p>
      </div>

      <p>As a vendor, you can access the tenant portal to view your profile and receive updates.</p>
      
      <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
      
      <p>Best regards,<br><strong>BamiHustle Team</strong></p>
    </div>
  `;

  return await exports.sendEmail({
    email: user.email,
    subject: 'Welcome to BamiHustle - Your Vendor Account',
    html: message,
  });
};

// Manager welcome email with credentials and assigned estates
exports.sendManagerWelcomeEmail = async (user, temporaryPassword, assignedEstates = []) => {
  const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;

  const estatesList = assignedEstates.length > 0
    ? assignedEstates.map(estate => `<li>${estate.name} (${estate.totalUnits} units)</li>`).join('')
    : '<li>No estates assigned yet</li>';

  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <h2 style="color: #007bff;">Welcome to BamiHustle!</h2>
      <p>Hello ${user.name},</p>
      <p>Your <strong>Manager</strong> account has been successfully created.</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🔐 Login Credentials</h3>
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Temporary Password:</strong> <span style="background: #fff; padding: 5px 10px; border: 1px solid #ddd; font-family: monospace;">${temporaryPassword}</span></p>
        ${user.phone ? `<p><strong>Phone:</strong> ${user.phone}</p>` : ''}
      </div>

      <div style="background-color: #e7f3ff; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🏘️ Your Assigned Estates</h3>
        <ul style="margin: 10px 0;">
          ${estatesList}
        </ul>
      </div>

      <p><a href="${loginUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Login to Dashboard</a></p>
      
      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <p style="margin: 0;"><strong>⚠️ Important Security Notice:</strong></p>
        <p style="margin: 5px 0 0 0;">Please change your password immediately after your first login for security reasons.</p>
      </div>

      <p>As a manager, you have access to manage your assigned estates, tenants, units, and view analytics for the properties under your supervision.</p>
      
      <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
      
      <p>Best regards,<br><strong>BamiHustle Team</strong></p>
    </div>
  `;

  return await exports.sendEmail({
    email: user.email,
    subject: 'Welcome to BamiHustle - Your Manager Account',
    html: message,
  });
};

// Helper to generate PDF Receipt
// receiptData: pre-calculated object with all financial figures
exports.generateReceiptPdf = (receiptData, tenant, estate) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Format numeric values for PDF display
      const data = {
        paymentDate: receiptData.paymentDate,
        moveInDate: receiptData.moveInDate,
        expiryDate: receiptData.expiryDate,
        currentYear: receiptData.currentYear,
        nextYear: receiptData.nextYear,
        yearDuration: receiptData.yearDuration,
        tenancyDuration: receiptData.tenancyDuration || '1 YEAR',
        tenantTotalStay: receiptData.tenantTotalStay || '1st YEAR',
        rentAmount: formatCurrencyForPDF(receiptData.rentAmount),
        rentOutstanding: formatCurrencyForPDF(receiptData.rentOutstanding),
        serviceCharge: formatCurrencyForPDF(receiptData.serviceCharge),
        serviceChargeOutstanding: formatCurrencyForPDF(receiptData.serviceChargeOutstanding),
        cautionFee: formatCurrencyForPDF(receiptData.cautionFee),
        legalFee: formatCurrencyForPDF(receiptData.legalFee),
        outstandingBalance: formatCurrencyForPDF(receiptData.outstandingBalance),
        currentTotalTenancyRate: formatCurrencyForPDF(receiptData.currentTotalTenancyRate),
        nextTotalTenancyRate: formatCurrencyForPDF(receiptData.nextTotalTenancyRate),
        nextIncreaseDate: receiptData.nextIncreaseDate,
        nextRentIncrease: formatCurrencyForPDF(receiptData.nextRentIncrease),
        nextServiceChargeIncrease: formatCurrencyForPDF(receiptData.nextServiceChargeIncrease),
        totalTenancyRateIncrease: formatCurrencyForPDF(receiptData.totalTenancyRateIncrease)
      };

      const doc = new PDFDocument({ size: 'A4', margin: 30 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      const pageWidth = 595.28;
      const leftMargin = 30;
      const rightMargin = 30;
      const contentWidth = pageWidth - leftMargin - rightMargin;

      // Header Section
      doc.save();
      doc.font('Helvetica-Bold').fontSize(22).fillColor('#4472c4').text('SAMFRED', leftMargin, 35);
      doc.fontSize(16).text('GLOBAL RESOURCES LTD', leftMargin, 58, { underline: true });
      doc.font('Helvetica').fontSize(12).fillColor('#000000').text('BALADO ESTATE MASON IFIE OFF MATRIX DEPOT', leftMargin, 85);
      doc.text(`Tel: 07052258160, 0905665358`, leftMargin, 105);

      // Logo Placeholder (Matching style in image)
      const logoX = pageWidth - rightMargin - 80;
      doc.rect(logoX, 35, 80, 80).lineWidth(2).strokeColor('#2c5aa0').fill('#0056b3');
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold').text('SAM FRED', logoX, 60, { width: 80, align: 'center' }).text('LOGO', logoX, 72, { width: 80, align: 'center' });

      doc.fillColor('#000000').fontSize(10).font('Helvetica').text('1 BED ROOM', logoX, 125, { width: 80, align: 'right' }).text('2 BED ROOMS', logoX, 137, { width: 80, align: 'right' }).text('3 BED ROOMS', logoX, 149, { width: 80, align: 'right' });
      doc.restore();

      // Receipt Title and Date
      doc.rect(leftMargin, 175, 100, 25).fill('#e7e6e6');
      doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text('RECEIPT', leftMargin + 5, 180);
      doc.text(`DATE: ${data.paymentDate}`, pageWidth - rightMargin - 200, 180, { width: 200, align: 'right' });

      doc.moveTo(leftMargin, 205).lineTo(pageWidth - rightMargin, 205).lineWidth(2).strokeColor('#000000').stroke();

      let currentY = 215;
      const col1Width = 260;
      const col2Width = contentWidth - col1Width;
      const rowHeight = 22;

      const drawReceiptRow = (label, value, options = {}) => {
        const { labelColor = '#4472c4', valueColor = '#4472c4', bold = true } = options;

        doc.rect(leftMargin, currentY, col1Width, rowHeight).strokeColor('#999999').lineWidth(0.5).stroke();
        doc.rect(leftMargin + col1Width, currentY, col2Width, rowHeight).strokeColor('#999999').lineWidth(0.5).stroke();

        doc.font('Helvetica-Bold').fontSize(11).fillColor(labelColor).text(label, leftMargin + 8, currentY + 6);
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(valueColor).text(value || '', leftMargin + col1Width + 8, currentY + 6);

        currentY += rowHeight;
      };

      drawReceiptRow('TENANT FULL NAME:', tenant.tenantName);
      drawReceiptRow('BEDROOM TYPE:', tenant.unitLabel || 'Standard');
      drawReceiptRow('FLAT TYPE:', tenant.unitLabel);
      drawReceiptRow('MOVE IN DATE:', data.moveInDate);
      drawReceiptRow('EXPIRY DATE:', data.expiryDate);
      drawReceiptRow('RENT:', data.rentAmount);
      drawReceiptRow('RENT OUTSTANDING:', data.rentOutstanding, { valueColor: '#ff0000' });
      drawReceiptRow('SERVICE CHARGE:', data.serviceCharge);
      drawReceiptRow('SERVICE CHARGE OUTSTANDING:', data.serviceChargeOutstanding, { valueColor: '#ff0000' });
      drawReceiptRow('1 TIME CAUTION FEE:', data.cautionFee);
      drawReceiptRow('1 TIME LEGAL FEE:', data.legalFee);
      drawReceiptRow('OUTSTANDING BALANCE:', data.outstandingBalance, { valueColor: '#ff0000' });
      drawReceiptRow(`CURRENT TOTAL TENANCY RATE: ${data.currentYear}`, data.currentTotalTenancyRate, { labelColor: '#70ad47', valueColor: '#70ad47' });
      drawReceiptRow(`NEXT TOTAL TENANCY RATE ${data.nextYear}:`, data.nextTotalTenancyRate, { labelColor: '#ffc000', valueColor: '#ffc000' });
      drawReceiptRow('TENANCY DURATION:', data.tenancyDuration);
      drawReceiptRow('TENANT TOTAL STAY:', data.tenantTotalStay);
      drawReceiptRow('YEAR DURATION', data.yearDuration);
      drawReceiptRow(`NEXT RENTAL INCREASE BY (26%) ON ${data.nextIncreaseDate}:`, data.nextRentIncrease, { labelColor: '#ff0000', valueColor: '#ff0000' });
      drawReceiptRow(`NEXT SERVICE CHARGE INCREASE BY (26%) ${data.nextIncreaseDate}:`, data.nextServiceChargeIncrease, { labelColor: '#ff0000', valueColor: '#ff0000' });
      drawReceiptRow(`TOTAL TENANCY RATE INCREASE BY (26%) ON ${data.nextIncreaseDate}:`, data.totalTenancyRateIncrease, { labelColor: '#ff0000', valueColor: '#ff0000' });

      // Footer Notice
      currentY += 20;
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#ff0000').text('Important Notice Regarding Rent Adjustment', leftMargin, currentY);
      doc.fontSize(10).text(`Please be advised that there will be a 26% increase in the combined Rent and Service Charge applicable every two (2) years of continuous tenancy. We appreciate your understanding and continued residency.`, leftMargin, currentY + 18, { width: contentWidth, align: 'justify' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Receipt email
// receiptData: pre-calculated object with all financial figures (same as generateReceiptPdf)
exports.sendReceiptEmail = async (receiptData, tenant, estate) => {
  const formatMoney = (amount) => formatCurrency(amount || 0);

  // Use pre-calculated values from receiptData
  const paymentDate = receiptData.paymentDate;
  const moveInDate = receiptData.moveInDate;
  const expiryDate = receiptData.expiryDate;
  const currentYear = receiptData.currentYear;
  const nextYear = receiptData.nextYear;
  const yearDuration = receiptData.yearDuration;
  const tenancyDuration = receiptData.tenancyDuration || '1 YEAR';
  const tenantTotalStay = receiptData.tenantTotalStay || '1st YEAR';

  const rentAmount = receiptData.rentAmount;
  const serviceCharge = receiptData.serviceCharge;
  const cautionFee = receiptData.cautionFee;
  const legalFee = receiptData.legalFee;
  const rentOutstanding = receiptData.rentOutstanding;
  const serviceChargeOutstanding = receiptData.serviceChargeOutstanding;
  const outstandingBalance = receiptData.outstandingBalance;
  const currentTotalTenancyRate = receiptData.currentTotalTenancyRate;
  const nextTotalTenancyRate = receiptData.nextTotalTenancyRate;
  const nextIncreaseDate = receiptData.nextIncreaseDate;
  const nextRentIncreaseAmount = receiptData.nextRentIncrease;
  const nextServiceChargeIncreaseAmount = receiptData.nextServiceChargeIncrease;
  const totalTenancyRateIncreaseAmount = receiptData.totalTenancyRateIncrease;

  // Generate PDF
  let pdfBuffer = null;
  try {
    pdfBuffer = await exports.generateReceiptPdf(receiptData, tenant, estate);
  } catch (pdfError) {
    console.error('Error generating PDF receipt:', pdfError);
  }

  const message = `
    <div style="font-family: 'Times New Roman', Times, serif; max-width: 800px; margin: 0 auto; color: #333; background: #fff; padding: 20px;">
      
      <!-- Header -->
      <table style="width: 100%; margin-bottom: 20px;">
        <tr>
          <td style="vertical-align: top;">
            <h1 style="color: #4472c4; margin: 0; font-size: 28px; font-weight: bold;">SAMFRED</h1>
            <h2 style="color: #4472c4; margin: 5px 0; font-size: 20px; font-weight: bold; text-decoration: underline;">GLOBAL RESOURCES LTD</h2>
            <p style="margin: 5px 0; font-size: 16px; font-weight: bold; color: #000;">BALADO ESTATE MASON IFIE OFF MATRIX DEPOT</p>
            <p style="margin: 10px 0; font-size: 16px; color: #000;">Tel: 07052258160, 0905665358</p>
          </td>
          <td style="text-align: right; vertical-align: top; width: 100px;">
             <div style="width: 80px; height: 80px; border: 2px solid #2c5aa0; display: inline-block; background: #0056b3; color: white; text-align: center; line-height: 1.2; padding-top: 20px;">
               <span style="font-size: 12px; font-weight: bold;">SAM FRED<br>LOGO</span>
             </div>
             <div style="font-size: 11px; margin-top: 5px; text-align: right; color: #000; font-weight: bold;">
               1 BED ROOM<br>
               2 BED ROOMS<br>
               3 BED ROOMS
             </div>
          </td>
        </tr>
      </table>

      <!-- Title & Date -->
      <table style="width: 100%; margin-bottom: 5px; border-bottom: 2px solid #000;">
        <tr>
          <td style="width: 120px;"><h3 style="margin: 0; background: #e7e6e6; padding: 5px 15px; font-weight: bold; display: inline-block;">RECEIPT</h3></td>
          <td style="text-align: right;"><h3 style="margin: 0; font-weight: bold;">DATE: ${paymentDate}</h3></td>
        </tr>
      </table>

      <!-- Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 16px;">
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold; width: 60%;">TENANT FULL NAME:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${tenant.tenantName}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">BEDROOM TYPE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${tenant.unitLabel || 'Standard'}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">FLAT TYPE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${tenant.unitLabel}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">MOVE IN DATE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${moveInDate}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">EXPIRY DATE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${expiryDate}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">RENT:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${formatMoney(rentAmount)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">RENT OUTSTANDING:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(rentOutstanding)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">SERVICE CHARGE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${formatMoney(serviceCharge)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">SERVICE CHARGE OUTSTANDING:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(serviceChargeOutstanding)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">1 TIME CAUTION FEE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${formatMoney(cautionFee)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">1 TIME LEGAL FEE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${formatMoney(legalFee)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">OUTSTANDING BALANCE:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(outstandingBalance)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #70ad47; font-weight: bold;">CURRENT TOTAL TENANCY RATE: ${currentYear}</td>
          <td style="border: 1px solid #999; padding: 8px; color: #70ad47; font-weight: bold;">${formatMoney(currentTotalTenancyRate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ffc000; font-weight: bold;">NEXT TOTAL TENANCY RATE ${nextYear}:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ffc000; font-weight: bold;">${formatMoney(nextTotalTenancyRate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">TENANCY DURATION:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${tenancyDuration}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">TENANT TOTAL STAY:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${tenantTotalStay}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">YEAR DURATION</td>
          <td style="border: 1px solid #999; padding: 8px; color: #4472c4; font-weight: bold;">${yearDuration}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">NEXT RENTAL INCREASE BY (26%) ON ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(nextRentIncreaseAmount)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">NEXT SERVICE CHARGE INCREASE BY (26%) ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(nextServiceChargeIncreaseAmount)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">TOTAL TENANCY RATE INCREASE BY (26%) ON ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 8px; color: #ff0000; font-weight: bold;">${formatMoney(totalTenancyRateIncreaseAmount)}</td>
        </tr>
      </table>

      <!-- Footer Notice -->
      <div style="margin-top: 25px;">
        <h4 style="color: #ff0000; margin-bottom: 5px; font-weight: bold; font-size: 18px;">Important Notice Regarding Rent Adjustment</h4>
        <p style="color: #ff0000; font-size: 16px; margin: 0; line-height: 1.4;">
          Please be advised that there will be a <strong>26% increase in the combined Rent and Service Charge</strong> applicable <strong>every two (2) years</strong> of continuous tenancy. We appreciate your understanding and continued residency.
        </p>
      </div>

    </div>
  `;

  // Determine recipients: Tenant email + Admin email
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@bamihustle.com';
  const recipientEmails = [tenant.tenantEmail];

  if (adminEmail && adminEmail !== tenant.tenantEmail) {
    recipientEmails.push(adminEmail);
  }

  const emailOptions = {
    email: recipientEmails,
    subject: `Payment Receipt - ${paymentDate} - ${tenant.tenantName}`,
    html: message,
  };

  if (pdfBuffer) {
    emailOptions.attachments = [
      {
        filename: `Receipt-${String(paymentDate).replace(/ /g, '-')}.pdf`,
        content: pdfBuffer,
        type: 'application/pdf'
      }
    ];
  }

  return await exports.sendEmail(emailOptions);
};
