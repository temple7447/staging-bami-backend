const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
const materialsDir = path.join(uploadDir, 'materials');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(materialsDir)) {
  fs.mkdirSync(materialsDir, { recursive: true });
}

// Define allowed file types
const allowedFileTypes = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar'
};

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, materialsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename while preserving original extension
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname);
    const filename = `${uniqueSuffix}${ext}`;
    cb(null, filename);
  }
});

// File filter function
const fileFilter = (req, file, cb) => {
  const isAllowed = allowedFileTypes.hasOwnProperty(file.mimetype);
  
  if (isAllowed) {
    cb(null, true);
  } else {
    const allowedExtensions = Object.values(allowedFileTypes).join(', ');
    cb(new Error(`Invalid file type. Allowed types: ${allowedExtensions}`), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 1 // Single file upload
  },
  fileFilter: fileFilter
});

// Utility functions
const getFileType = (mimetype) => {
  return allowedFileTypes[mimetype] || 'unknown';
};

const getFileSize = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch (error) {
    return 0;
  }
};

const deleteFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
};

const getFileInfo = (file) => {
  if (!file) return null;
  
  return {
    fileName: file.filename,
    originalFileName: file.originalname,
    fileSize: file.size,
    fileType: getFileType(file.mimetype),
    mimeType: file.mimetype,
    filePath: file.path,
    fileUrl: `/api/materials/download/${file.filename}` // URL for downloading
  };
};

// Middleware for single file upload
const uploadSingle = upload.single('file');

// Middleware for handling upload errors
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 100MB.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Only one file allowed per upload.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field. Use "file" as the field name.'
      });
    }
  }
  
  if (err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  console.error('File upload error:', err);
  res.status(500).json({
    success: false,
    message: 'File upload failed'
  });
};

// Get file metadata (for video/audio duration, PDF pages, etc.)
const getFileMetadata = async (filePath, fileType) => {
  const metadata = {};
  
  try {
    // For different file types, you can add specific metadata extraction
    // For now, just return basic info
    const stats = fs.statSync(filePath);
    metadata.fileSize = stats.size;
    metadata.createdAt = stats.birthtime;
    metadata.modifiedAt = stats.mtime;
    
    // TODO: Add specific metadata extraction for different file types
    // - For videos: duration, resolution
    // - For audio: duration, bitrate
    // - For PDFs: page count
    // - For documents: word count, page count
    
  } catch (error) {
    console.error('Error getting file metadata:', error);
  }
  
  return metadata;
};

module.exports = {
  uploadSingle,
  handleUploadError,
  getFileInfo,
  getFileType,
  getFileSize,
  deleteFile,
  getFileMetadata,
  allowedFileTypes,
  uploadDir: materialsDir
};