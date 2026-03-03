const mongoose = require('mongoose');

const SettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  description: {
    type: String
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Setting', SettingSchema);
