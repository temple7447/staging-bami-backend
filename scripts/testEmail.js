require('dotenv').config();
const { sendEmail } = require('../utils/emailService');

const testEmail = async () => {
  console.log('🚀 Starting Mailtrap Test...');
  try {
    const result = await sendEmail({
      email: 'starukido@gmail.com',
      subject: 'BamiHustle - Mailtrap Connection Test',
      message: 'Hello! This is a test message to confirm that your Mailtrap configuration is working. Please check your Mailtrap.io dashboard to see this message.',
      html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #007bff;">✅ Mailtrap Connection Successful!</h2>
          <p>Hello,</p>
          <p>This is a <strong>test message</strong> from your BamiHustle backend.</p>
          <p>If you can see this, it means your <code>MAILTRAP_TOKEN</code> and <code>MAILTRAP_SENDER_EMAIL</code> are configured correctly.</p>
          <hr>
          <p><strong>Note:</strong> In development mode, these emails go to your <a href="https://mailtrap.io/">Mailtrap Inbox</a>, not your real Gmail address.</p>
        </div>
      `
    });

    if (result.success) {
      console.log('✅ TEST SUCCESSFUL!');
      console.log('📩 Message ID:', result.messageId);
      console.log('🔗 Now go to https://mailtrap.io/ to view your message in the dashboard.');
    }
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
  }
};

testEmail();
