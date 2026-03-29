const db = require('./config/database');
const AuthService = require('./services/AuthService');

async function testMe() {
    try {
        // Find the last created user
        db.get("SELECT userId FROM users ORDER BY createdat DESC LIMIT 1", [], async (err, row) => {
            if (err) {
                console.error("Fetch User Failed:", err);
                process.exit(1);
            }
            const userId = row.userid || row.userId;
            console.log(`Testing getMe for user ${userId}...`);

            try {
                const user = await AuthService.getMe(userId);
                console.log("Mapped User Object:");
                console.log(JSON.stringify(user, null, 2));
                process.exit(0);
            } catch (e) {
                console.error("getMe Failed:", e);
                process.exit(1);
            }
        });
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}

testMe();
