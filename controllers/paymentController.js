const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Tenant = require('../models/Tenant');
const BillingItem = require('../models/BillingItem');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const Transaction = require('../models/Transaction');
const paystackService = require('../utils/paystackService');
const { distributePayment } = require('../utils/distributionService');
const { sendEmail, sendReceiptEmail } = require('../utils/emailService');
const { logError, logInfo } = require('../utils/logger');
const { sendTransactionToSlack } = require('../utils/slackService');

/**
 * Calculates all receipt data using dynamic rent/fee rules.
 * Used by downloadPaymentReceipt, sendPaymentReceipt, and sendTenantReceipt.
 *
 * @param {Object} tenant - Tenant document (populated with unit)
 * @param {Object} payment - Payment document (or mock with paymentDate)
 * @param {Object} wallet - Wallet document (or null)
 * @returns {Object} receiptData - Pre-calculated values for PDF/email
 */
const calculateReceiptData = async (tenant, payment, wallet) => {
  const { getCurrentRent, isOneTimeFeeApplicable } = require('../utils/rentCalculator');

  const formatDate = (date) => new Date(date).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' });

  // Dates
  const moveInDate = tenant.entryDate ? formatDate(tenant.entryDate) : '-';
  const expiryDate = tenant.nextDueDate ? formatDate(tenant.nextDueDate) : '-';
  const paymentDate = payment?.paymentDate ? formatDate(payment.paymentDate) : formatDate(new Date());

  // Dynamic rent (same logic as tenant detail view)
  const effectiveRent = getCurrentRent(
    tenant.baseRent2024 || tenant.rentAmount,
    tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
    false // Occupied
  );

  // Dynamic service charge (monthly)
  const effectiveServiceMonthly = getCurrentRent(
    tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0,
    tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt,
    false // Occupied
  );

  // Caution & Legal fees: only for NEW tenants AND only if not already paid (one-time fees).
  const isApplicable = isOneTimeFeeApplicable(tenant.entryDate) && tenant.tenantType === 'new';

  let cautionAlreadyPaid = false;
  let legalAlreadyPaid = false;
  if (isApplicable && tenant._id) {
    const paid = await Payment.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenant._id),
          paymentStatus: 'completed',
          paymentType: { $in: ['caution_fee', 'legal_fee'] }
        }
      },
      { $group: { _id: '$paymentType', count: { $sum: 1 } } }
    ]);
    for (const p of paid) {
      if (p._id === 'caution_fee' && p.count > 0) cautionAlreadyPaid = true;
      if (p._id === 'legal_fee' && p.count > 0) legalAlreadyPaid = true;
    }
  }

  const effectiveCautionFee = (isApplicable && !cautionAlreadyPaid) ? getCurrentRent(
    tenant.baseCaution2024 || tenant.unit?.cautionFee || 0,
    tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt,
    false
  ) : 0;

  const effectiveLegalFee = (isApplicable && !legalAlreadyPaid) ? getCurrentRent(
    tenant.baseLegal2024 || tenant.unit?.legalFee || 0,
    tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt,
    false
  ) : 0;

  // Tenancy duration is always 1 year (yearly contract system)
  const durationMonths = 12;

  // Tenant Total Stay = number of completed rent payment cycles
  // Rent may be paid as 'rent', 'bundle', or 'initial' — count any that cover rent
  let totalStayYears = 1;
  if (tenant._id) {
    const rentPayments = await Payment.find({
      tenant: tenant._id,
      paymentType: { $in: ['rent', 'bundle', 'initial'] },
      paymentStatus: 'completed',
    }, 'paystackResponse paymentType').lean();
    const rentCoveringCount = rentPayments.filter(p => {
      if (p.paymentType === 'rent') return true;
      const items = p.paystackResponse?.data?.metadata?.billing_items || [];
      return items.some(i => i.code === 'rent' || i.type === 'rent');
    }).length;
    totalStayYears = Math.max(1, rentCoveringCount);
  }

  // Samfred receipts always show YEARLY figures (× 12 months) regardless of lease length.
  const annualMultiplier = 12;
  const rentAmount = effectiveRent * annualMultiplier;
  const serviceChargeTotal = effectiveServiceMonthly * annualMultiplier;

  // Outstanding
  const walletBalance = wallet?.balance || 0;
  const outstandingBalance = walletBalance < 0 ? Math.abs(walletBalance) : 0;

  // Current total tenancy rate = yearly rent + yearly service charge
  const currentTotalTenancyRate = rentAmount + serviceChargeTotal;

  // Future projections (26% increase)
  const increaseRate = 1.26;
  const nextRentIncrease = Math.round(rentAmount * increaseRate);
  const nextServiceChargeIncrease = Math.round(serviceChargeTotal * increaseRate);
  const nextTotalTenancyRate = nextRentIncrease + nextServiceChargeIncrease;
  const totalTenancyRateIncrease = nextTotalTenancyRate;

  // Next increase date: 26% increase every 2 years, anchored to entryDate.
  // Find the next 2-year anniversary of entryDate that is still in the future.
  const nextIncreaseDate = (() => {
    const origin = tenant.entryDate ? new Date(tenant.entryDate) : null;
    if (!origin) return '-';
    const now = new Date();
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const yearsPassed = (now - origin) / msPerYear;
    const cyclesPassed = Math.max(0, Math.floor(yearsPassed / 2));
    const d = new Date(origin);
    d.setFullYear(d.getFullYear() + (cyclesPassed + 1) * 2);
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  // Year calculations
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  // Tenancy duration is always 1 YEAR (yearly contract system)
  const tenancyDuration = '1 YEAR';

  // Total stay ordinal (e.g. "1st YEAR", "2nd YEAR")
  const ordinalSuffix = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const tenantTotalStay = `${ordinalSuffix(totalStayYears)} YEAR`;

  // Year duration = the current contract period (entryDate + (N-1)*12  →  entryDate + N*12)
  const entryBase = tenant.entryDate ? new Date(tenant.entryDate) : new Date();
  const periodStart = new Date(entryBase);
  periodStart.setMonth(periodStart.getMonth() + (totalStayYears - 1) * 12);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 12);
  const yearDuration = `${periodStart.getFullYear()} - ${periodEnd.getFullYear()}`;

  return {
    paymentDate,
    moveInDate,
    expiryDate,
    currentYear,
    nextYear,
    yearDuration,
    tenancyDuration,
    tenantTotalStay,
    rentAmount,
    rentOutstanding: 0,
    serviceCharge: serviceChargeTotal,
    serviceChargeOutstanding: 0,
    cautionFee: effectiveCautionFee,
    legalFee: effectiveLegalFee,
    outstandingBalance,
    currentTotalTenancyRate,
    nextTotalTenancyRate,
    nextIncreaseDate,
    nextRentIncrease,
    nextServiceChargeIncrease,
    totalTenancyRateIncrease
  };
};

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

      // If this is a rent or service charge payment, allow amount to be derived from unit/tenant rent and duration
      let appliedDurationMonths = null;
      if (paymentType === 'rent' || paymentType === 'service_charge') {
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

        // ENFORCE CONTRACT RULES
        if (appliedDurationMonths) {
          const isNewTenant = tenant.tenantType === 'new';
          if (isNewTenant && appliedDurationMonths < 12) {
            return res.status(400).json({
              success: false,
              message: 'New tenants must pay for at least 12 months (1-year contract).'
            });
          }
          if (!isNewTenant && appliedDurationMonths < 6) {
            return res.status(400).json({
              success: false,
              message: 'Renewal payments must be for at least 6 months.'
            });
          }
          if (appliedDurationMonths > 12) {
            return res.status(400).json({
              success: false,
              message: 'The system does not accept payments for more than 12 months (1 year).'
            });
          }
        }

        // If we have a valid duration, compute amount from tenant's monthly rent/service
        if (appliedDurationMonths) {
          const { calculateEffectiveRent } = require('../utils/rentCalculator');
          const isRentHeader = paymentType === 'rent';

          // 1. Calculate Rent Component
          const rentBase = tenant.rentAmount || 0;
          const rentOrigin = tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt;

          const rentResult = calculateEffectiveRent(
            rentBase,
            tenant.nextDueDate ? new Date(tenant.nextDueDate) : new Date(),
            appliedDurationMonths,
            false,
            rentOrigin
          );

          // 2. Calculate Service Charge Component (if type is rent or service_charge)
          // NEW RULE: Rent payments always include Service Charge for the same period
          let serviceTotal = 0;
          let serviceFinal = 0;

          if (paymentType === 'rent' || paymentType === 'service_charge') {
            const serviceBase = tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0;
            const serviceOrigin = tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt;

            const serviceResult = calculateEffectiveRent(
              serviceBase,
              tenant.nextDueDate ? new Date(tenant.nextDueDate) : new Date(),
              appliedDurationMonths,
              false,
              serviceOrigin
            );
            serviceTotal = serviceResult.totalAmount;
            serviceFinal = serviceResult.finalRent;
          }

          // Total amount for initiation
          if (paymentType === 'rent') {
            amount = rentResult.totalAmount + serviceTotal;
            req.body._finalRentAmount = rentResult.finalRent;
            req.body._finalServiceAmount = serviceFinal;
          } else {
            amount = serviceTotal;
            req.body._finalServiceAmount = serviceFinal;
          }
        }
      }

      if (paymentType === 'caution_fee') {
        const { getCurrentRent } = require('../utils/rentCalculator');
        const base = tenant.baseCaution2024 || tenant.unit?.cautionFee || 0;
        const origin = tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt;
        amount = getCurrentRent(base, origin, false);
      } else if (paymentType === 'legal_fee') {
        const { getCurrentRent } = require('../utils/rentCalculator');
        const base = tenant.baseLegal2024 || tenant.unit?.legalFee || 0;
        const origin = tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt;
        amount = getCurrentRent(base, origin, false);
      }

      // Final amount validation (for all payment types)
      if (!amount) {
        return res.status(400).json({
          success: false,
          message: ['rent', 'service_charge'].includes(paymentType)
            ? 'Amount or a valid duration is required'
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
        'caution_fee': 'Caution Fee',
        'legal_fee': 'Legal Fee'
      };

      const paymentTypeName = paymentTypeNames[paymentType] || paymentType;

      // Create payment record
      const payment = new Payment({
        user: tenant.user || adminId,
        tenant: tenantId,
        estate: tenant.estate._id,
        admin: adminId,
        paymentType,
        amount,
        currency: 'NGN',
        description: description ||
          (['rent', 'service_charge'].includes(paymentType) && appliedDurationMonths
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
        description: ['rent', 'service_charge'].includes(paymentType) && appliedDurationMonths
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
          final_rent_amount: req.body._finalRentAmount,
          final_service_amount: req.body._finalServiceAmount
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
      let duration = item.duration ? parseInt(item.duration) : 1;

      // Apply dynamic 26% increase rule to ALL items based on anniversaries
      const { getCurrentRent, isOneTimeFeeApplicable } = require('../utils/rentCalculator');
      if (item.type === 'rent') {
        itemAmount = getCurrentRent(tenant.baseRent2024 || itemAmount, tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt, false);
      } else if (item.type === 'service_charge') {
        itemAmount = getCurrentRent(tenant.baseServiceCharge2024 || itemAmount, tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt, false);
      } else if (item.type === 'caution_fee') {
        if (!isOneTimeFeeApplicable(tenant.entryDate) || tenant.tenantType !== 'new') {
          itemAmount = 0;
        } else {
          itemAmount = getCurrentRent(tenant.baseCaution2024 || itemAmount, tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt, false);
        }
      } else if (item.type === 'legal_fee') {
        if (!isOneTimeFeeApplicable(tenant.entryDate) || tenant.tenantType !== 'new') {
          itemAmount = 0;
        } else {
          itemAmount = getCurrentRent(tenant.baseLegal2024 || itemAmount, tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt, false);
        }
      }

      // ENFORCE CONTRACT RULES for Rent and Service Charge
      if (['rent', 'service_charge'].includes(item.type)) {
        const isNewTenant = tenant.tenantType === 'new';
        if (isNewTenant && duration < 12) {
          return res.status(400).json({
            success: false,
            message: `New tenants must pay at least 12 months for ${item.type === 'rent' ? 'Rent' : 'Service Charge'}.`
          });
        }
        if (!isNewTenant && duration < 6) {
          return res.status(400).json({
            success: false,
            message: `Renewal payments for ${item.type === 'rent' ? 'Rent' : 'Service Charge'} must be at least 6 months.`
          });
        }
        if (duration > 12) {
          return res.status(400).json({
            success: false,
            message: 'The system does not accept payments for more than 12 months (1 year).'
          });
        }
      }

      // Apply duration multiplier for recurring items
      if (['rent', 'service_charge'].includes(item.type) && duration > 1) {
        const { calculateEffectiveRent } = require('../utils/rentCalculator');
        const isRent = item.type === 'rent';

        // For initial payment, entryDate is usually today or slightly in past
        const originDate = (isRent
          ? (tenant.lastRentIncreaseDate || tenant.entryDate)
          : (tenant.lastServiceIncreaseDate || tenant.entryDate)) || new Date();

        const result = calculateEffectiveRent(
          itemAmount,
          tenant.entryDate || new Date(),
          duration,
          false, // Occupied
          originDate
        );
        itemAmount = result.totalAmount;
        item._finalValue = result.finalRent; // Track for verification
      }

      totalAmount += itemAmount;

      processedItems.push({
        type: item.type,
        label: item.label || item.type,
        baseAmount: parseFloat(item.amount),
        duration: duration,
        totalAmount: itemAmount,
        finalValue: item._finalValue
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
      user: tenant.user || userId,
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
const initiateCautionFeePayment = initiatePaymentGeneric('caution_fee', false);
const initiateLegalFeePayment = initiatePaymentGeneric('legal_fee', false);

/**
 * Get payment status
 */
const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const query = mongoose.Types.ObjectId.isValid(paymentId)
      ? { _id: paymentId }
      : { paystackReference: paymentId };

    const payment = await Payment.findOne(query).populate('tenant estate admin');
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
 * GET /api/payments/tenant/:tenantId
 * Full transaction history for a single tenant.
 * Filters: status, type, paymentMethod, from, to
 */
const getTenantPayments = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { page = 1, limit = 20, status, type, paymentMethod, from, to } = req.query;

    // Verify tenant exists and pull profile info
    const tenant = await Tenant.findById(tenantId)
      .populate('estate', 'name')
      .populate('unit', 'label unitType')
      .lean();

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const filter = { tenant: tenantId };
    if (status) filter.paymentStatus = status;
    if (type) filter.paymentType = type;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [payments, total, summary] = await Promise.all([
      Payment.find(filter)
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Payment.countDocuments(filter),
      Payment.aggregate([
        { $match: { tenant: new mongoose.Types.ObjectId(tenantId) } },
        {
          $group: {
            _id: '$paymentType',
            totalPaid: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, '$amount', 0] }
            },
            totalPending: {
              $sum: { $cond: [{ $in: ['$paymentStatus', ['pending', 'initiated']] }, '$amount', 0] }
            },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    // Build per-type summary map
    const byType = {};
    let grandTotalPaid = 0;
    let grandTotalPending = 0;
    for (const row of summary) {
      byType[row._id] = { totalPaid: row.totalPaid, totalPending: row.totalPending, count: row.count };
      grandTotalPaid += row.totalPaid;
      grandTotalPending += row.totalPending;
    }

    return res.status(200).json({
      success: true,
      tenant: {
        id: tenant._id,
        name: tenant.tenantName,
        email: tenant.tenantEmail,
        phone: tenant.tenantPhone,
        unit: tenant.unit?.label || tenant.unitLabel,
        estate: tenant.estate?.name,
        status: tenant.status,
        entryDate: tenant.entryDate,
        nextDueDate: tenant.nextDueDate,
        rentAmount: tenant.rentAmount,
        serviceChargeAmount: tenant.serviceChargeAmount
      },
      summary: {
        totalPaid: grandTotalPaid,
        totalPending: grandTotalPending,
        totalTransactions: total,
        byType
      },
      data: payments.map(p => ({
        paymentId: p._id,
        reference: p.paystackReference || p.transactionId || null,
        paymentType: p.paymentType,
        paymentMethod: p.paymentMethod,
        amount: p.amount,
        status: p.paymentStatus,
        description: p.description || null,
        isDeposit: p.isDeposit,
        recordedBy: p.admin ? { id: p.admin._id, name: p.admin.name, email: p.admin.email } : null,
        paymentDate: p.paymentDate || p.createdAt,
        createdAt: p.createdAt,
        notes: p.notes || null
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    logError('getTenantPayments error', error);
    return res.status(500).json({ success: false, message: 'Error fetching tenant payments', error: error.message });
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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    // Find payment record
    const payment = await Payment.findOne({ paystackReference: reference }).populate('tenant estate admin');
    if (!payment) {
      if (redirect) {
        return res.redirect(`${frontendUrl}/dashboard/payment/success?reference=${reference}&status=pending`);
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
        return res.redirect(`${frontendUrl}/dashboard/payment/success?reference=${reference}&status=failed`);
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
        serviceMonths = Math.max(serviceMonths, metadata.duration_months || 1); // BUNDLED
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

            // Apply Rent/Service Increase if included in payment metadata
            if (metadata.payment_type === 'rent') {
              if (metadata.final_rent_amount) {
                tenant.rentAmount = metadata.final_rent_amount;
                tenant.lastRentIncreaseDate = new Date();
              }
              if (metadata.final_service_amount) {
                tenant.serviceChargeAmount = metadata.final_service_amount;
                tenant.lastServiceIncreaseDate = new Date();
              }
            } else if (metadata.final_service_amount && metadata.payment_type === 'service_charge') {
              tenant.serviceChargeAmount = metadata.final_service_amount;
              tenant.lastServiceIncreaseDate = new Date();
            } else if (metadata.payment_type === 'initial' && metadata.billing_items) {
              const rentItem = metadata.billing_items.find(i => i.type === 'rent' && i.finalValue);
              if (rentItem) {
                tenant.rentAmount = rentItem.finalValue;
                tenant.lastRentIncreaseDate = new Date();
              }
              const serviceItem = metadata.billing_items.find(i => i.type === 'service_charge' && i.finalValue);
              if (serviceItem) {
                tenant.serviceChargeAmount = serviceItem.finalValue;
                tenant.lastServiceIncreaseDate = new Date();
              }
            }

            // Record in history
            const historyNote = `Auto-Shift: Payment for ${rentMonths}m rent / ${serviceMonths}m service. Due date shifted to ${newDueDate.toISOString().split('T')[0]}. ` +
              (metadata.final_rent_amount ? `Rent updated to ${tenant.rentAmount}. ` : '') +
              (metadata.final_service_amount ? `Service charge updated to ${tenant.serviceChargeAmount}.` : '');

            tenant.history.push({
              event: 'payment',
              note: historyNote.trim(),
              meta: { rentMonths, serviceMonths, oldDueDate, newDueDate, paymentId: payment._id, finalRent: tenant.rentAmount, finalService: tenant.serviceChargeAmount },
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

      // 4. Record as a Transaction for central history
      try {
        await Transaction.create({
          user: payment.tenant.user || payment.admin?._id || payment.createdBy,
          tenant: payment.tenant._id || payment.tenant,
          estate: payment.estate._id || payment.estate,
          amount: payment.amount,
          type: payment.paymentType,
          method: 'paystack',
          status: 'completed',
          reference: reference,
          description: payment.description || `${payment.paymentType} Payment`,
          metadata: verificationResult,
          createdBy: payment.admin?._id || payment.tenant?._id || payment.createdBy
        });
        logInfo(`📝 Transaction record created for payment ${reference}`);
        sendTransactionToSlack(payment, payment.tenant.tenantName, payment.estate.name);
      } catch (txError) {
        logError('Failed to create Transaction record in verifyPayment', txError, { paymentId: payment._id });
      }

      // If browser redirect requested, redirect to dashboard success page
      if (redirect) {
        return res.redirect(`${frontendUrl}/dashboard/payment/success?reference=${reference}&status=success`);
      }
    } else {
      payment.paymentStatus = 'failed';
      payment.paystackStatus = verificationResult.status;
      payment.failureReason = `Payment status: ${verificationResult.status}`;
      await payment.save();

      logError(`❌ Payment ${reference} failed`, null, { reference, status: verificationResult.status });

      // If browser redirect requested, redirect to dashboard with failure status
      if (redirect) {
        return res.redirect(`${frontendUrl}/dashboard/payment/success?reference=${reference}&status=failed`);
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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';

    // If browser redirect requested, redirect to dashboard with error
    if (req.query.redirect) {
      return res.redirect(`${frontendUrl}/dashboard/payment/success?reference=${reference}&status=error`);
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

    const query = mongoose.Types.ObjectId.isValid(paymentId)
      ? { _id: paymentId }
      : { paystackReference: paymentId };

    const payment = await Payment.findOne(query);
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

    const query = mongoose.Types.ObjectId.isValid(paymentId)
      ? { _id: paymentId }
      : { paystackReference: paymentId };

    const payment = await Payment.findOne(query)
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

        // Calculate correct receipt data
        const receiptData = await calculateReceiptData(payment.tenant, payment, wallet);

        // Send the receipt email
        await sendReceiptEmail(receiptData, payment.tenant, payment.estate);
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
 * Download payment receipt as PDF
 * Generates and streams PDF directly to the browser
 */
const downloadPaymentReceipt = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const query = mongoose.Types.ObjectId.isValid(paymentId)
      ? { _id: paymentId }
      : { paystackReference: paymentId };

    const payment = await Payment.findOne(query)
      .populate({
        path: 'tenant',
        populate: [
          { path: 'unit' },
          { path: 'estate' }
        ]
      })
      .populate('estate');

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    // Find wallet for the tenant (if they have a user account)
    let wallet = null;
    if (payment.tenant && payment.tenant.user) {
      wallet = await Wallet.findOne({ userId: payment.tenant.user });
    }

    // Calculate correct receipt data
    const receiptData = await calculateReceiptData(payment.tenant, payment, wallet);

    // Generate PDF
    const { generateReceiptPdf } = require('../utils/emailService');
    const pdfBuffer = await generateReceiptPdf(
      receiptData,
      payment.tenant,
      payment.estate || payment.tenant.estate
    );

    // Set headers for download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Receipt-${payment.paystackReference || paymentId}.pdf`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error downloading receipt:', error);
    res.status(500).json({
      success: false,
      message: 'Error downloading receipt',
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

        // Create a mock payment for the receipt date
        const mockPayment = {
          paymentDate: new Date()
        };

        // Calculate correct receipt data
        const receiptData = await calculateReceiptData(tenant, mockPayment, wallet);

        console.log(`📄 Generating PDF and sending email to ${tenant.tenantEmail}...`);

        // Send the receipt email
        await sendReceiptEmail(receiptData, tenant, tenant.estate);

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

/**
 * Record manual payment (admin-initiated offline payment)
 * Bypasses Paystack but performs all other post-payment operations
 */
const recordManualPayment = async (req, res) => {
  try {
    const { tenantId, paymentType, amount, paymentMethod, paymentDate, description, durationMonths, duration, notes } = req.body;
    const adminId = req.user.id;

    if (!tenantId || !paymentType || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID, payment type, amount, and payment method are required'
      });
    }

    const tenant = await Tenant.findById(tenantId).populate('estate');
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Active tenant not found' });
    }

    // Determine duration for due date shifting
    let appliedDurationMonths = 0;
    if (durationMonths != null) {
      appliedDurationMonths = parseInt(durationMonths, 10);
    } else if (duration) {
      appliedDurationMonths = RENT_DURATION_PRESETS[duration] || 0;
    }

    // ENFORCE CONTRACT RULES for Rent and Service Charge
    if (['rent', 'service_charge'].includes(paymentType) && appliedDurationMonths > 0) {
      const isNewTenant = tenant.tenantType === 'new';
      if (isNewTenant && appliedDurationMonths < 12) {
        return res.status(400).json({
          success: false,
          message: 'All new apartments must be on a 1-year contract. Minimum 12 months manual payment required.'
        });
      }
      if (!isNewTenant && appliedDurationMonths < 6) {
        return res.status(400).json({
          success: false,
          message: 'Manual renewal payments must be for at least 6 months.'
        });
      }
      if (appliedDurationMonths > 12) {
        return res.status(400).json({
          success: false,
          message: 'The system does not accept payments for more than 12 months (1 year).'
        });
      }
    }

    // Create payment record (marked as completed immediately)
    const payment = new Payment({
      user: tenant.user || adminId,
      tenant: tenantId,
      estate: tenant.estate._id,
      admin: adminId,
      paymentType,
      amount,
      currency: 'NGN',
      description: description || `Manual ${paymentType} via ${paymentMethod}`,
      notes,
      paymentMethod,
      paymentStatus: 'completed',
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      isDeposit: paymentType === 'deposit',
      transactionId: `MANUAL-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      createdBy: adminId,
      reconciled: true,
      reconciledDate: new Date(),
      reconciledBy: adminId
    });

    await payment.save();

    // 1. Shift Due Date & Update Rent (if applicable)
    if (appliedDurationMonths > 0 && (paymentType === 'rent' || paymentType === 'service_charge' || paymentType === 'initial' || paymentType === 'bundle')) {
      const baseDate = tenant.nextDueDate ? new Date(tenant.nextDueDate) : (tenant.entryDate || new Date());
      const newDueDate = new Date(baseDate);
      newDueDate.setMonth(newDueDate.getMonth() + appliedDurationMonths);

      const oldDueDate = tenant.nextDueDate;
      tenant.nextDueDate = newDueDate;

      // Logic for rent/service charge updates could be added here if needed
      // For now, simple shift based on manual entry amount

      tenant.history.push({
        event: 'payment',
        note: `Manual Entry: ${paymentType} for ${appliedDurationMonths}m. Due date shifted to ${newDueDate.toISOString().split('T')[0]}`,
        meta: { duration: appliedDurationMonths, oldDueDate, newDueDate, paymentId: payment._id },
        createdBy: adminId
      });
      await tenant.save({ validateBeforeSave: false });
    }

    // 2. Distribute funds (50/30/20)
    try {
      await distributePayment(tenant.estate._id, amount, payment._id, paymentType);
    } catch (distError) {
      logError('Manual payment distribution failure', distError, { paymentId: payment._id });
    }

    // 3. Create Transaction Record
    try {
      await Transaction.create({
        user: tenant.user || adminId,
        tenant: tenant._id,
        estate: tenant.estate._id,
        amount,
        type: paymentType,
        method: paymentMethod,
        status: 'completed',
        reference: `MAN-${Date.now()}`,
        description: payment.description,
        createdBy: adminId
      });
    } catch (txError) {
      logError('Manual transaction record failure', txError);
    }

    // 4. Send Receipt (Asynchronously)
    setImmediate(async () => {
      try {
        let wallet = null;
        if (tenant.user) wallet = await Wallet.findOne({ userId: tenant.user });
        // Build the pre-calculated receipt data (sendReceiptEmail expects this, not the raw payment)
        const receiptData = await calculateReceiptData(tenant, payment, wallet);
        await sendReceiptEmail(receiptData, tenant, tenant.estate, wallet);
      } catch (emailError) {
        logError('Manual payment receipt failure', emailError);
      }
    });

    sendTransactionToSlack(payment, tenant.tenantName, tenant.estate ? tenant.estate.name : 'N/A');

    res.status(201).json({
      success: true,
      message: 'Manual payment recorded and processed successfully',
      data: { paymentId: payment._id }
    });

  } catch (error) {
    logError('recordManualPayment error', error);
    res.status(500).json({ success: false, message: 'Error recording manual payment' });
  }
};

/**
 * Get all receipts for the currently logged-in tenant user.
 * Returns one receipt entry per completed payment, with full breakdown.
 * GET /api/payments/receipts
 */
const getTenantReceipts = async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
      .populate('unit')
      .populate('estate')
      .lean();

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant profile not found' });
    }

    // Reconcile nextDueDate so receipts show the correct expiry date
    const { reconcileNextDueDate } = require('./tenantController');
    const corrected = await reconcileNextDueDate(tenant, Payment);
    if (corrected) tenant.nextDueDate = corrected;

    const payments = await Payment.find({
      tenant: tenant._id,
      paymentStatus: 'completed'
    })
      .sort({ createdAt: -1 })
      .lean();

    const wallet = await Wallet.findOne({ tenant: tenant._id }).lean();

    const receipts = await Promise.all(payments.map(async payment => {
      const receiptData = await calculateReceiptData(tenant, payment, wallet);

      // Extract per-payment breakdown from billing_items metadata
      const billingItems = payment.paystackResponse?.data?.metadata?.billing_items || [];
      let paidRent = 0, paidServiceCharge = 0, paidCaution = 0, paidLegal = 0, paidOther = 0;

      if (billingItems.length > 0) {
        for (const item of billingItems) {
          const code = item.code || item.type || '';
          const amount = item.amount || 0;
          if (code === 'rent') paidRent += amount;
          else if (code === 'service_charge') paidServiceCharge += amount;
          else if (code === 'caution_fee') paidCaution += amount;
          else if (code === 'legal_fee') paidLegal += amount;
          else paidOther += amount;
        }
      } else {
        if (payment.paymentType === 'rent') paidRent = payment.amount;
        else if (payment.paymentType === 'service_charge') paidServiceCharge = payment.amount;
        else if (payment.paymentType === 'caution_fee') paidCaution = payment.amount;
        else if (payment.paymentType === 'legal_fee') paidLegal = payment.amount;
        else paidRent = payment.amount; // initial/bundle fallback
      }

      // Outstanding per category: annual rate minus what this payment covered
      const rentOutstanding = paidRent > 0 ? Math.max(0, receiptData.rentAmount - paidRent) : 0;
      const serviceChargeOutstanding = paidServiceCharge > 0
        ? Math.max(0, receiptData.serviceCharge - paidServiceCharge)
        : 0;

      return {
        receiptId: payment._id,
        reference: payment.paystackReference || payment.transactionId,
        paymentDate: receiptData.paymentDate,
        paymentMethod: payment.paymentMethod,
        paymentType: payment.paymentType,
        description: payment.description,

        // Tenant & property info
        tenantName: tenant.tenantName,
        phone: tenant.tenantPhone,
        meterNo: tenant.unit?.meterNumber || null,
        bedroomType: tenant.unit?.bedrooms ? `${tenant.unit.bedrooms} BED ROOM` : tenant.unitLabel,
        flatType: tenant.unit?.label || tenant.unitLabel,

        // Dates
        moveInDate: receiptData.moveInDate,
        expiryDate: receiptData.expiryDate,

        // What was paid in this specific payment
        amountPaid: payment.amount,
        breakdown: {
          rent: paidRent,
          serviceCharge: paidServiceCharge,
          ...(paidCaution > 0 && { cautionFee: paidCaution }),
          ...(paidLegal > 0 && { legalFee: paidLegal }),
          ...(paidOther > 0 && { other: paidOther })
        },

        // Annual/period rates at current pricing
        rent: receiptData.rentAmount,
        serviceCharge: receiptData.serviceCharge,
        cautionFee: receiptData.cautionFee,
        legalFee: receiptData.legalFee,

        // Outstanding
        rentOutstanding,
        serviceChargeOutstanding,
        outstandingBalance: receiptData.outstandingBalance,

        // Totals
        currentTotalTenancyRate: receiptData.currentTotalTenancyRate,
        nextTotalTenancyRate: receiptData.nextTotalTenancyRate,

        // Period labels
        tenancyDuration: receiptData.tenancyDuration,
        tenantTotalStay: receiptData.tenantTotalStay,
        yearDuration: receiptData.yearDuration,
        currentYear: receiptData.currentYear,
        nextYear: receiptData.nextYear,

        // Next 26% increase projection
        nextIncreaseDate: receiptData.nextIncreaseDate,
        nextRentIncrease: receiptData.nextRentIncrease,
        nextServiceChargeIncrease: receiptData.nextServiceChargeIncrease,
        totalTenancyRateIncrease: receiptData.totalTenancyRateIncrease
      };
    }));

    return res.status(200).json({
      success: true,
      count: receipts.length,
      receipts
    });
  } catch (error) {
    logError('getTenantReceipts error', error);
    return res.status(500).json({ success: false, message: 'Error fetching receipts' });
  }
};

/**
 * GET /api/payments
 * Admin/business_owner: all payments across estates they manage.
 * Supports filters: estateId, tenantId, type, status, paymentMethod, from, to, search
 * Supports pagination: page, limit
 */
const getAllPayments = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    const {
      page = 1,
      limit = 20,
      estateId,
      tenantId,
      type,
      status,
      paymentMethod,
      from,
      to,
      search
    } = req.query;

    // Build estate scope for this admin
    let estateIds;
    if (['super_admin'].includes(role)) {
      // Super admin sees everything — no estate restriction
      estateIds = null;
    } else {
      const user = await User.findById(userId).select('assignedEstates');
      const owned = await Estate.find({ createdBy: userId, isActive: true }).select('_id');
      const assigned = user?.assignedEstates || [];
      const ownedIds = owned.map(e => e._id);
      estateIds = [...new Set([...ownedIds.map(String), ...assigned.map(String)])].map(id => new mongoose.Types.ObjectId(id));

      if (estateIds.length === 0) {
        return res.status(200).json({ success: true, data: [], summary: { totalAmount: 0, totalCount: 0, completedAmount: 0, pendingAmount: 0 }, pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } });
      }
    }

    // Build filter
    const filter = {};
    if (estateIds) filter.estate = { $in: estateIds };
    if (estateId) filter.estate = new mongoose.Types.ObjectId(estateId);
    if (tenantId) filter.tenant = new mongoose.Types.ObjectId(tenantId);
    if (type) filter.paymentType = type;
    if (status) filter.paymentStatus = status;
    if (paymentMethod) filter.paymentMethod = paymentMethod;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // If search is provided, first find matching tenants
    let tenantFilter = {};
    if (search) {
      const matchingTenants = await Tenant.find({
        $or: [
          { tenantName: new RegExp(search, 'i') },
          { unitLabel: new RegExp(search, 'i') },
          { tenantEmail: new RegExp(search, 'i') }
        ]
      }).select('_id');
      tenantFilter = { $or: [
        { tenant: { $in: matchingTenants.map(t => t._id) } },
        { paystackReference: new RegExp(search, 'i') },
        { transactionId: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ]};
    }

    const finalFilter = search ? { ...filter, ...tenantFilter } : filter;

    const [payments, total, summary] = await Promise.all([
      Payment.find(finalFilter)
        .populate('tenant', 'tenantName unitLabel tenantEmail tenantPhone')
        .populate('estate', 'name')
        .populate('admin', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Payment.countDocuments(finalFilter),
      Payment.aggregate([
        { $match: finalFilter },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$amount' },
            completedAmount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'completed'] }, '$amount', 0] }
            },
            pendingAmount: {
              $sum: { $cond: [{ $in: ['$paymentStatus', ['pending', 'initiated']] }, '$amount', 0] }
            },
            failedCount: {
              $sum: { $cond: [{ $eq: ['$paymentStatus', 'failed'] }, 1, 0] }
            }
          }
        }
      ])
    ]);

    const summaryData = summary[0] || { totalAmount: 0, completedAmount: 0, pendingAmount: 0, failedCount: 0 };

    return res.status(200).json({
      success: true,
      data: payments.map(p => ({
        paymentId: p._id,
        reference: p.paystackReference || p.transactionId || null,
        tenant: p.tenant ? { id: p.tenant._id, name: p.tenant.tenantName, unit: p.tenant.unitLabel, email: p.tenant.tenantEmail } : null,
        estate: p.estate ? { id: p.estate._id, name: p.estate.name } : null,
        recordedBy: p.admin ? { id: p.admin._id, name: p.admin.name } : null,
        paymentType: p.paymentType,
        paymentMethod: p.paymentMethod,
        amount: p.amount,
        status: p.paymentStatus,
        description: p.description,
        paymentDate: p.paymentDate || p.createdAt,
        createdAt: p.createdAt
      })),
      summary: {
        totalAmount: summaryData.totalAmount,
        completedAmount: summaryData.completedAmount,
        pendingAmount: summaryData.pendingAmount,
        failedCount: summaryData.failedCount,
        totalCount: total
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    logError('getAllPayments error', error);
    return res.status(500).json({ success: false, message: 'Error fetching payments', error: error.message });
  }
};

module.exports = {
  calculateReceiptData,
  initiateInitialPayment,
  initiateDepositPayment,
  initiateRentPayment,
  initiateServiceChargePayment,
  initiateCautionFeePayment,
  initiateLegalFeePayment,
  verifyPayment,
  getPaymentStatus,
  getTenantPayments,
  getEstatePayments,
  getAllPayments,
  recordManualPayment,
  downloadPaymentReceipt,
  refundDeposit,
  sendPaymentReceipt,
  sendTenantReceipt,
  getTenantReceipts
};
