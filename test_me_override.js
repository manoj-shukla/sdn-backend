const axios = require('axios');
const db = require('./config/database');
const AuthService = require('./services/AuthService');

async function testMe() {
    try {
        db.get("SELECT email FROM users WHERE role = 'SUPPLIER' ORDER BY createdat DESC LIMIT 1", [], async (err, row) => {
            if (err) {
                console.error("DB Error:", err);
                process.exit(1);
            }
            if (!row) {
                console.log("No supplier user found.");
                process.exit(0);
            }

            console.log(`Testing with user ${row.email}...`);

            try {
                const loginResult = await AuthService.login(row.email, "Admin123!");
                const token = loginResult.token;
                const memberships = loginResult.user.memberships;

                if (!memberships || memberships.length === 0) {
                    console.log("User has no memberships, cannot test override.");
                    process.exit(0);
                }

                const activeSupplierId = memberships[0].supplierId || memberships[0].supplierid;
                console.log(`Active Supplier ID from memberships: ${activeSupplierId}`);

                // First request without headers, checking baseline
                const res1 = await axios.get('http://localhost:8083/api/auth/me', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log(`Baseline supplierId: ${res1.data.supplierId}`);

                // Second request WITH override header
                const res2 = await axios.get('http://localhost:8083/api/auth/me', {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'X-Supplier-Id': activeSupplierId
                    }
                });
                console.log(`Override supplierId: ${res2.data.supplierId}`);
                console.log(`Override supplierName: ${res2.data.supplierName}`);

                process.exit(res2.data.supplierId == activeSupplierId ? 0 : 1);
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

testMe();
