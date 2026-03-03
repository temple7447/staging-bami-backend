const express = require('express');
const router = express.Router();
const {
  getPayoutStatus,
  getPayoutSettings,
  updatePayoutSettings,
  triggerPayout
} = require('../controllers/vendorManagerPayoutController');

router.get('/status', getPayoutStatus);
router.get('/settings', getPayoutSettings);
router.put('/settings', updatePayoutSettings);
router.post('/trigger', triggerPayout);

module.exports = router;
