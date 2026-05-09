const Issue = require('../models/Issue');
const Tenant = require('../models/Tenant');
const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary');
const { logError } = require('../utils/logger');
const { sendActivityToSlack } = require('../utils/slackService');

const ADMIN_ROLES = ['super_admin', 'admin', 'super_manager', 'business_owner', 'manager'];
const VALID_STAGES = ['review', 'started', 'inprogress', 'completed'];

// ─── Cloudinary helper ────────────────────────────────────────────────────────

function uploadToCloudinary(buffer, options) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
        stream.end(buffer);
    });
}

async function uploadFiles(files, folder) {
    const uploaded = [];
    if (!files || files.length === 0) return uploaded;

    ensureCloudinaryConfigured();

    for (const file of files) {
        const isVideo = file.mimetype.startsWith('video/');
        const result = await uploadToCloudinary(file.buffer, {
            folder,
            resource_type: isVideo ? 'video' : 'image'
        });
        uploaded.push({
            url: result.secure_url,
            publicId: result.public_id,
            type: isVideo ? 'video' : 'image'
        });
    }
    return uploaded;
}

// ─── Create Issue ──────────────────────────────────────────────────────────────

// @desc    Report a new issue
// @route   POST /api/issues
// @access  Private (all roles)
exports.createIssue = async (req, res) => {
    try {
        const { title, description, category, priority } = req.body;

        if (!title || !description) {
            return res.status(400).json({ success: false, message: 'Title and description are required' });
        }

        // Auto-detect estate/unit from tenant record
        const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
            .populate('estate', 'name')
            .populate('unit', 'label');

        // Combine all uploaded files (images + videos)
        const allFiles = [
            ...(req.files?.images || []),
            ...(req.files?.videos || [])
        ];

        const folder = `${process.env.CLOUDINARY_FOLDER || 'uploads'}/issues`;
        const media = allFiles.length > 0 ? await uploadFiles(allFiles, folder) : [];

        const issue = await Issue.create({
            title,
            description,
            category: category || 'other',
            priority: priority || 'medium',
            reporter: req.user.id,
            estate: req.body.estateId || tenant?.estate?._id,
            unit: req.body.unitId || tenant?.unit?._id,
            tenant: tenant?._id,
            media,
            timeline: [{
                stage: 'review',
                note: 'Issue submitted for review',
                media: [],
                updatedBy: req.user.id
            }]
        });

        await issue.populate([
            { path: 'reporter', select: 'name email' },
            { path: 'estate', select: 'name' },
            { path: 'unit', select: 'label' }
        ]);

        sendActivityToSlack('New Issue Reported', {
            title,
            category: category || 'other',
            priority: priority || 'medium',
            reportedBy: req.user.name || req.user.email,
            estate: tenant?.estate?.name || 'N/A',
            unit: tenant?.unit?.label || 'N/A',
            media: `${media.length} file(s)`
        }, '#E74C3C', '🚨');

        res.status(201).json({
            success: true,
            message: 'Issue reported successfully',
            data: issue
        });
    } catch (err) {
        logError('createIssue error', err);
        res.status(500).json({ success: false, message: 'Error reporting issue' });
    }
};

// ─── Get Issues (role-aware list) ─────────────────────────────────────────────

// @desc    Get issues (own for tenants, estate-level for admins)
// @route   GET /api/issues
// @access  Private (all roles)
exports.getIssues = async (req, res) => {
    try {
        const { status, category, priority, page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = Math.min(parseInt(limit), 100);
        const skip = (pageNum - 1) * limitNum;

        const filter = { isActive: true };

        if (status) filter.status = status;
        if (category) filter.category = category;
        if (priority) filter.priority = priority;

        if (req.user.role === 'super_admin') {
            // super_admin sees all
        } else if (ADMIN_ROLES.includes(req.user.role)) {
            const allowedEstates = req.user.assignedEstates || [];
            filter.estate = allowedEstates.length > 0
                ? { $in: allowedEstates }
                : { $in: [] };
        } else {
            filter.reporter = req.user.id;
        }

        const [issues, total] = await Promise.all([
            Issue.find(filter)
                .populate('reporter', 'name email')
                .populate('estate', 'name')
                .populate('unit', 'label')
                .populate('assignedTo', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum),
            Issue.countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            count: issues.length,
            total,
            page: pageNum,
            pages: Math.ceil(total / limitNum),
            data: issues
        });
    } catch (err) {
        logError('getIssues error', err);
        res.status(500).json({ success: false, message: 'Error fetching issues' });
    }
};

// ─── Get Single Issue ─────────────────────────────────────────────────────────

// @desc    Get a single issue with full timeline
// @route   GET /api/issues/:id
// @access  Private
exports.getIssue = async (req, res) => {
    try {
        const issue = await Issue.findOne({ _id: req.params.id, isActive: true })
            .populate('reporter', 'name email')
            .populate('estate', 'name')
            .populate('unit', 'label')
            .populate('assignedTo', 'name email')
            .populate('timeline.updatedBy', 'name email role');

        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }

        // Access check: reporter, admin of that estate, or super_admin
        const isReporter = issue.reporter._id.toString() === req.user.id;
        const isAdmin = ADMIN_ROLES.includes(req.user.role);
        if (!isReporter && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        res.status(200).json({ success: true, data: issue });
    } catch (err) {
        logError('getIssue error', err);
        res.status(500).json({ success: false, message: 'Error fetching issue' });
    }
};

// ─── Update Stage ─────────────────────────────────────────────────────────────

// @desc    Advance issue stage with optional proof media and note
// @route   PATCH /api/issues/:id/status
// @access  Private (admin roles or reporter)
exports.updateIssueStatus = async (req, res) => {
    try {
        const { status, note } = req.body;

        if (!status || !VALID_STAGES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status must be one of: ${VALID_STAGES.join(', ')}`
            });
        }

        const issue = await Issue.findOne({ _id: req.params.id, isActive: true });
        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }

        const isReporter = issue.reporter.toString() === req.user.id;
        const isAdmin = ADMIN_ROLES.includes(req.user.role);

        if (!isReporter && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Not authorised to update this issue' });
        }

        // Enforce forward-only stage progression for non-admins
        const stageOrder = { review: 0, started: 1, inprogress: 2, completed: 3 };
        const currentOrder = stageOrder[issue.status] ?? -1;
        const newOrder = stageOrder[status] ?? -1;

        if (!isAdmin && newOrder < currentOrder) {
            return res.status(400).json({
                success: false,
                message: `Cannot move issue back to '${status}'. Current stage is '${issue.status}'`
            });
        }

        // Upload proof media (images + videos)
        const allFiles = [
            ...(req.files?.images || []),
            ...(req.files?.videos || [])
        ];

        const folder = `${process.env.CLOUDINARY_FOLDER || 'uploads'}/issues/proof`;
        const proofMedia = allFiles.length > 0 ? await uploadFiles(allFiles, folder) : [];

        // Add timeline entry
        issue.timeline.push({
            stage: status,
            note: note || `Stage updated to ${status}`,
            media: proofMedia,
            updatedBy: req.user.id,
            updatedAt: new Date()
        });

        issue.status = status;
        if (status === 'completed') issue.resolvedAt = new Date();

        await issue.save();

        await issue.populate([
            { path: 'reporter', select: 'name email' },
            { path: 'estate', select: 'name' },
            { path: 'unit', select: 'label' },
            { path: 'timeline.updatedBy', select: 'name email role' }
        ]);

        const stageColors = {
            review: '#439FE0',
            started: '#FF9800',
            inprogress: '#9C27B0',
            completed: '#36a64f',
            cancelled: '#888888'
        };

        sendActivityToSlack('Issue Status Updated', {
            title: issue.title,
            stage: status,
            note: note || 'No note',
            proof: `${proofMedia.length} file(s)`,
            updatedBy: req.user.name || req.user.email
        }, stageColors[status] || '#888888', '🔄');

        res.status(200).json({
            success: true,
            message: `Issue moved to '${status}'`,
            data: issue
        });
    } catch (err) {
        logError('updateIssueStatus error', err);
        res.status(500).json({ success: false, message: 'Error updating issue status' });
    }
};

// ─── Assign Issue ──────────────────────────────────────────────────────────────

// @desc    Assign an issue to a user (admin only)
// @route   PATCH /api/issues/:id/assign
// @access  Private (admin roles)
exports.assignIssue = async (req, res) => {
    try {
        if (!ADMIN_ROLES.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Admins only' });
        }

        const { assignedTo } = req.body;
        if (!assignedTo) {
            return res.status(400).json({ success: false, message: 'assignedTo user ID is required' });
        }

        const issue = await Issue.findOneAndUpdate(
            { _id: req.params.id, isActive: true },
            { assignedTo },
            { new: true }
        )
            .populate('reporter', 'name email')
            .populate('estate', 'name')
            .populate('assignedTo', 'name email');

        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }

        res.status(200).json({ success: true, message: 'Issue assigned', data: issue });
    } catch (err) {
        logError('assignIssue error', err);
        res.status(500).json({ success: false, message: 'Error assigning issue' });
    }
};

// ─── Cancel / Delete Issue ────────────────────────────────────────────────────

// @desc    Cancel (soft-delete) an issue
// @route   DELETE /api/issues/:id
// @access  Private (reporter or admin)
exports.cancelIssue = async (req, res) => {
    try {
        const issue = await Issue.findOne({ _id: req.params.id, isActive: true });
        if (!issue) {
            return res.status(404).json({ success: false, message: 'Issue not found' });
        }

        const isReporter = issue.reporter.toString() === req.user.id;
        const isAdmin = ADMIN_ROLES.includes(req.user.role);

        if (!isReporter && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Not authorised' });
        }

        if (issue.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Cannot cancel a completed issue' });
        }

        issue.status = 'cancelled';
        issue.isActive = false;
        issue.timeline.push({
            stage: 'review',
            note: `Cancelled by ${req.user.name || req.user.email}`,
            media: [],
            updatedBy: req.user.id
        });
        await issue.save();

        res.status(200).json({ success: true, message: 'Issue cancelled' });
    } catch (err) {
        logError('cancelIssue error', err);
        res.status(500).json({ success: false, message: 'Error cancelling issue' });
    }
};
