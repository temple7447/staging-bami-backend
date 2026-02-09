const BillingItem = require('../models/BillingItem');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const { sendActivityToSlack } = require('../utils/slackService');

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
