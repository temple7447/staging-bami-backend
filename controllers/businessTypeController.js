const BusinessType = require('../models/BusinessType');
const { logError } = require('../utils/logger');

// @desc    Create business type
// @route   POST /api/business-types
// @access  Private (Admin/Super Admin)
exports.createBusinessType = async (req, res) => {
    try {
        const { name, description } = req.body;

        // Check if business type already exists
        const existingType = await BusinessType.findOne({
            name: new RegExp(`^${name}$`, 'i'),
            isActive: true
        });

        if (existingType) {
            return res.status(400).json({
                success: false,
                message: 'Business type with this name already exists'
            });
        }

        const businessType = await BusinessType.create({
            name,
            description,
            createdBy: req.user.id
        });

        res.status(201).json({
            success: true,
            message: 'Business type created successfully',
            data: businessType
        });
    } catch (error) {
        logError('createBusinessType error', error);
        res.status(500).json({
            success: false,
            message: 'Error creating business type',
            error: error.message
        });
    }
};

// @desc    Get all business types
// @route   GET /api/business-types
// @access  Private
exports.getBusinessTypes = async (req, res) => {
    try {
        const { page = 1, limit = 50, activeOnly = true } = req.query;

        const filter = activeOnly === 'true' ? { isActive: true } : {};
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [businessTypes, total] = await Promise.all([
            BusinessType.find(filter)
                .select('name description isActive createdAt')
                .sort({ name: 1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            BusinessType.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            count: businessTypes.length,
            data: businessTypes,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total
            }
        });
    } catch (error) {
        logError('getBusinessTypes error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching business types',
            error: error.message
        });
    }
};

// @desc    Get single business type
// @route   GET /api/business-types/:id
// @access  Private
exports.getBusinessType = async (req, res) => {
    try {
        const businessType = await BusinessType.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        if (!businessType) {
            return res.status(404).json({
                success: false,
                message: 'Business type not found'
            });
        }

        res.status(200).json({
            success: true,
            data: businessType
        });
    } catch (error) {
        logError('getBusinessType error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching business type',
            error: error.message
        });
    }
};

// @desc    Update business type
// @route   PUT /api/business-types/:id
// @access  Private (Admin/Super Admin)
exports.updateBusinessType = async (req, res) => {
    try {
        const { name, description } = req.body;

        const businessType = await BusinessType.findById(req.params.id);

        if (!businessType) {
            return res.status(404).json({
                success: false,
                message: 'Business type not found'
            });
        }

        // Check if new name conflicts with existing
        if (name && name !== businessType.name) {
            const existingType = await BusinessType.findOne({
                name: new RegExp(`^${name}$`, 'i'),
                isActive: true,
                _id: { $ne: req.params.id }
            });

            if (existingType) {
                return res.status(400).json({
                    success: false,
                    message: 'Business type with this name already exists'
                });
            }
        }

        if (name) businessType.name = name;
        if (description !== undefined) businessType.description = description;
        businessType.updatedBy = req.user.id;

        await businessType.save();

        res.status(200).json({
            success: true,
            message: 'Business type updated successfully',
            data: businessType
        });
    } catch (error) {
        logError('updateBusinessType error', error);
        res.status(500).json({
            success: false,
            message: 'Error updating business type',
            error: error.message
        });
    }
};

// @desc    Delete business type (soft delete)
// @route   DELETE /api/business-types/:id
// @access  Private (Admin/Super Admin)
exports.deleteBusinessType = async (req, res) => {
    try {
        const businessType = await BusinessType.findById(req.params.id);

        if (!businessType) {
            return res.status(404).json({
                success: false,
                message: 'Business type not found'
            });
        }

        businessType.isActive = false;
        businessType.updatedBy = req.user.id;
        await businessType.save();

        res.status(200).json({
            success: true,
            message: 'Business type deleted successfully'
        });
    } catch (error) {
        logError('deleteBusinessType error', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting business type',
            error: error.message
        });
    }
};
