const axios = require('axios');
const db = require('./config/database');
const AuthService = require('./services/AuthService');

async function reproduceSave() {
    db.get("SELECT email FROM sdn_users WHERE email = 'test_1772241719976@example.com'", [], async (err, row) => {
        if (!row) {
            console.log("No supplier user found.");
            process.exit(0);
        }

        console.log(`Testing save with user ${row.email}...`);
        try {
            const loginResult = await AuthService.login(row.email, "Password123!");
            const token = loginResult.token;
            const activeSupplierId = loginResult.user.memberships[0].supplierId || loginResult.user.memberships[0].supplierid;

            const payload = {
                legalName: "Test Name Updated",
                country: "US",
                businessType: "SME",
                website: "https://test.com",
                description: "Test description",
                taxId: "123456789",
                bankName: "Bank",
                accountNumber: "123",
                routingNumber: "123"
            };

            const res = await axios.put(`http://localhost:8083/api/suppliers/${activeSupplierId}`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'X-Supplier-Id': activeSupplierId
                }
            });
            console.log("Success:", res.data);
            process.exit(0);
        } catch (e) {
            console.error("Save Failed:", e.response ? e.response.data : e.message);
            process.exit(1);
        }
    });
}

reproduceSave();
