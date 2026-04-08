// Run: node check-user-email.js
const db = require('./config/database');

const EMAIL = 'chndn.mishra@gmail.com';

setTimeout(() => {
    db.get(
        `SELECT userid, username, email, role, subrole, isactive, buyerid, supplierid
         FROM users
         WHERE email = $1 OR username = $1`,
        [EMAIL],
        (err, row) => {
            if (err) {
                console.error('DB Error:', err.message);
            } else if (row) {
                console.log('\n✅ User EXISTS:\n');
                console.table([row]);
            } else {
                console.log(`\n❌ No user found with email: ${EMAIL}`);
                console.log('   (They may need to be invited or created manually)\n');
            }
            process.exit(0);
        }
    );
}, 1500);
