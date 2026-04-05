require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const FOLDER_NAME = 'BamiHustle Database';
const FILE_NAME = 'latest_backup.json';

const getAuthClient = () => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost'
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
  return oauth2Client;
};

const uploadToGoogleDrive = async (sourceFilePath, targetFileName = null) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
      console.log('⚠️  Google Drive not configured. Set in .env:');
      console.log('   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
      return { success: false, error: 'Not configured' };
    }

    if (!fs.existsSync(sourceFilePath)) {
      return { success: false, error: `File not found: ${sourceFilePath}` };
    }

    const auth = getAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // Find or create folder
    const folderResponse = await drive.files.list({
      q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)'
    });

    let folderId;
    if (folderResponse.data.files.length > 0) {
      folderId = folderResponse.data.files[0].id;
      console.log(`📁 Using existing folder: ${FOLDER_NAME}`);
    } else {
      const folder = await drive.files.create({
        resource: { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = folder.data.id;
      console.log(`📁 Created folder: ${FOLDER_NAME}`);
    }

    // Use provided filename or generate one with timestamp
    const fileName = targetFileName || `backup_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;

    const fileMetadata = { 
      name: fileName, 
      parents: [folderId] 
    };
    
    const media = { 
      mimeType: 'application/json',
      body: fs.createReadStream(sourceFilePath) 
    };

    console.log(`☁️  Uploading ${fileName} to Google Drive...`);
    
    const result = await drive.files.create({ 
      resource: fileMetadata, 
      media, 
      fields: 'id, name, webViewLink' 
    });

    console.log(`✅ Backup successfully uploaded to Google Drive`);
    console.log(`🔗 Link: ${result.data.webViewLink}`);

    return { 
      success: true, 
      id: result.data.id,
      name: result.data.name,
      link: result.data.webViewLink 
    };
  } catch (error) {
    console.error('❌ Google Drive upload failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { uploadToGoogleDrive };

if (require.main === module) {
  console.log('This script is called automatically by the scheduler.');
  console.log('Run: node scripts/setupGoogleDrive.js to configure Google Drive first.');
}