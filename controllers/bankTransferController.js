const { BANK_ACCOUNT, generateBankTransferReference } = require('../utils/bankConfig');
const { logError } = require('../utils/logger');

// @desc    Return UBA bank transfer instructions for a wallet top-up
// @route   POST /api/wallet/deposit/request
// @access  Private
exports.requestDepositInstructions = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) < 100) {
      return res.status(400).json({ success: false, message: 'Minimum deposit amount is ₦100' });
    }

    const reference = generateBankTransferReference('DEP');

    res.status(200).json({
      success: true,
      data: {
        bankAccount: BANK_ACCOUNT,
        reference,
        amount: Number(amount),
        description: `Transfer ₦${Number(amount).toLocaleString()} to the account below and use the reference as your transfer narration. Contact admin once transfer is done.`,
      },
    });
  } catch (err) {
    logError('POST /api/wallet/deposit/request', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
