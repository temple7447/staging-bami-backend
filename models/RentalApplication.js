const mongoose = require('mongoose');

const RentalApplicationSchema = new mongoose.Schema({
  // Which property they're applying for
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: [true, 'Estate is required']
  },
  unit: {
    type: mongoose.Schema.ObjectId,
    ref: 'Unit'
  },

  // Applicant personal details
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    maxlength: [150, 'Full name cannot exceed 150 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    maxlength: [20, 'Phone number cannot exceed 20 characters']
  },
  dateOfBirth: {
    type: Date
  },
  nationality: {
    type: String,
    trim: true,
    maxlength: [100, 'Nationality cannot exceed 100 characters']
  },
  currentAddress: {
    type: String,
    trim: true,
    maxlength: [300, 'Address cannot exceed 300 characters']
  },
  stateOfOrigin: {
    type: String,
    trim: true,
    maxlength: [100, 'State of origin cannot exceed 100 characters']
  },

  // Employment / Income
  employmentStatus: {
    type: String,
    enum: ['employed', 'self_employed', 'unemployed', 'student', 'retired', 'other'],
    required: [true, 'Employment status is required']
  },
  employer: {
    type: String,
    trim: true,
    maxlength: [150, 'Employer name cannot exceed 150 characters']
  },
  jobTitle: {
    type: String,
    trim: true,
    maxlength: [100, 'Job title cannot exceed 100 characters']
  },
  monthlyIncome: {
    type: Number,
    min: [0, 'Monthly income cannot be negative']
  },

  // References
  nextOfKinName: {
    type: String,
    trim: true,
    maxlength: [150, 'Next of kin name cannot exceed 150 characters']
  },
  nextOfKinPhone: {
    type: String,
    trim: true,
    maxlength: [20, 'Next of kin phone cannot exceed 20 characters']
  },
  nextOfKinRelationship: {
    type: String,
    trim: true,
    maxlength: [80, 'Relationship cannot exceed 80 characters']
  },

  // Rental preferences
  preferredMoveInDate: {
    type: Date
  },
  numberOfOccupants: {
    type: Number,
    min: [1, 'At least 1 occupant required'],
    max: [20, 'Too many occupants'],
    default: 1
  },
  hasPets: {
    type: Boolean,
    default: false
  },
  additionalNotes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },

  // Admin tracking
  status: {
    type: String,
    enum: ['pending', 'under_review', 'approved', 'rejected', 'waitlisted'],
    default: 'pending'
  },
  statusNote: {
    type: String,
    trim: true,
    maxlength: [500, 'Status note cannot exceed 500 characters']
  },
  reviewedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

RentalApplicationSchema.index({ estate: 1, status: 1, createdAt: -1 });
RentalApplicationSchema.index({ unit: 1, status: 1 });
RentalApplicationSchema.index({ email: 1 });

module.exports = mongoose.model('RentalApplication', RentalApplicationSchema);
