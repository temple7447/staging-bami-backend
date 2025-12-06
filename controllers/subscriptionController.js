const Subscription = require('../models/Subscription');
const { logError, logInfo } = require('../utils/logger');

/**
 * Create a new subscription
 */
const createSubscription = async (req, res) => {
    try {
        const { name, price, billingPeriod, description, icon, status, features } = req.body;
        const adminId = req.user?.id;

        // Validate required fields
        if (!name || !price || !billingPeriod) {
            return res.status(400).json({
                success: false,
                message: 'Name, price, and billing period are required'
            });
        }

        // Process features - split by newlines if it's a string
        let featuresArray = features;
        if (typeof features === 'string') {
            featuresArray = features
                .split('\n')
                .map(f => f.trim())
                .filter(f => f.length > 0);
        }

        // Create subscription
        const subscription = new Subscription({
            name,
            price,
            billingPeriod,
            description,
            icon,
            status: status || 'Active',
            features: featuresArray || [],
            createdBy: adminId
        });

        await subscription.save();

        logInfo('Subscription created', { subscriptionId: subscription._id, name: subscription.name });

        res.status(201).json({
            success: true,
            message: 'Subscription created successfully',
            data: subscription
        });
    } catch (error) {
        logError('createSubscription error', error);
        res.status(500).json({
            success: false,
            message: 'Error creating subscription',
            error: error.message
        });
    }
};

/**
 * Get all subscriptions
 */
const getAllSubscriptions = async (req, res) => {
    try {
        const { status, billingPeriod, page = 1, limit = 20 } = req.query;

        const filter = { isActive: true };
        if (status) filter.status = status;
        if (billingPeriod) filter.billingPeriod = billingPeriod;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [subscriptions, total] = await Promise.all([
            Subscription.find(filter)
                .populate('createdBy', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Subscription.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            data: subscriptions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total
            }
        });
    } catch (error) {
        logError('getAllSubscriptions error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscriptions',
            error: error.message
        });
    }
};

/**
 * Get subscription by ID
 */
const getSubscriptionById = async (req, res) => {
    try {
        const { id } = req.params;

        const subscription = await Subscription.findById(id)
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        if (!subscription || !subscription.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        res.status(200).json({
            success: true,
            data: subscription
        });
    } catch (error) {
        logError('getSubscriptionById error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching subscription',
            error: error.message
        });
    }
};

/**
 * Update subscription
 */
const updateSubscription = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, billingPeriod, description, icon, status, features } = req.body;
        const adminId = req.user?.id;

        const subscription = await Subscription.findById(id);

        if (!subscription || !subscription.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        // Process features - split by newlines if it's a string
        let featuresArray = features;
        if (typeof features === 'string') {
            featuresArray = features
                .split('\n')
                .map(f => f.trim())
                .filter(f => f.length > 0);
        }

        // Update fields
        if (name !== undefined) subscription.name = name;
        if (price !== undefined) subscription.price = price;
        if (billingPeriod !== undefined) subscription.billingPeriod = billingPeriod;
        if (description !== undefined) subscription.description = description;
        if (icon !== undefined) subscription.icon = icon;
        if (status !== undefined) subscription.status = status;
        if (featuresArray !== undefined) subscription.features = featuresArray;
        subscription.updatedBy = adminId;

        await subscription.save();

        logInfo('Subscription updated', { subscriptionId: subscription._id, name: subscription.name });

        res.status(200).json({
            success: true,
            message: 'Subscription updated successfully',
            data: subscription
        });
    } catch (error) {
        logError('updateSubscription error', error);
        res.status(500).json({
            success: false,
            message: 'Error updating subscription',
            error: error.message
        });
    }
};

/**
 * Delete subscription (soft delete)
 */
const deleteSubscription = async (req, res) => {
    try {
        const { id } = req.params;

        const subscription = await Subscription.findById(id);

        if (!subscription || !subscription.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Subscription not found'
            });
        }

        subscription.isActive = false;
        subscription.updatedBy = req.user?.id;
        await subscription.save();

        logInfo('Subscription deleted', { subscriptionId: subscription._id, name: subscription.name });

        res.status(200).json({
            success: true,
            message: 'Subscription deleted successfully'
        });
    } catch (error) {
        logError('deleteSubscription error', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting subscription',
            error: error.message
        });
    }
};

module.exports = {
    createSubscription,
    getAllSubscriptions,
    getSubscriptionById,
    updateSubscription,
    deleteSubscription
};
