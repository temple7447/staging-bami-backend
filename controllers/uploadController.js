const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary');

// Wrap Cloudinary upload_stream in a Promise for easier async/await usage
function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// POST /api/upload/image
// Expects multipart/form-data with a single file under field name "file"
// Returns Cloudinary upload result
async function uploadSingleImage(req, res) {
  try {
    ensureCloudinaryConfigured();

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const folder = process.env.CLOUDINARY_FOLDER || 'uploads';

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder,
      resource_type: 'image',
      // You can add transformations here if needed, e.g. width, height, format
      // transformation: [{ quality: 'auto', fetch_format: 'auto' }]
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('Upload image error:', err);
    const status = err.http_code || 500;
    return res.status(status).json({ success: false, message: err.message || 'Image upload failed' });
  }
}

// POST /api/upload/video
// Expects multipart/form-data with a single file under field name "file"
// Returns Cloudinary upload result
async function uploadSingleVideo(req, res) {
  try {
    ensureCloudinaryConfigured();

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const folder = process.env.CLOUDINARY_FOLDER || 'uploads';

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder,
      resource_type: 'video',
      // For large videos you might set chunk_size or eager transformations
    });

    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('Upload video error:', err);
    const status = err.http_code || 500;
    return res.status(status).json({ success: false, message: err.message || 'Video upload failed' });
  }
}

module.exports = {
  uploadSingleImage,
  uploadSingleVideo,
};
