const bcrypt = require('bcryptjs');
const hash = '$2b$10$JgBJfIh7P2YQHYpnIy9HmOCa4CICLPq7mllCLxfWHVpS2Xm3fnnZa';
bcrypt.compare('admin123', hash, (err, result) => {
    console.log('Matches admin123:', result);
    process.exit();
});
