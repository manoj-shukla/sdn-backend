const axios = require('axios');
const db = require('./config/database');
const AuthService = require('./services/AuthService');

async function testMyRequests() {
    try {
        // Find the last created user
        db.get("SELECT email FROM users ORDER BY createdat DESC LIMIT 1", [], async (err, row) => {
            if (err) {
                console.error("Fetch User Failed:", err);
                process.exit(1);
            }
            const email = row.email;
            console.log(`Testing with user ${email}...`);

            try {
                // Login to get a valid token
                const loginResult = await AuthService.login(email, "Password123!");
                const token = loginResult.token;

                console.log("Logged in. Fetching my-requests...");
                const res = await axios.get('http://localhost:8083/api/change-requests/my-requests', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log("Success:", res.data);
                process.exit(0);
            } catch (e) {
                console.error("Failed:", e.response ? e.response.data : e.message);
                process.exit(1);
            }
        });
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

testMyRequests();
