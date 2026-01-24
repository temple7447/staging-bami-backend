const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');
const BillingItem = require('../models/BillingItem');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const paystackService = require('../utils/paystackService');
const { distributePayment } = require('../utils/distributionService');
const { sendEmail, sendReceiptEmail } = require('../utils/emailService');
const { logError, logInfo } = require('../utils/logger');

// Supported duration presets for rent payments
const RENT_DURATION_PRESETS = {
  '6_months': 6,
  '1_year': 12,
  '2_years': 24,
};

/**
 * Generic payment initiation function
 * Used by all payment type endpoints
 */
const initiatePaymentGeneric = (paymentType, isDeposit = false) => {
  return async (req, res) => {
    try {
      let { tenantId, amount, description, durationMonths, duration } = req.body;
      const adminId = req.user?.id;

      // Basic validation
      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: 'Tenant ID is required'
        });
      }

      // Get tenant details (we need rent info for rent payments)
      const tenant = await Tenant.findById(tenantId).populate('estate');
      if (!tenant || !tenant.isActive) {
        return res.status(404).json({
          success: false,
          message: 'Tenant not found'
        });
      }

      // If this is a rent payment, allow amount to be derived from unit/tenant rent and duration
      let appliedDurationMonths = null;
      if (paymentType === 'rent') {
        // Normalise duration inputs
        if (durationMonths != null) {
          const parsed = parseInt(durationMonths, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            appliedDurationMonths = parsed;
          }
        } else if (duration && typeof duration === 'string') {
          const presetMonths = RENT_DURATION_PRESETS[duration];
          if (presetMonths) appliedDurationMonths = presetMonths;
        }

        // If we have a valid duration, compute amount from tenant's monthly rent
        if (appliedDurationMonths) {
          const { calculateEffectiveRent } = require('../utils/rentCalculator');
          const result = calculateEffectiveRent(
            tenant.rentAmount || 0,
            tenant.nextDueDate ? new Date(tenant.nextDueDate) : new Date(),
            appliedDurationMonths,
            false, // Occupied
            tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt
          );

          amount = result.totalAmount;

          // Store final rent in metadata so we can update tenant later
          req.body._finalRentAmount = result.finalRent;
        }
      }

      // Final amount validation (for all payment types)
      if (!amount) {
        return res.status(400).json({
          success: false,
          message: paymentType === 'rent'
            ? 'Amount or a valid rent duration is required'
            : 'Tenant ID and amount are required'
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be greater than 0'
        });
      }

      // Get payment type display name
      const paymentTypeNames = {
        'deposit': 'Deposit',
        'rent': 'Rent Payment',
        'service_charge': 'Service Charge',
        'security_charge': 'Security Charge',
        'caution_fee': 'Caution Fee',
        'legal_fee': 'Legal Fee'
      };

      const paymentTypeName = paymentTypeNames[paymentType] || paymentType;

      // Create payment record
      const payment = new Payment({
        tenant: tenantId,
        estate: tenant.estate._id,
        admin: adminId,
        paymentType,
        amount,
        currency: 'NGN',
        description: description ||
          (paymentType === 'rent' && appliedDurationMonths
            ? `${paymentTypeName} for ${tenant.tenantName} (${appliedDurationMonths} month${appliedDurationMonths > 1 ? 's' : ''})`
            : `${paymentTypeName} for ${tenant.tenantName}`),
        isDeposit,
        paymentStatus: 'initiated',
        paymentMethod: 'paystack',
        createdBy: adminId
      });

      await payment.save();

      // Prepare payment data for Paystack
      // Callback will redirect to dashboard on success with ?redirect=true
      const paymentData = {
        amount: amount,
        customerName: tenant.tenantName,
        customerEmail: tenant.tenantEmail || 'noemail@bamihustle.com',
        customerPhone: tenant.tenantPhone,
        description: paymentType === 'rent' && appliedDurationMonths
          ? `${paymentTypeName}: ${tenant.tenantName} - Unit ${tenant.unitLabel} (${appliedDurationMonths} month${appliedDurationMonths > 1 ? 's' : ''})`
          : `${paymentTypeName}: ${tenant.tenantName} - Unit ${tenant.unitLabel}`,
        customerId: tenant._id.toString(),
        tenantId: tenant._id.toString(),
        estateId: tenant.estate._id.toString(),
        metadata: {
          payment_type: paymentType,
          duration_months: appliedDurationMonths,
          tenant_id: tenant._id.toString(),
          estate_id: tenant.estate._id.toString(),
          final_rent_amount: req.body._finalRentAmount
        }
      };

      // Initiate Paystack payment
      const paystackResponse = await paystackService.initiatePayment(paymentData);

      if (!paystackResponse.success) {
        payment.paymentStatus = 'failed';
        payment.failureReason = paystackResponse.error;
        await payment.save();

        return res.status(400).json({
          success: false,
          message: 'Failed to initiate payment',
          error: paystackResponse.error
        });
      }

      // Update payment with Paystack details
      payment.paystackReference = paystackResponse.reference;
      payment.paystackAccessCode = paystackResponse.accessCode;
      payment.paymentStatus = 'pending';
      await payment.save();

      // Send confirmation email to admin (non-blocking)
      sendEmail({
        email: req.user.email,
        subject: `${paymentTypeName} Payment Initiated`,
        html: `
          <h2>Payment Initiated</h2>
          <p>You have initiated a ${paymentTypeName.toLowerCase()} payment for:</p>
          <ul>
            <li><strong>Tenant:</strong> ${tenant.tenantName}</li>
            <li><strong>Unit:</strong> ${tenant.unitLabel}</li>
            <li><strong>Type:</strong> ${paymentTypeName}</li>
            ${paymentType === 'rent' && appliedDurationMonths ? `<li><strong>Duration:</strong> ${appliedDurationMonths} month${appliedDurationMonths > 1 ? 's' : ''}</li>` : ''}
            <li><strong>Amount:</strong> ₦${amount.toLocaleString()}</li>
            <li><strong>Status:</strong> Pending</li>
          </ul>
          <p>Please complete the payment by clicking the link sent to the tenant.</p>
        `
      }).catch(emailError => {
        console.error('Error sending confirmation email:', emailError);
        // Don't throw - email failure shouldn't block payment initiation
      });

      res.status(201).json({
        success: true,
        message: `${paymentTypeName} payment initiated successfully`,
        data: {
          paymentId: payment._id,
          paymentLink: paystackResponse.authorizationUrl,
          reference: paystackResponse.reference,
          accessCode: paystackResponse.accessCode,
          amount: amount,
          type: paymentType,
          tenant: {
            name: tenant.tenantName,
            unit: tenant.unitLabel
          }
        }
      });
    } catch (error) {
      console.error('Payment initiation error:', error);
      res.status(500).json({
        success: false,
        message: 'Error initiating payment',
        error: error.message
      });
    }
  };
};

/**
 * Initiate initial payment with multiple billing items
 * Supports duration-based calculations for rent and service charges
 */
const initiateInitialPayment = async (req, res) => {
  try {
    const { billingItems } = req.body;
    const userId = req.user?.id;

    // Validation
    if (!billingItems || !Array.isArray(billingItems) || billingItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Billing items array is required'
      });
    }

    // Find tenant by user ID (for tenant self-service)
    // If user is admin/manager, they can optionally provide tenantId
    let tenant;

    if (req.body.tenantId && ['admin', 'super_admin', 'manager', 'business_owner'].includes(req.user.role)) {
      // Admin/Manager making payment on behalf of tenant
      tenant = await Tenant.findById(req.body.tenantId).populate('estate');
    } else {
      // Tenant making their own payment
      tenant = await Tenant.findOne({ user: userId, isActive: true }).populate('estate');
    }

    if (!tenant || !tenant.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Tenant profile not found or inactive. Please contact your estate manager.'
      });
    }

    // Calculate total amount and prepare billing items metadata
    let totalAmount = 0;
    const processedItems = [];

    for (const item of billingItems) {
      if (!item.type || !item.amount) {
        return res.status(400).json({
          success: false,
          message: 'Each billing item must have type and amount'
        });
      }

      let itemAmount = parseFloat(item.amount);
      const duration = item.duration ? parseInt(item.duration) : 1;

      // Apply duration multiplier for recurring items
      if (['rent', 'service_charge'].includes(item.type) && duration > 1) {
        if (item.type === 'rent') {
          const { calculateEffectiveRent } = require('../utils/rentCalculator');
          // For initial payment, entryDate is usually today or slightly in past
          const originDate = tenant.entryDate || new Date();
          const result = calculateEffectiveRent(
            itemAmount,
            originDate,
            duration,
            false, // Occupied
            originDate
          );
          itemAmount = result.totalAmount;
          item._finalRentAmount = result.finalRent; // Track for verification
        } else {
          itemAmount = itemAmount * duration;
        }
      }

      totalAmount += itemAmount;

      processedItems.push({
        type: item.type,
        label: item.label || item.type,
        baseAmount: parseFloat(item.amount),
        duration: duration,
        totalAmount: itemAmount,
        finalRentAmount: item._finalRentAmount
      });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Total amount must be greater than 0'
      });
    }

    // Create payment record
    const payment = new Payment({
      tenant: tenant._id,
      estate: tenant.estate._id,
      admin: userId,
      paymentType: 'initial',
      amount: totalAmount,
      currency: 'NGN',
      description: `Initial payment for ${tenant.tenantName} - ${processedItems.length} item(s)`,
      isDeposit: false,
      paymentStatus: 'initiated',
      paymentMethod: 'paystack',
      createdBy: userId
    });

    await payment.save();

    // Prepare payment data for Paystack
    const paymentData = {
      amount: totalAmount,
      customerName: tenant.tenantName,
      customerEmail: tenant.tenantEmail || 'noemail@bamihustle.com',
      customerPhone: tenant.tenantPhone,
      description: `Initial Payment: ${tenant.tenantName} - Unit ${tenant.unitLabel}`,
      customerId: tenant._id.toString(),
      tenantId: tenant._id.toString(),
      estateId: tenant.estate._id.toString(),
      metadata: {
        payment_type: 'initial',
        billing_items: processedItems,
        tenant_id: tenant._id.toString(),
        estate_id: tenant.estate._id.toString()
      }
    };

    // Initiate Paystack payment
    const paystackResponse = await paystackService.initiatePayment(paymentData);

    if (!paystackResponse.success) {
      payment.paymentStatus = 'failed';
      payment.failureReason = paystackResponse.error;
      await payment.save();

      return res.status(400).json({
        success: false,
        message: 'Failed to initiate payment',
        error: paystackResponse.error
      });
    }

    // Update payment with Paystack details and billing items metadata
    payment.paystackReference = paystackResponse.reference;
    payment.paystackAccessCode = paystackResponse.accessCode;
    payment.paymentStatus = 'pending';
    payment.paystackResponse = {
      metadata: {
        payment_type: 'initial',
        billing_items: processedItems
      }
    };
    await payment.save();

    // Send confirmation email to admin (non-blocking)
    sendEmail({
      email: req.user.email,
      subject: 'Initial Payment Initiated',
      html: `
        <h2>Initial Payment Initiated</h2>
        <p>You have initiated an initial payment for:</p>
        <ul>
          <li><strong>Tenant:</strong> ${tenant.tenantName}</li>
          <li><strong>Unit:</strong> ${tenant.unitLabel}</li>
          <li><strong>Total Amount:</strong> ₦${totalAmount.toLocaleString()}</li>
          <li><strong>Items:</strong> ${processedItems.length}</li>
        </ul>
        <h3>Billing Items:</h3>
        <ul>
          ${processedItems.map(item => `
            <li>
              <strong>${item.label}:</strong> ₦${item.totalAmount.toLocaleString()}
              ${item.duration > 1 ? ` (${item.duration} months)` : ''}
            </li>
          `).join('')}
        </ul>
        <p>Please complete the payment by clicking the link sent to the tenant.</p>
      `
    }).catch(emailError => {
      console.error('Error sending confirmation email:', emailError);
    });

    res.status(201).json({
      success: true,
      message: 'Initial payment initiated successfully',
      data: {
        paymentId: payment._id,
        paymentLink: paystackResponse.authorizationUrl,
        reference: paystackResponse.reference,
        accessCode: paystackResponse.accessCode,
        amount: totalAmount,
        type: 'initial',
        billingItems: processedItems,
        tenant: {
          name: tenant.tenantName,
          unit: tenant.unitLabel
        }
      }
    });
  } catch (error) {
    console.error('Initial payment initiation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error initiating initial payment',
      error: error.message
    });
  }
};

/**
 * Specific payment type handlers
 */
const initiateDepositPayment = initiatePaymentGeneric('deposit', true);
const initiateRentPayment = initiatePaymentGeneric('rent', false);
const initiateServiceChargePayment = initiatePaymentGeneric('service_charge', false);
const initiateSecurityChargePayment = initiatePaymentGeneric('security_charge', false);
const initiateCautionFeePayment = initiatePaymentGeneric('caution_fee', false);
const initiateLegalFeePayment = initiatePaymentGeneric('legal_fee', false);

/**
 * Get payment status
 */
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId).populate('tenant estate admin');
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        paymentId: payment._id,
        status: payment.paymentStatus,
        amount: payment.amount,
        currency: payment.currency,
        type: payment.paymentType,
        createdAt: payment.createdAt,
        paymentDate: payment.paymentDate,
        tenant: {
          name: payment.tenant.tenantName,
          email: payment.tenant.tenantEmail,
          unit: payment.tenant.unitLabel
        },
        estate: {
          name: payment.estate.name
        }
      }
    });
  } catch (error) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message
    });
  }
};

/**
 * Get all payments for a tenant
 */
const getTenantPayments = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    const filter = { tenant: tenantId, isActive: true };
    if (status) {
      filter.paymentStatus = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: payments.map(p => ({
        paymentId: p._id,
        type: p.paymentType,
        amount: p.amount,
        status: p.paymentStatus,
        isDeposit: p.isDeposit,
        createdAt: p.createdAt,
        paymentDate: p.paymentDate
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    });
  } catch (error) {
    console.error('Error fetching tenant payments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

/**
 * Get all payments for an estate
 */
const getEstatePayments = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { page = 1, limit = 20, status, type } = req.query;

    const filter = { estate: estateId, isActive: true };
    if (status) filter.paymentStatus = status;
    if (type) filter.paymentType = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('tenant', 'tenantName unitLabel')
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(filter)
    ]);

    const totalAmount = await Payment.aggregate([
      { $match: { ...filter, paymentStatus: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.status(200).json({
      success: true,
      data: payments.map(p => ({
        paymentId: p._id,
        tenant: p.tenant.tenantName,
        unit: p.tenant.unitLabel,
        type: p.paymentType,
        amount: p.amount,
        status: p.paymentStatus,
        createdAt: p.createdAt
      })),
      summary: {
        totalAmount: totalAmount[0]?.total || 0,
        completedPayments: await Payment.countDocuments({ ...filter, paymentStatus: 'completed' })
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    });
  } catch (error) {
    console.error('Error fetching estate payments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payments',
      error: error.message
    });
  }
};

/**
 * Verify payment with Paystack
 * Called by frontend after checkout to confirm payment status
 * Supports both browser redirect and API verification
 */
const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params;
    const { redirect } = req.query; // Check if browser redirect is requested

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    // Find payment record
    const payment = await Payment.findOne({ paystackReference: reference }).populate('tenant estate admin');
    if (!payment) {
      if (redirect) {
        return res.redirect(`http://localhost:8080/dashboard/payment/success?reference=${reference}&status=pending`);
      }
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      });
    }

    // Verify with Paystack
    const verificationResult = await paystackService.verifyPayment(reference);

    if (!verificationResult.success) {
      if (redirect) {
        return res.redirect(`http://localhost:8080/dashboard/payment/success?reference=${reference}&status=failed`);
      }
      return res.status(400).json({
        success: false,
        message: 'Failed to verify payment with Paystack',
        error: verificationResult.error
      });
    }

    // Update payment record with verification details
    if (verificationResult.status === 'success') {
      payment.paymentStatus = 'completed';
      payment.paystackStatus = 'success';
      payment.paymentDate = new Date(verificationResult.paidAt);
      payment.transactionId = verificationResult.transactionId.toString();
      payment.paystackResponse = verificationResult.rawResponse;
      await payment.save();

      // Mark billing items as paid and handle nextDueDate shifts
      let rentMonths = 0;
      let serviceMonths = 0;

      const metadata = verificationResult.metadata || {};

      // 1. Handle Multiple Billing Items (Generic)
      if (metadata.payment_type === 'multiple_billing_items' && metadata.billing_items) {
        for (const item of metadata.billing_items) {
          if (item.type === 'billing_item' && item.id) {
            try {
              await BillingItem.findByIdAndUpdate(item.id, {
                isPaid: true,
                paidDate: new Date(),
                paymentReference: payment._id
              });
              logInfo(`Marked billing item ${item.id} as paid`, { paymentId: payment._id });
            } catch (err) {
              logError('Failed to mark billing item as paid', err, { itemId: item.id, paymentId: payment._id });
            }
          }
          // Track rent/service charge months from multiple list
          if (item.code === 'rent' || item.type === 'rent') rentMonths = Math.max(rentMonths, item.duration || 1);
          if (item.code === 'service_charge' || item.type === 'service_charge') serviceMonths = Math.max(serviceMonths, item.duration || 1);
        }
      }

      // 2. Handle Initial Payment (detailed list)
      if (metadata.payment_type === 'initial' && metadata.billing_items) {
        for (const item of metadata.billing_items) {
          if (item.type === 'rent') rentMonths = Math.max(rentMonths, item.duration || 0);
          if (item.type === 'service_charge') serviceMonths = Math.max(serviceMonths, item.duration || 0);
        }
      }

      // 3. Handle Single Item Payments
      if (payment.paymentType === 'rent') {
        rentMonths = Math.max(rentMonths, metadata.duration_months || 1);
      } else if (payment.paymentType === 'service_charge') {
        serviceMonths = Math.max(serviceMonths, metadata.duration_months || 1);
      }

      // Perform the Due Date Shift
      if (rentMonths > 0 || serviceMonths > 0) {
        try {
          const tenant = await Tenant.findById(payment.tenant._id || payment.tenant);
          if (tenant) {
            // Get current due date or use entryDate (or today) as base
            const baseDate = tenant.nextDueDate ? new Date(tenant.nextDueDate) :
              (tenant.entryDate ? new Date(tenant.entryDate) : new Date());

            const maxMonths = Math.max(rentMonths, serviceMonths);
            const newDueDate = new Date(baseDate);
            newDueDate.setMonth(newDueDate.getMonth() + maxMonths);

            const oldDueDate = tenant.nextDueDate;
            tenant.nextDueDate = newDueDate;

            // Apply Rent Increase if included in payment metadata
            if (metadata.final_rent_amount && metadata.payment_type === 'rent') {
              tenant.rentAmount = metadata.final_rent_amount;
              tenant.lastRentIncreaseDate = new Date(); // Reset cycle to today
            } else if (metadata.payment_type === 'initial' && metadata.billing_items) {
              const rentItem = metadata.billing_items.find(i => i.type === 'rent' && i.finalRentAmount);
              if (rentItem) {
                tenant.rentAmount = rentItem.finalRentAmount;
                tenant.lastRentIncreaseDate = new Date();
              }
            }

            // Record in history
            tenant.history.push({
              event: 'payment',
              note: `Auto-Shift: Payment for ${rentMonths}m rent / ${serviceMonths}m service. Due date shifted to ${newDueDate.toISOString().split('T')[0]}. ${metadata.final_rent_amount ? 'Rent updated to ' + metadata.final_rent_amount : ''}`,
              meta: { rentMonths, serviceMonths, oldDueDate, newDueDate, paymentId: payment._id, finalRent: tenant.rentAmount },
              createdBy: payment.admin?._id || payment.tenant?._id || payment.createdBy
            });

            await tenant.save({ validateBeforeSave: false });
            logInfo(`✅ Successfully shifted nextDueDate for tenant ${tenant._id} by ${maxMonths} months`, { paymentId: payment._id });
          }
        } catch (err) {
          logError('Failed to shift due date during verification', err, { paymentId: payment._id });
        }
      }

      // Distribute payment to the three accounts (50% marketing, 30% owner, 20% operations)
      // This applies to ALL payment types: rent, deposit, service charges, etc.
      try {
        const distribution = await distributePayment(
          payment.estate._id,
          payment.amount,
          payment._id,
          payment.paymentType
        );
        logInfo('🎯 Global 50/30/20 Distribution Applied', {
          paymentId: payment._id,
          paymentType: payment.paymentType,
          amount: payment.amount,
          distribution: distribution.distribution,
          breakdown: {
            marketing: `${distribution.distribution.marketing} (50%)`,
            owner: `${distribution.distribution.owner} (30%)`,
            operations: `${distribution.distribution.operations} (20%)`
          }
        });
      } catch (distError) {
        logError('verifyPayment distribution error', distError, { paymentId: payment._id });
        // Don't fail the entire payment if distribution fails
        // But log it for investigation
      }

      logInfo(`✅ Payment ${reference} verified as successful`, { paymentId: payment._id, amount: payment.amount, type: payment.paymentType });

      // If browser redirect requested, redirect to dashboard success page
      if (redirect) {
        return res.redirect(`http://localhost:8080/dashboard/payment/success?reference=${reference}&status=success`);
      }
    } else {
      payment.paymentStatus = 'failed';
      payment.paystackStatus = verificationResult.status;
      payment.failureReason = `Payment status: ${verificationResult.status}`;
      await payment.save();

      logError(`❌ Payment ${reference} failed`, null, { reference, status: verificationResult.status });

      // If browser redirect requested, redirect to dashboard with failure status
      if (redirect) {
        return res.redirect(`http://localhost:8080/dashboard/payment/success?reference=${reference}&status=failed`);
      }
    }

    // API response (non-redirect)
    res.status(200).json({
      success: true,
      message: `Payment verification successful - Status: ${verificationResult.status}`,
      data: {
        paymentId: payment._id,
        reference: reference,
        status: payment.paymentStatus,
        paystackStatus: verificationResult.status,
        amount: payment.amount,
        currency: payment.currency,
        type: payment.paymentType,
        paidAt: verificationResult.paidAt,
        tenant: {
          name: payment.tenant.tenantName,
          email: payment.tenant.tenantEmail,
          unit: payment.tenant.unitLabel
        },
        estate: {
          name: payment.estate.name
        }
      }
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    const reference = req.params.reference || 'unknown';

    // If browser redirect requested, redirect to dashboard with error
    if (req.query.redirect) {
      return res.redirect(`http://localhost:8080/dashboard/payment/success?reference=${reference}&status=error`);
    }

    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message
    });
  }
};

/**
 * Refund deposit
 */
const refundDeposit = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId);
    if (!payment || !payment.isDeposit) {
      return res.status(404).json({
        success: false,
        message: 'Deposit not found'
      });
    }

    if (!payment.canRefund) {
      return res.status(400).json({
        success: false,
        message: 'This deposit cannot be refunded'
      });
    }

    // Initiate refund via Paystack
    const refundResponse = await paystackService.refundPayment(
      payment.paystackReference,
      payment.amount
    );

    if (!refundResponse.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to process refund',
        error: refundResponse.error
      });
    }

    // Update payment record
    payment.paymentStatus = 'refunded';
    payment.depositRefundedDate = new Date();
    payment.depositRefundedAmount = payment.amount;
    await payment.save();

    res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refundNo: refundResponse.refundNo,
        amount: payment.amount
      }
    });
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing refund',
      error: error.message
    });
  }
};

/**
 * Send payment receipt email manually
 */
const sendPaymentReceipt = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId)
      .populate({
        path: 'tenant',
        populate: { path: 'unit' }
      })
      .populate('estate');

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Respond immediately to frontend
    res.status(200).json({
      success: true,
      message: 'Receipt is being sent to tenant email'
    });

    // Process email asynchronously (don't wait for it)
    setImmediate(async () => {
      try {
        // Find wallet for the tenant (if they have a user account)
        let wallet = null;
        if (payment.tenant.user) {
          wallet = await Wallet.findOne({ userId: payment.tenant.user });
        }

        // Send the receipt email
        await sendReceiptEmail(payment, payment.tenant, payment.estate, wallet);
        console.log(`✅ Receipt sent successfully for payment ${paymentId}`);
      } catch (emailError) {
        console.error(`❌ Error sending receipt for payment ${paymentId}:`, emailError.message);
      }
    });

  } catch (error) {
    console.error('Error processing receipt request:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing receipt request',
      error: error.message
    });
  }
};

/**
 * Send receipt email using tenant ID (without requiring payment ID)
 * This generates a receipt based on current tenant information
 */
const sendTenantReceipt = async (req, res) => {
  try {
    const { tenantId } = req.params;
    console.log(`📧 Receipt request received for tenant: ${tenantId}`);

    const tenant = await Tenant.findById(tenantId)
      .populate('unit')
      .populate('estate');

    if (!tenant) {
      console.log(`❌ Tenant not found: ${tenantId}`);
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    if (!tenant.isActive) {
      console.log(`❌ Tenant is inactive: ${tenantId}`);
      return res.status(404).json({
        success: false,
        message: 'Tenant is not active'
      });
    }

    if (!tenant.tenantEmail) {
      console.log(`❌ Tenant has no email: ${tenantId}`);
      return res.status(400).json({
        success: false,
        message: 'Tenant has no email address'
      });
    }

    console.log(`✅ Tenant found: ${tenant.tenantName} (${tenant.tenantEmail})`);
    console.log(`📍 Estate: ${tenant.estate?.name || 'N/A'}`);
    console.log(`🏠 Unit: ${tenant.unit?.label || tenant.unitLabel || 'N/A'}`);

    // Respond immediately to frontend
    res.status(200).json({
      success: true,
      message: 'Receipt is being sent to tenant email'
    });

    // Process email asynchronously (don't wait for it)
    setImmediate(async () => {
      try {
        console.log(`🔄 Starting email generation for tenant ${tenantId}...`);

        // Find wallet for the tenant (if they have a user account)
        let wallet = null;
        if (tenant.user) {
          wallet = await Wallet.findOne({ userId: tenant.user });
          console.log(`💰 Wallet found: Balance = ${wallet?.balance || 0}`);
        } else {
          console.log(`💰 No user account linked, no wallet data`);
        }

        // Calculate total rent from move-in date to expiration date
        let totalRent = tenant.rentAmount || 0;

        if (tenant.entryDate && tenant.nextDueDate && tenant.rentAmount) {
          // Calculate the number of months between entryDate and nextDueDate
          const moveInDate = new Date(tenant.entryDate);
          const expireDate = new Date(tenant.nextDueDate);

          // Calculate difference in months
          const monthsDiff = (expireDate.getFullYear() - moveInDate.getFullYear()) * 12
            + (expireDate.getMonth() - moveInDate.getMonth());

          // Calculate total rent (ensure at least 1 month)
          const totalMonths = Math.max(1, monthsDiff);
          totalRent = tenant.rentAmount * totalMonths;

          console.log(`📊 Rent calculation: ${tenant.rentAmount} x ${totalMonths} months = ${totalRent}`);
        } else {
          console.log(`⚠️ Using single month rent: ${totalRent} (missing date fields)`);
        }

        // Create a mock payment object with current date
        const mockPayment = {
          _id: tenant._id, // Use tenant ID as receipt reference
          paymentDate: new Date(),
          amount: totalRent
        };

        console.log(`📄 Generating PDF and sending email to ${tenant.tenantEmail}...`);

        // Send the receipt email
        await sendReceiptEmail(mockPayment, tenant, tenant.estate, wallet);

        console.log(`✅ Receipt sent successfully for tenant ${tenantId} to ${tenant.tenantEmail}`);
      } catch (emailError) {
        console.error(`❌ Error sending receipt for tenant ${tenantId}:`, emailError.message);
        console.error('Full error:', emailError);
      }
    });

  } catch (error) {
    console.error('❌ Error processing tenant receipt request:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing receipt request',
      error: error.message
    });
  }
};

module.exports = {
  initiateInitialPayment,
  initiateDepositPayment,
  initiateRentPayment,
  initiateServiceChargePayment,
  initiateSecurityChargePayment,
  initiateCautionFeePayment,
  initiateLegalFeePayment,
  verifyPayment,
  getPaymentStatus,
  getTenantPayments,
  getEstatePayments,
  refundDeposit,
  sendPaymentReceipt,
  sendTenantReceipt
};
