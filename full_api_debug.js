const apiClient = require('axios');
const { SECRET_KEY } = require('./middleware/authMiddleware');
const jwt = require('jsonwebtoken');

async function fullDebug() {
    console.log('--- Comprehensive API Debug (Undefined Handling) ---');
    const baseUrl = 'http://localhost:8083';

    const token = jwt.sign({
        userId: 1,
        username: 'admin',
        role: 'ADMIN',
        buyerId: 1
    }, SECRET_KEY);

    const config = { headers: { Authorization: `Bearer ${token}` } };

    const endpoints = [
        { name: 'Invitations (Valid)', url: `/api/invitations/buyer/1` },
        { name: 'Invitations (Undefined)', url: `/api/invitations/buyer/undefined` }
    ];

    for (const ep of endpoints) {
        console.log(`Checking ${ep.name} (${ep.url})...`);
        try {
            const res = await apiClient.get(`${baseUrl}${ep.url}`, config);
            console.log(`  [${ep.name}] SUCCESS (${res.status})`);
        } catch (err) {
            console.log(`  [${ep.name}] FAILED (${err.response?.status || 'No Response'})`);
            console.log(`  Error Body:`, JSON.stringify(err.response?.data || err.message));
        }
    }
    process.exit(0);
}

fullDebug();
