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

// Helper to generate PDF Receipt
const generateReceiptPdf = (payment, tenant, estate, wallet, data) => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 30 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // --- Compact PDF Content for Single Page ---

      const pageWidth = 595.28; // A4 width in points
      const leftMargin = 30;
      const rightMargin = 30;
      const contentWidth = pageWidth - leftMargin - rightMargin;

      // Compact Header Section
      doc.save();

      // Company Name - Left aligned (smaller)
      doc.font('Helvetica-Bold')
        .fontSize(16)
        .fillColor('#2c5aa0')
        .text('SAMFRED GLOBAL RESOURCES LTD', leftMargin, 35);

      // Company Details (compact)
      doc.font('Helvetica')
        .fontSize(7)
        .fillColor('#333333')
        .text('BALADO ESTATE MASON IFIE OFF MATRIX DEPOT | Tel: 07052258160, 0905665358', leftMargin, 52);

      // Logo - Right aligned with actual image
      const logoX = pageWidth - rightMargin - 60;
      const logoPath = require('path').join(__dirname, '../uploads/samfred-logo.png');

      try {
        // Add the logo image
        doc.image(logoPath, logoX, 35, {
          width: 60,
          height: 60,
          fit: [60, 60],
          align: 'center'
        });
      } catch (logoError) {
        // Fallback to placeholder if logo image not found
        console.warn('Logo image not found, using placeholder:', logoError.message);
        doc.roundedRect(logoX, 35, 60, 60, 3)
          .lineWidth(1.5)
          .strokeColor('#2c5aa0')
          .fillAndStroke('#2c5aa0', '#2c5aa0');

        doc.fillColor('white')
          .fontSize(7)
          .font('Helvetica-Bold')
          .text('SAMFRED', logoX, 50, { width: 60, align: 'center' })
          .fontSize(6)
          .text('GLOBAL', logoX, 60, { width: 60, align: 'center' })
          .text('RESOURCES', logoX, 68, { width: 60, align: 'center' });
      }

      doc.fillColor('#666666')
        .fontSize(6)
        .font('Helvetica')
        .text('1-3 BED ROOMS', logoX, 100, { width: 60, align: 'center' });

      doc.restore();

      // Divider line
      doc.moveTo(leftMargin, 105)
        .lineTo(pageWidth - rightMargin, 105)
        .lineWidth(1.5)
        .strokeColor('#2c5aa0')
        .stroke();

      // Receipt Title and Date (compact)
      doc.font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#2c5aa0')
        .text('PAYMENT RECEIPT', leftMargin, 112);

      doc.font('Helvetica')
        .fontSize(7)
        .fillColor('#666666')
        .text(`Date: ${data.paymentDate} | Receipt #: ${payment._id?.toString().slice(-8).toUpperCase() || 'N/A'}`, leftMargin, 128);

      // Start table at Y position
      let currentY = 145;
      const col1X = leftMargin;
      const col2X = leftMargin + 260;
      const rowHeight = 16; // Reduced from 28
      const labelWidth = 250;
      const valueWidth = 245;

      // Compact row drawing function
      const drawRow = (label, value, options = {}) => {
        const {
          color = '#333333',
          bold = false,
          fontSize = 7, // Reduced from 9
          section = false
        } = options;

        // Section header styling
        if (section) {
          doc.rect(col1X, currentY, contentWidth, rowHeight)
            .fill('#f0f4f8');

          doc.font('Helvetica-Bold')
            .fontSize(8)
            .fillColor('#2c5aa0')
            .text(label, col1X + 6, currentY + 4, { width: contentWidth - 12 });

          currentY += rowHeight;
          return;
        }

        // Draw cell borders
        doc.rect(col1X, currentY, labelWidth, rowHeight)
          .strokeColor('#d0d0d0')
          .lineWidth(0.5)
          .stroke();

        doc.rect(col2X, currentY, valueWidth, rowHeight)
          .strokeColor('#d0d0d0')
          .lineWidth(0.5)
          .stroke();

        // Label
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(fontSize)
          .fillColor(color)
          .text(label, col1X + 5, currentY + 4, { width: labelWidth - 10 });

        // Value
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(fontSize)
          .fillColor(color)
          .text(value, col2X + 5, currentY + 4, { width: valueWidth - 10 });

        currentY += rowHeight;
      };

      // Tenant Information Section
      drawRow('TENANT INFORMATION', '', { section: true });
      drawRow('Tenant Full Name:', tenant.tenantName, { bold: true });
      drawRow('Bedroom Type:', tenant.unitLabel || 'Standard');
      drawRow('Flat/Unit:', tenant.unitLabel);
      drawRow('Move In Date:', data.moveInDate);
      drawRow('Lease Expiry Date:', data.expiryDate);

      currentY += 2; // Reduced section spacing

      // Payment Details Section
      drawRow('PAYMENT DETAILS', '', { section: true });
      drawRow('Monthly Rent:', data.rentAmount, { bold: true });
      drawRow('Rent Outstanding:', data.rentOutstanding, {
        color: data.rentOutstanding !== 'N 0' ? '#d32f2f' : '#333333'
      });
      drawRow('Service Charge (Annual):', data.serviceCharge);
      drawRow('Service Charge Outstanding:', data.serviceChargeOutstanding, {
        color: data.serviceChargeOutstanding !== 'N 0' ? '#d32f2f' : '#333333'
      });
      drawRow('Caution Fee (One-time):', data.cautionFee);
      drawRow('Total Outstanding Balance:', data.outstandingBalance, {
        bold: true,
        color: data.outstandingBalance !== 'N 0' ? '#d32f2f' : '#2e7d32'
      });

      currentY += 2;

      // Tenancy Summary Section
      drawRow('TENANCY SUMMARY', '', { section: true });
      drawRow(`Current Total Tenancy Rate (${data.currentYear}):`, data.currentTotalTenancyRate, {
        bold: true,
        color: '#2e7d32',
        fontSize: 8
      });
      drawRow(`Next Total Tenancy Rate (${data.nextYear}):`, data.nextTotalTenancyRate, {
        bold: true,
        color: '#f57c00',
        fontSize: 8
      });
      drawRow('Tenancy Duration:', '1 YEAR');
      drawRow('Current Stay Period:', '1st YEAR');
      drawRow('Year Duration:', data.yearDuration);

      currentY += 2;

      // Future Projections Section
      drawRow('FUTURE RENT ADJUSTMENTS', '', { section: true });
      drawRow(`Next Rental Increase (26%) - ${data.nextIncreaseDate}:`, data.nextRentIncrease, {
        color: '#d32f2f',
        bold: true
      });
      drawRow(`Next Service Charge Increase (26%) - ${data.nextIncreaseDate}:`, data.nextServiceChargeIncrease, {
        color: '#d32f2f',
        bold: true
      });
      drawRow(`Total Rate Increase (26%) - ${data.nextIncreaseDate}:`, data.totalTenancyRateIncrease, {
        color: '#d32f2f',
        bold: true,
        fontSize: 8
      });

      // Footer Notice with compact styling
      currentY += 8;

      doc.roundedRect(leftMargin, currentY, contentWidth, 40, 3)
        .fillAndStroke('#fff3cd', '#ffc107');

      doc.font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#d32f2f')
        .text('⚠ Important Notice Regarding Rent Adjustment', leftMargin + 8, currentY + 6, {
          width: contentWidth - 16
        });

      doc.font('Helvetica')
        .fontSize(6.5)
        .fillColor('#333333')
        .text(
          'Please be advised that there will be a 26% increase in the combined Rent and Service Charge applicable every two (2) years of continuous tenancy. We appreciate your understanding and continued residency.',
          leftMargin + 8,
          currentY + 18,
          { width: contentWidth - 16, align: 'justify' }
        );

      // Footer
      currentY += 48;
      doc.fontSize(6)
        .fillColor('#999999')
        .text(
          'This is a computer-generated receipt. For any queries, please contact our office.',
          leftMargin,
          currentY,
          { width: contentWidth, align: 'center' }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
};

// Receipt email
exports.sendReceiptEmail = async (payment, tenant, estate, wallet) => {
  const formatDate = (date) => new Date(date).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });
  const formatMoney = (amount) => formatCurrency(amount || 0);

  // Calculate dates
  const moveInDate = tenant.entryDate ? formatDate(tenant.entryDate) : '-';
  const expiryDate = tenant.nextDueDate ? formatDate(tenant.nextDueDate) : '-';
  const paymentDate = payment.paymentDate ? formatDate(payment.paymentDate) : formatDate(new Date());

  // Calculate durations and years
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const yearDuration = `${currentYear} - ${nextYear}`;

  // Calculate financial figures
  const rentAmount = tenant.rentAmount || 0;
  const serviceCharge = tenant.unit?.serviceChargeMonthly ? tenant.unit.serviceChargeMonthly * 12 : 0;
  const cautionFee = tenant.unit?.cautionFee || 0;

  const rentOutstanding = 0;
  const serviceChargeOutstanding = 0;
  const outstandingBalance = wallet?.balance ? (wallet.balance < 0 ? Math.abs(wallet.balance) : 0) : 0;

  // Totals
  const currentTotalTenancyRate = rentAmount + serviceCharge;

  // Future projections
  const increaseRate = 0.26;
  const nextRentIncrease = rentAmount * increaseRate;
  const nextServiceChargeIncrease = serviceCharge * increaseRate;
  const totalTenancyRateIncrease = nextRentIncrease + nextServiceChargeIncrease;
  const nextTotalTenancyRate = currentTotalTenancyRate + totalTenancyRateIncrease;

  const nextIncreaseDate = tenant.nextDueDate
    ? new Date(new Date(tenant.nextDueDate).setFullYear(new Date(tenant.nextDueDate).getFullYear() + 2)).toLocaleDateString('en-NG', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'July 3rd, 2026';

  // Prepare data object for PDF (using PDF-compatible currency formatting)
  const data = {
    paymentDate,
    moveInDate,
    expiryDate,
    currentYear,
    nextYear,
    yearDuration,
    rentAmount: formatCurrencyForPDF(rentAmount),
    rentOutstanding: formatCurrencyForPDF(rentOutstanding),
    serviceCharge: formatCurrencyForPDF(serviceCharge),
    serviceChargeOutstanding: formatCurrencyForPDF(serviceChargeOutstanding),
    cautionFee: formatCurrencyForPDF(cautionFee),
    outstandingBalance: formatCurrencyForPDF(outstandingBalance),
    currentTotalTenancyRate: formatCurrencyForPDF(currentTotalTenancyRate),
    nextTotalTenancyRate: formatCurrencyForPDF(nextTotalTenancyRate),
    nextIncreaseDate,
    nextRentIncrease: formatCurrencyForPDF(nextRentIncrease),
    nextServiceChargeIncrease: formatCurrencyForPDF(nextServiceChargeIncrease),
    totalTenancyRateIncrease: formatCurrencyForPDF(totalTenancyRateIncrease)
  };

  // Generate PDF
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateReceiptPdf(payment, tenant, estate, wallet, data);
  } catch (pdfError) {
    console.error('Error generating PDF receipt:', pdfError);
    // Continue without PDF if generation fails
  }

  const message = `
    <div style="font-family: 'Times New Roman', Times, serif; max-width: 800px; margin: 0 auto; color: #333; background: #fff; padding: 20px;">
      
      <!-- Header -->
      <div style="display: flex; justify-content: space-between; margin-bottom: 20px;">
        <div>
          <h1 style="color: #4472c4; margin: 0; font-size: 24px; font-weight: bold;">SAMFRED</h1>
          <h2 style="color: #4472c4; margin: 5px 0; font-size: 18px; font-weight: bold; text-decoration: underline;">GLOBAL RESOURCES LTD</h2>
          <p style="margin: 5px 0; font-size: 14px;">BALADO ESTATE MASON IFIE OFF MATRIX DEPOT</p>
          <p style="margin: 10px 0; font-size: 14px;">Tel: 07052258160, 0905665358</p>
        </div>
        <div style="text-align: right;">
           <!-- Logo Placeholder -->
           <div style="width: 80px; height: 80px; border: 2px solid #0056b3; display: inline-flex; align-items: center; justify-content: center; background: #0056b3; color: white;">
             <span style="font-size: 10px; text-align: center;">SAM FRED<br>LOGO</span>
           </div>
           <div style="font-size: 10px; margin-top: 5px; text-align: right;">
             1 BED ROOM<br>
             2 BED ROOMS<br>
             3 BED ROOMS
           </div>
        </div>
      </div>

      <!-- Title & Date -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 5px;">
        <h3 style="margin: 0; background: #e7e6e6; padding: 2px 5px; font-weight: bold;">RECEIPT</h3>
        <h3 style="margin: 0; font-weight: bold;">DATE: ${paymentDate}</h3>
      </div>

      <!-- Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold; width: 50%;">TENANT FULL NAME:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${tenant.tenantName}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">BEDROOM TYPE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${tenant.unitLabel || 'Standard'}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">FLAT TYPE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${tenant.unitLabel}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">MOVE IN DATE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${moveInDate}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">EXPIRY DATE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${expiryDate}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">RENT:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(rentAmount)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">RENT OUTSTANDING:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(rentOutstanding)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">SERVICE CHARGE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(serviceCharge)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">SERVICE CHARGE OUTSTANDING:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(serviceChargeOutstanding)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">1 TIME CAUTION FEE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(cautionFee)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">OUTSTANDING BALANCE:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4;">${formatMoney(outstandingBalance)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #70ad47; font-weight: bold;">CURRENT TOTAL TENANCY RATE: ${currentYear}</td>
          <td style="border: 1px solid #999; padding: 5px; color: #70ad47; font-weight: bold;">${formatMoney(currentTotalTenancyRate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #ffc000; font-weight: bold;">NEXT TOTAL TENANCY RATE ${nextYear}:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #ffc000; font-weight: bold;">${formatMoney(nextTotalTenancyRate)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">TENANCY DURATION:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">1 YEAR</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">TENANT TOTAL STAY:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">1st YEAR</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">YEAR DURATION</td>
          <td style="border: 1px solid #999; padding: 5px; color: #4472c4; font-weight: bold;">${yearDuration}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">NEXT RENTAL INCREASE BY (26%) ON ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">${formatMoney(nextRentIncrease)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">NEXT SERVICE CHARGE INCREASE BY (26%) ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">${formatMoney(nextServiceChargeIncrease)}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">TOTAL TENANCY RATE INCREASE BY (26%) ON ${nextIncreaseDate}:</td>
          <td style="border: 1px solid #999; padding: 5px; color: #ff0000; font-weight: bold;">${formatMoney(totalTenancyRateIncrease)}</td>
        </tr>
      </table>

      <!-- Footer Notice -->
      <div style="margin-top: 20px;">
        <h4 style="color: #ff0000; margin-bottom: 5px;">Important Notice Regarding Rent Adjustment</h4>
        <p style="color: #ff0000; font-size: 12px; margin: 0;">
          Please be advised that there will be a <strong>26% increase in the combined Rent and Service Charge</strong> applicable <strong>every two (2) years</strong> of continuous tenancy. We appreciate your understanding and continued residency.
        </p>
      </div>

    </div>
  `;

  const emailOptions = {
    email: tenant.tenantEmail,
    subject: `Payment Receipt - ${paymentDate}`,
    html: message,
  };

  if (pdfBuffer) {
    emailOptions.attachments = [
      {
        filename: `Receipt-${paymentDate.replace(/ /g, '-')}.pdf`,
        content: pdfBuffer,
        type: 'application/pdf'
      }
    ];
  }

  return await exports.sendEmail(emailOptions);
};
