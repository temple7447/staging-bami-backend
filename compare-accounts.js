const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function debug() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const User = require('./models/User');
        const Wallet = require('./models/Wallet');
        const Transaction = require('./models/Transaction');

        const emails = ['templevoke@gmail.com', 'temple1voke@gmail.com'];

        for (const email of emails) {
            const user = await User.findOne({ email });
            if (!user) {
                console.log(`--- Email: ${email} -> NOT FOUND ---`);
                continue;
            }
            console.log(`--- User: ${user.email} (ID: ${user._id}, Role: ${user.role}) ---`);
            const wallet = await Wallet.findOne({ userId: user._id });
            console.log(`  Wallet Balance: ${wallet ? wallet.balance : 'NONE'}`);
            const txs = await Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(10);
            console.log(`  Recent Transactions (${txs.length}):`);
            txs.forEach(t => console.log(`    - Ref: ${t.reference}, Amount: ${t.amount}, Status: ${t.status}, Time: ${t.createdAt}`));
            console.log('');
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
debug();
