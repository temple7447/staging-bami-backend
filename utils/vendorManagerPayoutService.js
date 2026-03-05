const Setting = require('../models/Setting');
const User = require('../models/User');
const Estate = require('../models/Estate');
const WalletAccount = require('../models/WalletAccount');
const Wallet = require('../models/Wallet');
const { logError, logInfo } = require('./logger');
const { sendWalletPayoutEmail } = require('./walletEmailService');

const SETTINGS_KEY = 'vendor_manager_payout';

const DEFAULT_INITIAL_AMOUNT = 20000;
const INCREASE_PERCENTAGE = 0.26;
const INCREASE_INTERVAL_YEARS = 2;

const getPayoutSettings = async () => {
  let settings = await Setting.findOne({ key: SETTINGS_KEY });
  
  if (!settings) {
    settings = new Setting({
      key: SETTINGS_KEY,
      value: {
        initialAmount: DEFAULT_INITIAL_AMOUNT,
        lastIncreaseDate: new Date(),
        lastPayoutDate: null,
        currentAmount: DEFAULT_INITIAL_AMOUNT,
        increaseCycleCount: 0,
        isEnabled: true
      },
      description: 'Vendor and Manager monthly payout configuration'
    });
    await settings.save();
  }
  
  return settings.value;
};

const updatePayoutSettings = async (newSettings) => {
  const settings = await Setting.findOne({ key: SETTINGS_KEY });
  if (settings) {
    settings.value = { ...settings.value, ...newSettings };
    await settings.save();
    return settings.value;
  }
  return null;
};

const calculateCurrentAmount = async () => {
  const payoutSettings = await getPayoutSettings();
  const now = new Date();
  const lastIncrease = new Date(payoutSettings.lastIncreaseDate);
  
  const yearsSinceLastIncrease = (now - lastIncrease) / (1000 * 60 * 60 * 24 * 365);
  
  if (yearsSinceLastIncrease >= INCREASE_INTERVAL_YEARS) {
    const cycles = Math.floor(yearsSinceLastIncrease / INCREASE_INTERVAL_YEARS);
    const newAmount = payoutSettings.initialAmount * Math.pow(1 + INCREASE_PERCENTAGE, cycles);
    const newIncreaseDate = new Date(lastIncrease);
    newIncreaseDate.setFullYear(newIncreaseDate.getFullYear() + (cycles * INCREASE_INTERVAL_YEARS));
    
    await updatePayoutSettings({
      currentAmount: newAmount,
      lastIncreaseDate: newIncreaseDate,
      increaseCycleCount: payoutSettings.increaseCycleCount + cycles
    });
    
    logInfo('Vendor/Manager payout amount increased', {
      previousAmount: payoutSettings.currentAmount,
      newAmount,
      cycles,
      newIncreaseDate
    });
    
    return newAmount;
  }
  
  return payoutSettings.currentAmount;
};

const getManagersWithEstates = async () => {
  const managers = await User.find({
    role: { $in: ['manager', 'super_manager'] },
    isActive: true
  }).populate('assignedEstates');
  
  const result = [];
  for (const manager of managers) {
    if (manager.assignedEstates && manager.assignedEstates.length > 0) {
      result.push({
        user: manager,
        estates: manager.assignedEstates
      });
    }
  }
  return result;
};

const getVendorsWithEstates = async () => {
  const vendors = await User.find({
    role: { $in: ['vendor', 'super_vendor'] },
    isActive: true
  });
  
  const vendorEstatesMap = new Map();
  
  const serviceRequests = await require('../models/ServiceRequest').find({
    vendor: { $in: vendors.map(v => v._id) },
    estate: { $exists: true, $ne: null },
    status: { $in: ['completed', 'in-progress', 'accepted'] }
  }).populate('estate');
  
  for (const sr of serviceRequests) {
    if (sr.estate) {
      const estateId = sr.estate._id.toString();
      if (!vendorEstatesMap.has(estateId)) {
        vendorEstatesMap.set(estateId, {
          estate: sr.estate,
          vendors: new Set()
        });
      }
      vendorEstatesMap.get(estateId).vendors.add(sr.vendor.toString());
    }
  }
  
  const result = [];
  for (const vendor of vendors) {
    const vendorEstateIds = [];
    for (const [estateId, data] of vendorEstatesMap) {
      if (data.vendors.has(vendor._id.toString())) {
        vendorEstateIds.push(data.estate);
      }
    }
    if (vendorEstateIds.length > 0) {
      result.push({
        user: vendor,
        estates: vendorEstateIds
      });
    }
  }
  
  return result;
};

const creditUserWallet = async (userId, amount, description) => {
  let wallet = await Wallet.findOne({ userId });
  
  if (!wallet) {
    wallet = new Wallet({
      userId,
      balance: 0,
      totalEarnings: 0,
      totalSpent: 0
    });
  }
  
  wallet.balance += amount;
  wallet.totalEarnings += amount;
  wallet.lastUpdated = new Date();
  
  await wallet.save();
  
  return wallet;
};

const deductFromOperationsBalance = async (estateId, amount) => {
  const walletAccount = await WalletAccount.findOne({ estate: estateId });
  
  if (!walletAccount) {
    throw new Error(`No wallet account found for estate ${estateId}`);
  }
  
  // C-20% Savings (Innovation Engine) - where 20000 goes to managers/vendors
  const innovationSavings = walletAccount.innovationEngineSavingsBalance;
  
  if (innovationSavings < amount) {
    throw new Error(`Insufficient innovation engine savings for estate ${estateId}. Available: ${innovationSavings}, Required: ${amount}`);
  }
  
  walletAccount.innovationEngineSavingsBalance -= amount;
  walletAccount.innovationEngineSavingsDistributions.push({
    amount: -amount,
    description: `Monthly vendor/manager payout (Innovation Engine Savings C-20%)`,
    createdAt: new Date()
  });
  
  walletAccount.lastUpdated = new Date();
  
  await walletAccount.save();
  
  return walletAccount;
};

const processMonthlyPayout = async () => {
  const payoutSettings = await getPayoutSettings();
  
  if (!payoutSettings.isEnabled) {
    return {
      success: false,
      message: 'Payout is currently disabled'
    };
  }
  
  const currentAmount = await calculateCurrentAmount();
  const now = new Date();
  
  const managersWithEstates = await getManagersWithEstates();
  const vendorsWithEstates = await getVendorsWithEstates();
  
  const payouts = [];
  const errors = [];
  let totalDistributed = 0;
  
  for (const { user, estates } of managersWithEstates) {
    for (const estate of estates) {
      try {
        await deductFromOperationsBalance(estate._id, currentAmount);
        await creditUserWallet(user._id, currentAmount, `Monthly manager payout from estate ${estate.name}`);
        
        // Send payout email
        try {
          await sendWalletPayoutEmail(user, currentAmount, estate.name, 'payout');
        } catch (emailError) {
          console.error(`Failed to send payout email to ${user.email}:`, emailError.message);
        }
        
        payouts.push({
          userId: user._id,
          userName: user.name,
          userRole: user.role,
          estateId: estate._id,
          estateName: estate.name,
          amount: currentAmount,
          type: 'manager'
        });
        totalDistributed += currentAmount;
      } catch (error) {
        errors.push({
          userId: user._id,
          estateId: estate._id,
          error: error.message
        });
      }
    }
  }
  
  for (const { user, estates } of vendorsWithEstates) {
    for (const estate of estates) {
      try {
        await deductFromOperationsBalance(estate._id, currentAmount);
        await creditUserWallet(user._id, currentAmount, `Monthly vendor payout from estate ${estate.name}`);
        
        // Send payout email
        try {
          await sendWalletPayoutEmail(user, currentAmount, estate.name, 'payout');
        } catch (emailError) {
          console.error(`Failed to send payout email to ${user.email}:`, emailError.message);
        }
        
        payouts.push({
          userId: user._id,
          userName: user.name,
          userRole: user.role,
          estateId: estate._id,
          estateName: estate.name,
          amount: currentAmount,
          type: 'vendor'
        });
        totalDistributed += currentAmount;
      } catch (error) {
        errors.push({
          userId: user._id,
          estateId: estate._id,
          error: error.message
        });
      }
    }
  }
  
  await updatePayoutSettings({
    lastPayoutDate: now
  });
  
  logInfo('Monthly vendor/manager payout processed', {
    currentAmount,
    totalDistributed,
    managerCount: managersWithEstates.length,
    vendorCount: vendorsWithEstates.length,
    successfulPayouts: payouts.length,
    errors: errors.length
  });
  
  return {
    success: true,
    currentAmount,
    payoutDate: now,
    summary: {
      totalManagers: managersWithEstates.length,
      totalVendors: vendorsWithEstates.length,
      successfulPayouts: payouts.length,
      failedPayouts: errors.length,
      totalDistributed
    },
    payouts,
    errors
  };
};

const getPayoutStatus = async () => {
  const payoutSettings = await getPayoutSettings();
  const currentAmount = await calculateCurrentAmount();
  
  const managersWithEstates = await getManagersWithEstates();
  const vendorsWithEstates = await getVendorsWithEstates();
  
  const nextIncreaseDate = new Date(payoutSettings.lastIncreaseDate);
  nextIncreaseDate.setFullYear(nextIncreaseDate.getFullYear() + INCREASE_INTERVAL_YEARS);
  
  const yearsUntilNextIncrease = (nextIncreaseDate - new Date()) / (1000 * 60 * 60 * 24 * 365);
  
  return {
    isEnabled: payoutSettings.isEnabled,
    initialAmount: payoutSettings.initialAmount,
    currentAmount,
    lastIncreaseDate: payoutSettings.lastIncreaseDate,
    lastPayoutDate: payoutSettings.lastPayoutDate,
    nextIncreaseDate,
    increaseCycleCount: payoutSettings.increaseCycleCount,
    increasePercentage: INCREASE_PERCENTAGE * 100,
    increaseIntervalYears: INCREASE_INTERVAL_YEARS,
    yearsUntilNextIncrease: Math.max(0, yearsUntilNextIncrease).toFixed(1),
    activeManagers: managersWithEstates.length,
    activeVendors: vendorsWithEstates.length,
    managersDetails: managersWithEstates.map(m => ({
      name: m.user.name,
      email: m.user.email,
      estates: m.estates.map(e => e.name)
    })),
    vendorsDetails: vendorsWithEstates.map(v => ({
      name: v.user.name,
      email: v.user.email,
      estates: v.estates.map(e => e.name)
    }))
  };
};

module.exports = {
  processMonthlyPayout,
  getPayoutSettings,
  updatePayoutSettings,
  calculateCurrentAmount,
  getPayoutStatus,
  DEFAULT_INITIAL_AMOUNT,
  INCREASE_PERCENTAGE,
  INCREASE_INTERVAL_YEARS
};
