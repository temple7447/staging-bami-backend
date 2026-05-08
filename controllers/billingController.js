const BillingItem = require('../models/BillingItem');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Payment = require('../models/Payment');
const { sendActivityToSlack } = require('../utils/slackService');
const { getCurrentRent } = require('../utils/rentCalculator');

// @desc    Create a new billing item for a tenant
// @route   POST /api/billing/tenants/:tenantId/billing
// @access  Private (Admin/Super Admin)
exports.createBillingItem = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { itemType, label, amount, dueDate, description, isRecurring, frequency } = req.body;

        // Validate tenant exists
        const tenant = await Tenant.findById(tenantId).populate('estate');
        if (!tenant || !tenant.isActive) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }

        // Create billing item
        const billingItem = await BillingItem.create({
            user: tenant.user, // Link to user
            tenant: tenantId,
            estate: tenant.estate._id,
            itemType,
            label,
            amount,
            dueDate,
            description,
            isRecurring: isRecurring || false,
            frequency: frequency || 'once',
            createdBy: req.user.id
        });

        sendActivityToSlack('New Invoice Generated', {
            tenant: tenant.tenantName,
            label: billingItem.label,
            amount: `₦${billingItem.amount.toLocaleString()}`,
            due: new Date(billingItem.dueDate).toLocaleDateString(),
            createdBy: req.user.name || req.user.email
        }, '#FF9800', '📄');

        res.status(201).json({
            success: true,
            message: 'Billing item created successfully',
            data: billingItem
        });
    } catch (err) {
        console.error('Create billing item error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while creating billing item' });
    }
};

// @desc    Get all billing items for a tenant
// @route   GET /api/billing/tenants/:tenantId/billing
// @access  Private (Admin/Super Admin)
exports.getBillingItems = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { includeInactive = false, includePaid = false } = req.query;

        // Validate tenant exists
        const tenant = await Tenant.findById(tenantId);
        if (!tenant || !tenant.isActive) {
            return res.status(404).json({ success: false, message: 'Tenant not found' });
        }

        // Build query
        const query = { tenant: tenantId };
        if (!includeInactive) query.isActive = true;
        if (!includePaid) query.isPaid = false;

        const billingItems = await BillingItem.find(query)
            .sort({ dueDate: 1, createdAt: -1 })
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        res.status(200).json({
            success: true,
            count: billingItems.length,
            data: billingItems
        });
    } catch (err) {
        console.error('Get billing items error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while fetching billing items' });
    }
};

// @desc    Update a billing item
// @route   PUT /api/billing/:itemId
// @access  Private (Admin/Super Admin)
exports.updateBillingItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { itemType, label, amount, dueDate, description, isRecurring, frequency } = req.body;

        let billingItem = await BillingItem.findById(itemId);
        if (!billingItem || !billingItem.isActive) {
            return res.status(404).json({ success: false, message: 'Billing item not found' });
        }

        // Don't allow updating paid items
        if (billingItem.isPaid) {
            return res.status(400).json({ success: false, message: 'Cannot update a paid billing item' });
        }

        // Update fields
        if (itemType) billingItem.itemType = itemType;
        if (label) billingItem.label = label;
        if (amount !== undefined) billingItem.amount = amount;
        if (dueDate) billingItem.dueDate = dueDate;
        if (description !== undefined) billingItem.description = description;
        if (isRecurring !== undefined) billingItem.isRecurring = isRecurring;
        if (frequency) billingItem.frequency = frequency;
        billingItem.updatedBy = req.user.id;

        await billingItem.save();

        res.status(200).json({
            success: true,
            message: 'Billing item updated successfully',
            data: billingItem
        });
    } catch (err) {
        console.error('Update billing item error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while updating billing item' });
    }
};

// @desc    Delete a billing item (soft delete)
// @route   DELETE /api/billing/:itemId
// @access  Private (Admin/Super Admin)
exports.deleteBillingItem = async (req, res) => {
    try {
        const { itemId } = req.params;

        const billingItem = await BillingItem.findById(itemId);
        if (!billingItem || !billingItem.isActive) {
            return res.status(404).json({ success: false, message: 'Billing item not found' });
        }

        // Don't allow deleting paid items
        if (billingItem.isPaid) {
            return res.status(400).json({ success: false, message: 'Cannot delete a paid billing item' });
        }

        billingItem.isActive = false;
        billingItem.updatedBy = req.user.id;
        await billingItem.save();

        res.status(200).json({
            success: true,
            message: 'Billing item deleted successfully'
        });
    } catch (err) {
        console.error('Delete billing item error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while deleting billing item' });
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86400000;

/**
 * Returns the number of days between now and a future/past date.
 * Positive = days remaining, negative = days overdue.
 */
function daysFromNow(date) {
    if (!date) return null;
    return Math.ceil((new Date(date) - new Date()) / MS_PER_DAY);
}

/**
 * Check which one-time fee codes have already been paid for a tenant.
 * Returns a Set of paid codes.
 */
async function getPaidOneTimeFees(tenantId) {
    const paid = new Set();
    const completedPayments = await Payment.find({
        tenant: tenantId,
        paymentStatus: 'completed',
        isActive: true,
        paymentType: { $in: ['caution_fee', 'legal_fee', 'initial', 'bundle'] }
    }).select('paymentType paystackResponse');

    for (const p of completedPayments) {
        if (p.paymentType === 'caution_fee') paid.add('caution_fee');
        if (p.paymentType === 'legal_fee') paid.add('legal_fee');

        // Initial / bundle payments embed billing_items in the Paystack response metadata
        const items = p.paystackResponse?.data?.metadata?.billing_items
            || p.paystackResponse?.metadata?.billing_items
            || [];
        for (const item of items) {
            if (item.type === 'caution_fee' || item.code === 'caution_fee') paid.add('caution_fee');
            if (item.type === 'legal_fee' || item.code === 'legal_fee') paid.add('legal_fee');
        }
    }
    return paid;
}

/**
 * Build a full billing breakdown for one tenant.
 * Used for both the tenant self-view and the admin per-tenant detail view.
 */
async function buildTenantDetail(tenant) {
    const unit = tenant.unit;
    const now = new Date();

    const dueIn = daysFromNow(tenant.nextDueDate);
    const isOverdue = dueIn !== null && dueIn < 0;

    // ── 1. Recurring charges ──────────────────────────────────────────────────
    const recurring = [];

    const rentBase = tenant.baseRent2024 || tenant.rentAmount || 0;
    if (rentBase > 0) {
        const effectiveRent = getCurrentRent(
            rentBase,
            tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
            false
        );
        recurring.push({
            code: 'rent',
            label: 'Rent',
            storedAmount: tenant.rentAmount,
            effectiveAmount: effectiveRent,
            isIncreased: effectiveRent > (tenant.rentAmount || 0),
            frequency: 'monthly',
            nextDueDate: tenant.nextDueDate,
            daysUntilDue: dueIn,
            isOverdue
        });
    }

    const serviceBase = tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || unit?.serviceChargeMonthly || 0;
    if (serviceBase > 0) {
        const effectiveService = getCurrentRent(
            serviceBase,
            tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt,
            false
        );
        recurring.push({
            code: 'service_charge',
            label: 'Service Charge',
            storedAmount: serviceBase,
            effectiveAmount: effectiveService,
            isIncreased: effectiveService > serviceBase,
            frequency: 'monthly',
            nextDueDate: tenant.nextDueDate,
            daysUntilDue: dueIn,
            isOverdue
        });
    }

    // ── 2. One-time fees ─────────────────────────────────────────────────────
    const oneTime = [];
    const paidFees = await getPaidOneTimeFees(tenant._id);

    if (unit?.cautionFee > 0) {
        const base = tenant.baseCaution2024 || unit.cautionFee;
        const effectiveAmount = getCurrentRent(
            base,
            tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt,
            false
        );
        const isPaid = paidFees.has('caution_fee');
        oneTime.push({
            code: 'caution_fee',
            label: 'Caution Fee',
            amount: effectiveAmount,
            isPaid,
            status: isPaid ? 'paid' : 'unpaid'
        });
    }

    if (unit?.legalFee > 0) {
        const base = tenant.baseLegal2024 || unit.legalFee;
        const effectiveAmount = getCurrentRent(
            base,
            tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt,
            false
        );
        const isPaid = paidFees.has('legal_fee');
        oneTime.push({
            code: 'legal_fee',
            label: 'Legal Fee',
            amount: effectiveAmount,
            isPaid,
            status: isPaid ? 'paid' : 'unpaid'
        });
    }

    // ── 3. Admin-created billing items (utility bills, maintenance, etc.) ────
    const billingItemDocs = await BillingItem.find({
        tenant: tenant._id,
        isActive: true
    }).sort({ dueDate: 1 });

    const utilityBills = billingItemDocs.map(item => {
        const itemDue = daysFromNow(item.dueDate);
        return {
            id: item._id,
            code: item.itemType,
            label: item.label,
            amount: item.amount,
            dueDate: item.dueDate,
            isPaid: item.isPaid,
            isOverdue: !item.isPaid && item.dueDate && itemDue < 0,
            daysOverdue: !item.isPaid && item.dueDate && itemDue < 0 ? Math.abs(itemDue) : 0,
            daysUntilDue: !item.isPaid ? itemDue : null,
            isRecurring: item.isRecurring,
            frequency: item.frequency,
            description: item.description
        };
    });

    // ── 4. Summary totals ────────────────────────────────────────────────────
    const recurringMonthly = recurring.reduce((s, i) => s + i.effectiveAmount, 0);
    const unpaidOneTime = oneTime.filter(i => !i.isPaid).reduce((s, i) => s + i.amount, 0);
    const unpaidUtility = utilityBills.filter(i => !i.isPaid).reduce((s, i) => s + i.amount, 0);
    const overdueUtility = utilityBills.filter(i => i.isOverdue).reduce((s, i) => s + i.amount, 0);
    const overdueRecurring = isOverdue ? recurringMonthly : 0;

    return {
        tenant: {
            id: tenant._id,
            name: tenant.tenantName,
            email: tenant.tenantEmail,
            phone: tenant.tenantPhone,
            unit: tenant.unitLabel || unit?.label,
            estate: tenant.estate?.name || tenant.estate,
            nextDueDate: tenant.nextDueDate,
            daysUntilDue: dueIn,
            isOverdue,
            tenantType: tenant.tenantType,
            status: tenant.status,
            entryDate: tenant.entryDate
        },
        charges: {
            recurring,
            oneTime,
            utilityBills
        },
        summary: {
            recurringMonthly,
            oneTimeUnpaid: unpaidOneTime,
            utilityUnpaid: unpaidUtility,
            totalOutstanding: unpaidOneTime + unpaidUtility + overdueRecurring,
            overdueAmount: overdueUtility + overdueRecurring,
            isOverdue,
            daysUntilDue: dueIn
        }
    };
}

// ─── Unified Billing Summary ──────────────────────────────────────────────────

/**
 * @desc    Unified billing summary for all roles
 * @route   GET /api/billing/summary
 * @access  Private (all authenticated users)
 *
 * Tenant / user  → their own full billing breakdown
 * Admin role + tenantId → full breakdown for that specific tenant
 * Admin role (no tenantId) → paginated list of all tenants + their billing summaries
 *
 * Query params (admin list view):
 *   estateId   — filter by estate (required if admin manages multiple)
 *   tenantId   — switch to single-tenant detail view
 *   status     — "overdue" | "unpaid" | "all"  (default: "all")
 *   page, limit
 */
exports.getBillingSummary = async (req, res) => {
    try {
        const { estateId, tenantId, status = 'all', page = 1, limit = 20 } = req.query;
        const role = req.user.role;

        const TENANT_ROLES = ['tenant', 'user'];
        const ADMIN_ROLES = ['super_admin', 'admin', 'super_manager', 'business_owner', 'manager'];

        // ── TENANT: show their own billing ───────────────────────────────────
        if (TENANT_ROLES.includes(role)) {
            const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
                .populate('unit', 'label serviceChargeMonthly cautionFee legalFee')
                .populate('estate', 'name');

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: 'No active tenant profile found for your account'
                });
            }

            const detail = await buildTenantDetail(tenant);
            return res.status(200).json({
                success: true,
                viewAs: 'tenant',
                data: detail
            });
        }

        // ── ADMIN: detail view for a specific tenant ──────────────────────────
        if (ADMIN_ROLES.includes(role) && tenantId) {
            const tenant = await Tenant.findOne({ _id: tenantId, isActive: true })
                .populate('unit', 'label serviceChargeMonthly cautionFee legalFee')
                .populate('estate', 'name');

            if (!tenant) {
                return res.status(404).json({ success: false, message: 'Tenant not found' });
            }

            const detail = await buildTenantDetail(tenant);
            return res.status(200).json({
                success: true,
                viewAs: 'admin_detail',
                data: detail
            });
        }

        // ── ADMIN: estate-level list view ─────────────────────────────────────
        if (ADMIN_ROLES.includes(role)) {
            // Determine which estates this user can access
            let estateFilter = {};
            if (role === 'super_admin') {
                estateFilter = estateId ? { estate: estateId } : {};
            } else {
                const allowedEstates = req.user.assignedEstates || [];
                if (allowedEstates.length === 0 && !estateId) {
                    return res.status(400).json({
                        success: false,
                        message: 'No estates assigned to your account. Provide estateId to continue.'
                    });
                }
                estateFilter = estateId
                    ? { estate: estateId }
                    : { estate: { $in: allowedEstates } };
            }

            const tenantQuery = { ...estateFilter, isActive: true };
            const pageNum = parseInt(page);
            const limitNum = Math.min(parseInt(limit), 100);
            const skip = (pageNum - 1) * limitNum;

            const [tenants, totalTenants] = await Promise.all([
                Tenant.find(tenantQuery)
                    .populate('unit', 'label serviceChargeMonthly cautionFee legalFee')
                    .populate('estate', 'name')
                    .sort({ tenantName: 1 })
                    .skip(skip)
                    .limit(limitNum),
                Tenant.countDocuments(tenantQuery)
            ]);

            if (tenants.length === 0) {
                return res.status(200).json({
                    success: true,
                    viewAs: 'admin_list',
                    data: { tenants: [], summary: { totalTenants: 0, overdueCount: 0, totalOutstanding: 0 } },
                    pagination: { currentPage: pageNum, totalPages: 0, totalItems: 0 }
                });
            }

            // Batch-fetch unpaid billing items for all tenants in one query
            const tenantIds = tenants.map(t => t._id);
            const [allBillingItems, allOneTimePmts] = await Promise.all([
                BillingItem.find({
                    tenant: { $in: tenantIds },
                    isActive: true,
                    isPaid: false
                }).select('tenant amount dueDate itemType label'),
                Payment.find({
                    tenant: { $in: tenantIds },
                    paymentStatus: 'completed',
                    isActive: true,
                    paymentType: { $in: ['caution_fee', 'legal_fee', 'initial', 'bundle'] }
                }).select('tenant paymentType paystackResponse')
            ]);

            // Index by tenantId for O(1) lookup
            const billsByTenant = {};
            for (const b of allBillingItems) {
                const tid = b.tenant.toString();
                if (!billsByTenant[tid]) billsByTenant[tid] = [];
                billsByTenant[tid].push(b);
            }

            const paidFeesByTenant = {};
            for (const p of allOneTimePmts) {
                const tid = p.tenant.toString();
                if (!paidFeesByTenant[tid]) paidFeesByTenant[tid] = new Set();
                const s = paidFeesByTenant[tid];
                if (p.paymentType === 'caution_fee') s.add('caution_fee');
                if (p.paymentType === 'legal_fee') s.add('legal_fee');
                const items = p.paystackResponse?.data?.metadata?.billing_items
                    || p.paystackResponse?.metadata?.billing_items || [];
                for (const item of items) {
                    if (item.type === 'caution_fee' || item.code === 'caution_fee') s.add('caution_fee');
                    if (item.type === 'legal_fee' || item.code === 'legal_fee') s.add('legal_fee');
                }
            }

            const now = new Date();
            const tenantSummaries = [];
            let estateOverdueCount = 0;
            let estateTotalOutstanding = 0;

            for (const tenant of tenants) {
                const unit = tenant.unit;
                const dueIn = daysFromNow(tenant.nextDueDate);
                const isOverdue = dueIn !== null && dueIn < 0;

                // Effective recurring amounts
                const effectiveRent = getCurrentRent(
                    tenant.baseRent2024 || tenant.rentAmount || 0,
                    tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
                    false
                );
                const serviceBase = tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || unit?.serviceChargeMonthly || 0;
                const effectiveService = serviceBase > 0
                    ? getCurrentRent(serviceBase, tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt, false)
                    : 0;
                const recurringMonthly = effectiveRent + effectiveService;

                // Unpaid one-time fees
                const paid = paidFeesByTenant[tenant._id.toString()] || new Set();
                let unpaidFees = 0;
                const unpaidFeeCodes = [];
                if (unit?.cautionFee > 0 && !paid.has('caution_fee')) {
                    unpaidFees += getCurrentRent(tenant.baseCaution2024 || unit.cautionFee, tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt, false);
                    unpaidFeeCodes.push('caution_fee');
                }
                if (unit?.legalFee > 0 && !paid.has('legal_fee')) {
                    unpaidFees += getCurrentRent(tenant.baseLegal2024 || unit.legalFee, tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt, false);
                    unpaidFeeCodes.push('legal_fee');
                }

                // Unpaid billing items (utility bills, etc.)
                const tenantBills = billsByTenant[tenant._id.toString()] || [];
                const unpaidUtility = tenantBills.reduce((s, b) => s + b.amount, 0);
                const overdueBills = tenantBills.filter(b => b.dueDate && new Date(b.dueDate) < now);
                const overdueUtility = overdueBills.reduce((s, b) => s + b.amount, 0);

                const overdueRecurring = isOverdue ? recurringMonthly : 0;
                const totalOutstanding = unpaidFees + unpaidUtility + overdueRecurring;
                const overdueAmount = overdueUtility + overdueRecurring;

                if (isOverdue || overdueAmount > 0) estateOverdueCount++;
                estateTotalOutstanding += totalOutstanding;

                tenantSummaries.push({
                    id: tenant._id,
                    name: tenant.tenantName,
                    email: tenant.tenantEmail,
                    unit: tenant.unitLabel || unit?.label,
                    estate: tenant.estate?.name,
                    nextDueDate: tenant.nextDueDate,
                    daysUntilDue: dueIn,
                    isOverdue,
                    tenantType: tenant.tenantType,
                    status: tenant.status,
                    recurringMonthly,
                    effectiveRent,
                    effectiveService,
                    unpaidFeeCodes,
                    unpaidFees,
                    unpaidBillingItems: tenantBills.length,
                    unpaidUtility,
                    totalOutstanding,
                    overdueAmount
                });
            }

            // Apply status filter after aggregation
            let filtered = tenantSummaries;
            if (status === 'overdue') {
                filtered = tenantSummaries.filter(t => t.isOverdue || t.overdueAmount > 0);
            } else if (status === 'unpaid') {
                filtered = tenantSummaries.filter(t => t.totalOutstanding > 0);
            }

            return res.status(200).json({
                success: true,
                viewAs: 'admin_list',
                data: {
                    tenants: filtered,
                    summary: {
                        totalTenants,
                        overdueCount: estateOverdueCount,
                        totalOutstanding: estateTotalOutstanding
                    }
                },
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(totalTenants / limitNum),
                    totalItems: totalTenants,
                    itemsPerPage: limitNum
                }
            });
        }

        return res.status(403).json({ success: false, message: 'Access denied' });

    } catch (err) {
        console.error('Get billing summary error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while fetching billing summary' });
    }
};
