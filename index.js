require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

// Config & Middleware
const db = require('./config/database');
const errorHandler = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const buyerRoutes = require('./routes/buyerRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const documentRoutes = require('./routes/documentRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const messageRoutes = require('./routes/messageRoutes');
const circleRoutes = require('./routes/circleRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const workflowRoutes = require('./routes/workflowRoutes');
const commonRoutes = require('./routes/commonRoutes');
const changeRequestRoutes = require('./routes/changeRequestRoutes');
const roleRoutes = require('./routes/roleRoutes');
const reportRoutes = require('./routes/reportRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const rfiRoutes = require('./routes/rfiRoutes');
const rfpRoutes = require('./routes/rfpRoutes');

const app = express();
const PORT = process.env.PORT || 8080;

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
console.log(`[DEBUG-INIT] Starting server on port: ${PORT}`);
console.log("### SERVER HEARTBEAT: 2026-02-27-00-17 ###");

// Middlewares
// Request logger - MOVED TO TOP
app.use((req, res, next) => {
    console.log(`[Req] ${req.method} ${req.url}`);
    next();
});

app.use(cors());
app.use(express.json());

// Serving Uploads
const os = require('os');
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL;
const uploadDir = isVercel ? os.tmpdir() : 'uploads';
if (!isVercel && !fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// Health check - tests DB connectivity
app.get('/health', (req, res) => {
    db.get('SELECT 1 as ok', [], (err, row) => {
        if (err) {
            return res.status(503).json({
                status: 'error',
                db: 'unreachable',
                message: err.message
            });
        }
        res.json({ status: 'ok', db: 'connected' });
    });
});

// Swagger
// To fix "SwaggerUIBundle is not defined" on Vercel production,
// we serve the swagger-ui assets from a CDN instead of the local node_modules
const swaggerOptions = {
    customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui.min.css',
    customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui-bundle.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/swagger-ui-standalone-preset.js'
    ],
    customfavIcon: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/4.18.3/favicon-32x32.png',
    customSiteTitle: "Supplier Onboarding API",
};

// We still need swaggerUi.serveFiles for any internal static fallback
app.use('/api-docs', swaggerUi.serveFiles(swaggerDocument, swaggerOptions));

app.get('/api-docs', (req, res) => {
    let html = swaggerUi.generateHTML(swaggerDocument, swaggerOptions);
    // Strip out the broken local relative scripts so the browser ONLY loads from CDN customJs
    html = html.replace(/<script src="\.\/swagger-ui-bundle\.js"><\/script>/g, '');
    html = html.replace(/<script src="\.\/swagger-ui-bundle\.js"> <\/script>/g, '');
    html = html.replace(/<script src="\.\/swagger-ui-standalone-preset\.js"><\/script>/g, '');
    html = html.replace(/<script src="\.\/swagger-ui-standalone-preset\.js"> <\/script>/g, '');
    html = html.replace(/<link rel="stylesheet" type="text\/css" href="\.\/swagger-ui\.css" >/g, '');
    res.send(html);
});

// swaggerUi.setup generates the swagger-ui-init.js dynamic file needed to initialize
app.use('/api-docs', swaggerUi.setup(swaggerDocument, swaggerOptions));
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));

// Database Init — start the HTTP server only after schema is ready
(async () => {
    try {
        if (db.init) {
            await db.init();
            console.log('Database initialized');
        }
    } catch (err) {
        console.error('Database initialization failed:', err);
    } finally {
        // Always start listening, even if migrations had warnings,
        // so the server doesn't hang. Core tables are created above.
        if (require.main === module) {
            app.listen(PORT, () => {
                console.log(`Server running on http://localhost:${PORT}`);
            });
        }
    }
})();

const { authenticateToken } = require('./middleware/authMiddleware');

// Debug routes
app.get('/api/debug/auth', authenticateToken, async (req, res) => {
    try {
        const UserService = require('./services/UserService');
        const dbUser = await UserService.getUserById(req.user.userId);
        res.json({
            tokenUser: req.user,
            dbUser: dbUser
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



// Mount Routes
app.use('/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/buyers', buyerRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/circles', circleRoutes); // Prefix for Circle Routes
app.use('/api/analytics', analyticsRoutes);
app.use('/api', workflowRoutes); // Mapped to /api/workflows and /api/approvals (defined in router)
app.use('/api', commonRoutes);   // Mapped to /api/contacts and /api/addresses
app.use('/api/change-requests', changeRequestRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/rfi', rfiRoutes);
app.use('/api/rfp', rfpRoutes);

// Root Check
app.get('/', (req, res) => {
    res.json({ status: 'API Running', env: process.env.NODE_ENV });
});

// Global Error Handler
app.use(errorHandler);

// --- TEMPORARY TEST ENDPOINT ---
app.get('/test-approval-flow', async (req, res) => {
    const ChangeRequestService = require('./services/ChangeRequestService');
    const db = require('./config/database');
    const testSupplierName = "Test_Auto_Supplier_" + Date.now();
    const newLegalName = "Approved_Supplier_Name_" + Date.now();
    let supplierId, requestId;

    try {
        console.log("🚀 Starting Test Flow via API...");

        // 1. Create Supplier
        supplierId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO suppliers (legalName, businessType, country, isActive) VALUES (?, ?, ?, ?) RETURNING supplierId`,
                [testSupplierName, 'Corporation', 'TestLand', true],
                function (err) { err ? reject(err) : resolve(this.lastID); }
            );
        });

        // Fallback for ID
        if (!supplierId) {
            const row = await new Promise(r => db.get("SELECT supplierId FROM suppliers WHERE legalName = ?", [testSupplierName], (e, row) => r(row)));
            supplierId = row ? row.supplierId : null;
        }

        if (!supplierId) throw new Error("Failed to create supplier");

        // 2. Create Request
        requestId = await new Promise((resolve, reject) => {
            db.run(`INSERT INTO supplier_change_requests (supplierId, requestType, status, requestedByUserId, buyerId) VALUES (?, ?, ?, ?, ?) RETURNING requestId`,
                [supplierId, 'PROFILE_UPDATE', 'PENDING', 1, 1],
                function (err) { err ? reject(err) : resolve(this.lastID); }
            );
        });

        // Fallback for ID
        if (!requestId) {
            const row = await new Promise(r => db.get("SELECT requestId FROM supplier_change_requests WHERE supplierId = ? AND status = 'PENDING' ORDER BY requestId DESC LIMIT 1", [supplierId], (e, row) => r(row)));
            requestId = row ? row.requestId : null;
        }

        if (!requestId) throw new Error("Failed to create request");

        // 3. Create Item
        await new Promise((resolve, reject) => {
            db.run(`INSERT INTO supplier_change_items (requestId, fieldName, oldValue, newValue, changeCategory, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [requestId, 'legalName', testSupplierName, newLegalName, 'MAJOR', 'PENDING'],
                (err) => err ? reject(err) : resolve()
            );
        });

        // 4. Approve
        await ChangeRequestService.approveChangeRequest(requestId, 1, 'Admin');

        // 5. Verify
        const updatedSupplier = await new Promise(r => db.get("SELECT legalName FROM suppliers WHERE supplierId = ?", [supplierId], (e, row) => r(row)));

        if (updatedSupplier.legalName !== newLegalName) {
            throw new Error(`Verification Failed: Expected ${newLegalName}, got ${updatedSupplier.legalName}`);
        }

        // Cleanup
        await new Promise(r => db.run("DELETE FROM supplier_change_items WHERE requestId = ?", [requestId], r));
        await new Promise(r => db.run("DELETE FROM supplier_change_requests WHERE requestId = ?", [requestId], r));
        await new Promise(r => db.run("DELETE FROM suppliers WHERE supplierId = ?", [supplierId], r));

        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.resolve(__dirname, 'API_TEST_SUCCESS'), 'Test Passed: ' + new Date().toISOString());

        res.json({ success: true, message: "Test Passed: API_TEST_SUCCESS file created." });

    } catch (e) {
        console.error("Test Failed:", e);
        const fs = require('fs');
        const path = require('path');
        try { fs.writeFileSync(path.resolve(__dirname, 'API_TEST_FAILURE'), e.message); } catch (err) { }
        res.status(500).json({ success: false, error: e.message, stack: e.stack });
    }
});
// -------------------------------

// Server is started inside the DB init block above (after schema is ready)

module.exports = app;
