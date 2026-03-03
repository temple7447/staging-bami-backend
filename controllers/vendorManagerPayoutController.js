const {
  processMonthlyPayout,
  getPayoutSettings,
  updatePayoutSettings,
  getPayoutStatus
} = require('../utils/vendorManagerPayoutService');

exports.getPayoutStatus = async (req, res) => {
  try {
    const status = await getPayoutStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Get payout status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting payout status',
      error: error.message
    });
  }
};

exports.getPayoutSettings = async (req, res) => {
  try {
    const settings = await getPayoutSettings();
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get payout settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting payout settings',
      error: error.message
    });
  }
};

exports.updatePayoutSettings = async (req, res) => {
  try {
    const { isEnabled, initialAmount } = req.body;
    
    const updates = {};
    if (typeof isEnabled === 'boolean') {
      updates.isEnabled = isEnabled;
    }
    if (typeof initialAmount === 'number' && initialAmount > 0) {
      updates.initialAmount = initialAmount;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid fields to update (isEnabled, initialAmount)'
      });
    }
    
    const settings = await updatePayoutSettings(updates);
    res.json({
      success: true,
      message: 'Payout settings updated successfully',
      data: settings
    });
  } catch (error) {
    console.error('Update payout settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating payout settings',
      error: error.message
    });
  }
};

exports.triggerPayout = async (req, res) => {
  try {
    const result = await processMonthlyPayout();
    res.json(result);
  } catch (error) {
    console.error('Trigger payout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing payout',
      error: error.message
    });
  }
};
