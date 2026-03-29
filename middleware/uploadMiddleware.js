const multer = require('multer');
const fs = require('fs');
const os = require('os');

const path = require('path');

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL;
const uploadDir = isVercel ? os.tmpdir() : path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists (Only local)
if (!isVercel && !fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({
    storage: storage,
    // limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

module.exports = { upload, uploadDir };
