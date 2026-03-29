const db = require('./config/database');
const bcrypt = require('bcryptjs');

async function checkAdmin() {
    db.get("SELECT * FROM users WHERE username = 'admin'", [], async (err, user) => {
        if (err) {
            console.error("Error:", err);
            process.exit(1);
        }
        if (!user) {
            console.log("Admin user not found");
            process.exit(1);
        }
        console.log("Admin User found:", JSON.stringify(user, null, 2));
        const match = await bcrypt.compare('admin123', user.password);
        console.log("Password 'admin123' matches:", match);
        process.exit(0);
    });
}

checkAdmin();
