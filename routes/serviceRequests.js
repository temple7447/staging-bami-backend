const express = require('express');
const { protect } = require('../middleware/auth');
const {
    createServiceRequest,
    getMyRequests,
    getVendorTasks,
    updateServiceRequestStatus
} = require('../controllers/serviceRequestController');

const router = express.Router();

router.use(protect);

router.post('/', createServiceRequest);
router.get('/my-requests', getMyRequests);
router.get('/vendor-tasks', getVendorTasks);
router.put('/:id/status', updateServiceRequestStatus);

module.exports = router;
