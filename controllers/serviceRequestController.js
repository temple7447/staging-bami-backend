const ServiceRequest = require('../models/ServiceRequest');
const Tenant = require('../models/Tenant');
const { logError } = require('../utils/logger');

// @desc    Create a service request
// @route   POST /api/service-requests
// @access  Private
exports.createServiceRequest = async (req, res) => {
    try {
        const { vendor, businessType, description, scheduledDate, estate, unit } = req.body;

        // Auto-detect estate/unit if requester is a tenant (as fallback)
        const tenantRecord = await Tenant.findOne({ user: req.user.id, isActive: true });

        const serviceRequest = await ServiceRequest.create({
            requester: req.user.id,
            vendor,
            businessType,
            estate: estate || (tenantRecord ? tenantRecord.estate : undefined),
            unit: unit || (tenantRecord ? tenantRecord.unit : undefined),
            description,
            scheduledDate,
            createdBy: req.user.id
        });

        res.status(201).json({
            success: true,
            message: 'Service request sent successfully',
            data: serviceRequest
        });
    } catch (error) {
        logError('createServiceRequest error', error);
        res.status(500).json({
            success: false,
            message: 'Error creating service request',
            error: error.message
        });
    }
};

// @desc    Get requests made by the logged-in user
// @route   GET /api/service-requests/my-requests
// @access  Private
exports.getMyRequests = async (req, res) => {
    try {
        const requests = await ServiceRequest.find({ requester: req.user.id, isActive: true })
            .populate('vendor', 'name businessName phone')
            .populate('businessType', 'name icon')
            .populate('estate', 'name address')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        logError('getMyRequests error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching your requests'
        });
    }
};

// @desc    Get requests assigned to the logged-in vendor
// @route   GET /api/service-requests/vendor-tasks
// @access  Private (Vendor only)
exports.getVendorTasks = async (req, res) => {
    try {
        if (req.user.role !== 'vendor' && req.user.role !== 'super_vendor') {
            return res.status(403).json({ success: false, message: 'Access denied. Vendors only.' });
        }

        const requests = await ServiceRequest.find({ vendor: req.user.id, isActive: true })
            .populate('requester', 'name email phone')
            .populate('businessType', 'name icon')
            .populate('estate', 'name address')
            .populate('unit', 'label')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        logError('getVendorTasks error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching vendor tasks'
        });
    }
};

// @desc    Update service request status
// @route   PUT /api/service-requests/:id/status
// @access  Private (Vendor or Requester)
exports.updateServiceRequestStatus = async (req, res) => {
    try {
        const { status, vendorNotes } = req.body;
        const request = await ServiceRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }

        // Authorization: Only vendor or requester can update
        const isVendor = request.vendor.toString() === req.user.id;
        const isRequester = request.requester.toString() === req.user.id;

        if (!isVendor && !isRequester) {
            return res.status(403).json({ success: false, message: 'Not authorized to update this request' });
        }

        // Business logic for status transitions
        if (isRequester && !['cancelled'].includes(status)) {
            return res.status(403).json({ success: false, message: 'Requesters can only cancel requests' });
        }

        if (status) request.status = status;
        if (vendorNotes && isVendor) request.vendorNotes = vendorNotes;

        await request.save();

        res.status(200).json({
            success: true,
            message: `Request marked as ${status}`,
            data: request
        });
    } catch (error) {
        logError('updateServiceRequestStatus error', error);
        res.status(500).json({
            success: false,
            message: 'Error updating request status'
        });
    }
};
