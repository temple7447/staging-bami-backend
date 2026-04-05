require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const config = {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/callback'
};

const oauth2Client = new google.auth.OAuth2(
  config.clientId,
  config.clientSecret,
  config.redirectUri
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file']
});

console.log('\n🔗 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n\n⏳ Waiting for authorization...\n');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/callback') {
    const code = parsedUrl.query.code;
    
    try {
      const { tokens } = await oauth2Client.getToken(code);
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <body style="font-family: sans-serif; padding: 50px; text-align: center;">
            <h2>✅ Success! Google Drive Connected</h2>
            <p>Add this to your .env file:</p>
            <pre style="background: #f0f0f0; padding: 20px; border-radius: 5px; font-size: 16px;">
GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}
            </pre>
            <p>Then restart your server.</p>
          </body>
        </html>
      `);
      
      console.log('\n✅ SUCCESS! Copy this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      
      server.close();
      process.exit(0);
    } catch (error) {
      res.writeHead(500);
      res.end('Error: ' + error.message);
      server.close();
    }
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Waiting for Google callback on http://localhost:${PORT}/callback`);
  console.log(`⚠️  Make sure to add http://localhost:${PORT}/callback to "Authorized redirect URIs" in Google Console`);
});