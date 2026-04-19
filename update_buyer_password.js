const db = require('./config/database');
const bcrypt = require('bcryptjs');

const username = "rbac_buyer1_mm43tkgr";

(async () => {
    const hashedPassword = await bcrypt.hash("Admin123!", 10);
    db.run("UPDATE sdn_users SET password = ? WHERE username = ?", [hashedPassword, username], function (err) {
        if (err) {
            console.error("Error:", err);
            process.exit(1);
        }
        console.log(`Password updated for buyer: ${username}`);
        db.close().then(() => process.exit(0));
    });
})();
