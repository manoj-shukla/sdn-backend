const dotenvResult = require('dotenv').config();
if (dotenvResult.error) {
    console.warn("⚠️ Dotenv failed to load:", dotenvResult.error.message);
} else {
    // console.log("✓ Dotenv loaded successfully from:", path.resolve('.env'));
}
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
console.log("### LOADED DATABASE JS ###");
console.log("Env Check - PGHOST:", process.env.PGHOST ? "PRESENT" : "MISSING", "| VERCEL:", process.env.VERCEL || "FALSE");
const { awsCredentialsProvider } = require("@vercel/oidc-aws-credentials-provider");
const { attachDatabasePool } = require("@vercel/functions");
const { Signer } = require("@aws-sdk/rds-signer");

// FORCE POSTGRES (SQLite Removed)
const isPostgres = true;

let db;
const SALT_ROUNDS = 10;
class PostgresWrapper {
    constructor() {
        // 1. Environment Variables
        // 2. Fallback to Local Defaults (User Provided)
        const host = process.env.PGHOST || process.env.POSTGRES_HOST || (process.env.VERCEL ? null : 'localhost');
        const port = Number(process.env.PGPORT || process.env.POSTGRES_PORT || 5432);
        const user = process.env.PGUSER || process.env.POSTGRES_USER || 'postgres';
        const region = process.env.AWS_REGION || 'us-east-1';
        const dbName = process.env.PGDATABASE || process.env.POSTGRES_DATABASE || 'sdntech';

        if (!host && process.env.VERCEL) {
            console.error("CRITICAL: Database host (PGHOST) is missing in Vercel environment. Connection will fail.");
        }

        // IAM Config
        const roleArn = process.env.AWS_ROLE_ARN;

        // Password Logic
        let passwordConfig = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'Blink3PG@1';

        // Validation
        if (!host || !user) {
            console.error("CRITICAL: DB Host/User missing.");
        }

        console.log(`Configuring Helper: Host=${host}, User=${user}, Region=${region}, Role=${roleArn ? 'SET' : 'MISSING'}`);

        // IAM AUTHENTICATION LOGIC (@vercel/oidc-aws-credentials-provider)
        // Only if Role ARN is present.
        if (roleArn && (process.env.ENABLE_IAM_AUTH === 'true' || !passwordConfig)) {
            console.log("Using AWS IAM Auth (@aws-sdk/rds-signer)");
            try {
                const signerOptions = {
                    region: region,
                    hostname: host,
                    port: port,
                    username: user,
                };

                // Use OIDC provider ONLY on Vercel
                if (process.env.VERCEL) {
                    signerOptions.credentials = awsCredentialsProvider({
                        roleArn: roleArn,
                    });
                }

                const signer = new Signer(signerOptions);
                passwordConfig = () => signer.getAuthToken();
            } catch (err) {
                console.error("Failed to initialize IAM Signer:", err);
            }
        }

        const connectionConfig = {
            host: host,
            user: user,
            database: dbName,
            port: port,
            password: passwordConfig,
            ssl: { rejectUnauthorized: false },
            max: process.env.VERCEL ? 1 : 10,
            connectionTimeoutMillis: 30000,
            idleTimeoutMillis: 5000
        };
        // Disable SSL for localhost if not explicitly required (avoids self-signed errors)
        if (host === 'localhost' || host === '127.0.0.1') {
            delete connectionConfig.ssl;
        }

        this.config = connectionConfig;
        this.pool = new Pool(connectionConfig);

        // Vercel Helper to manage connection lifecycle
        try {
            attachDatabasePool(this.pool);
            console.log("Attached Vercel Database Pool Manager");
        } catch (e) {
            console.warn("Could not attach Vercel Database Pool (safe to ignore locally)", e.message);
        }

        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
        });

        console.log(`Connected to Postgres database at ${connectionConfig.host}`);

        // Queue for serial execution (mimicking sqlite3 serialize)
        this.queue = [];
        this.processing = false;
    }

    // Heuristic Helper: Translate SQLite query to Postgres
    _translateQuery(sql) {
        let i = 1;
        // Replace ? with $1, $2, etc.
        let text = sql.replace(/\?/g, () => `$${i++}`);

        // Handle Table Creation Syntax
        if (text.trim().toUpperCase().startsWith('CREATE TABLE')) {
            text = text.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
            text = text.replace(/DATETIME/gi, 'TIMESTAMP');
        }

        // Handle INSERT OR REPLACE (SQLite) -> ON CONFLICT
        // This is complex to do generically, but we can handle the simple ones
        if (text.trim().toUpperCase().startsWith('INSERT OR REPLACE')) {
            text = text.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
            // We need a conflict target. Usually 'email' or 'fieldName' or 'username'
            if (text.includes('password_resets')) {
                text += ' ON CONFLICT (email) DO UPDATE SET token = EXCLUDED.token, expiresAt = EXCLUDED.expiresAt';
            } else if (text.includes('field_change_classification')) {
                text += ' ON CONFLICT (fieldName) DO NOTHING';
            }
        }

        // Handle datetime('now') and datetime('now', '+X hours')
        text = text.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
        text = text.replace(/datetime\('now',\s*'\+(\d+)\s+hour'\)/gi, "CURRENT_TIMESTAMP + INTERVAL '$1 hour'");
        text = text.replace(/datetime\('now',\s*'\+(\d+)\s+minutes'\)/gi, "CURRENT_TIMESTAMP + INTERVAL '$1 minutes'");

        // Handle INSERT lastID requirement
        // If it's an INSERT, we append RETURNING * to get the ID for this.lastID simulation
        if (text.trim().toUpperCase().startsWith('INSERT')) {
            // Check if already has RETURNING
            if (!/RETURNING/i.test(text)) {
                text += ' RETURNING *';
            }
        }

        return text;
    }

    // Determine payload type for queuing
    _enqueue(type, sql, params, callback) {
        // console.log(`[DB] Enqueuing ${type}. Queue size before: ${this.queue.length}`);

        // Defensive: convert literal "null"/"undefined" strings to real nulls if they are being passed to integer columns
        // This prevents 'invalid input syntax for type integer' errors from accidental null-string propagation
        const sanitizedParams = (params || []).map(p => (p === "null" || p === "undefined" || p === undefined) ? null : p);

        this.queue.push({ type, sql, params: sanitizedParams, callback });
        this._processQueue();
    }

    async _processQueue() {
        if (this.queue.length === 0) return;

        // Process ALL pending items in the queue concurrently up to pool limit
        // Since we use a pool, we can just trigger them all.
        // However, to mimic the 'serial' feel but with better performance, 
        // we'll shift and execute.

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            this._executeQuery(item);
        }
    }

    async _executeQuery(item) {
        const text = this._translateQuery(item.sql);

        // Mock this.lastID and this.changes for callbacks using a local context
        const callbackContext = {
            lastID: null,
            changes: 0
        };

        console.log(`[DB] Executing: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
        const startTime = Date.now();
        try {
            const res = await this.pool.query(text, item.params);
            console.log(`[DB] Completed in ${Date.now() - startTime}ms. Rows: ${res.rows?.length || 0}`);

            // Handle Multi-statement results (Array) vs Single result
            const isBatch = Array.isArray(res);
            const lastResult = isBatch ? res[res.length - 1] : res;
            const rows = lastResult.rows || [];

            callbackContext.changes = res.rowCount || 0;

            if (!isBatch && res.command === 'INSERT' && rows.length > 0) {
                const row = rows[0];
                // Prioritize the ID column matching the entity if possible
                // We look for 'requestId', 'supplierId', 'userId', etc.
                // Or just the first column ending in 'Id' if it's SERIAL
                const idKeys = Object.keys(row).filter(k => k.toLowerCase().endsWith('id'));

                if (idKeys.length > 0) {
                    // If multiple, try to find one that is NOT already provided in params (likely the generated one)
                    // This is a heuristic.
                    callbackContext.lastID = row[idKeys[0]]; // Default to first

                    // If it's requestId, and it exists, use it
                    const requestIdKey = idKeys.find(k => k.toLowerCase() === 'requestid');
                    if (requestIdKey) callbackContext.lastID = row[requestIdKey];

                    const itemIdKey = idKeys.find(k => k.toLowerCase() === 'itemid');
                    if (itemIdKey) callbackContext.lastID = row[itemIdKey];

                    const userIdKey = idKeys.find(k => k.toLowerCase() === 'userid');
                    if (userIdKey) callbackContext.lastID = row[userIdKey];
                }
                console.log(`[DB Wrapper Debug] INSERT parsed. lastID set to ${callbackContext.lastID}, command: ${res.command}, idKeys found: ${idKeys.join(',')}`);
            } else if (text.toUpperCase().includes('INSERT')) {
                console.log(`[DB Wrapper Debug] INSERT skipped mapping. Command: ${res.command}, Rows: ${rows.length}`);
            }

            if (item.callback) {
                if (item.type === 'get') item.callback.call(callbackContext, null, rows[0]);
                else if (item.type === 'all') item.callback.call(callbackContext, null, rows);
                else item.callback.call(callbackContext, null); // run
            }
        } catch (err) {
            console.error(`Postgres Query Error: ${err.message}. Query: ${text}`);
            if (item.callback) item.callback.call({ lastID: null, changes: 0 }, err);
        }
    }

    serialize(callback) {
        // Just execute the callback, which triggers the runs/gets.
        // Since we are now always queuing in this wrapper, the queries inside callback 
        // will naturally be queued and executed in order.
        if (callback) callback();
    }

    run(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        this._enqueue('run', sql, params, callback);
    }

    get(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        this._enqueue('get', sql, params, callback);
    }

    all(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        this._enqueue('all', sql, params, callback);
    }

    async close() {
        if (this.pool) {
            const poolToClose = this.pool;
            this.pool = null; // Prevent double close
            await poolToClose.end();
            console.log("Database connection pool closed.");
        }
    }

    async init() {
        if (this.initialized) return;

        console.log("Initializing Database Schema...");

        // We use a promise wrapper for the sequential execution
        // Since 'serialize' definition in this wrapper just executes the callback:
        const runSchema = async () => {
            // Seed Admin Logic
            const seedSampleData = (supplierId, buyerId) => {
                // Seed some orders
                this.get("SELECT COUNT(*) as count FROM orders", [], (err, row) => {
                    if (!err && row.count == 0) {
                        const orders = [
                            [supplierId, buyerId, 'PO-2024-001', '2023-09-15', 5000, 'COMPLETED'],
                            [supplierId, buyerId, 'PO-2024-002', '2023-10-20', 7500, 'COMPLETED'],
                            [supplierId, buyerId, 'PO-2024-003', '2023-11-05', 12000, 'COMPLETED'],
                            [supplierId, buyerId, 'PO-2024-004', '2023-12-10', 8000, 'COMPLETED'],
                            [supplierId, buyerId, 'PO-2024-005', '2024-01-15', 15000, 'COMPLETED'],
                            [supplierId, buyerId, 'PO-2024-006', '2024-02-01', 11000, 'OPEN'],
                        ];
                        orders.forEach(o => {
                            this.run("INSERT INTO orders (supplierId, buyerId, orderNumber, orderDate, totalAmount, status) VALUES ($1, $2, $3, $4, $5, $6)", o);
                        });
                        console.log("Sample orders seeded.");
                    }
                });

                // Seed some invoices
                this.get("SELECT COUNT(*) as count FROM invoices", [], (err, row) => {
                    if (!err && row.count == 0) {
                        const invoices = [
                            [supplierId, buyerId, 'INV-001', '2023-09-20', 5000, 'PAID'],
                            [supplierId, buyerId, 'INV-002', '2023-10-25', 7500, 'PAID'],
                            [supplierId, buyerId, 'INV-003', '2023-11-10', 12000, 'PAID'],
                            [supplierId, buyerId, 'INV-004', '2023-12-15', 8000, 'PAID'],
                            [supplierId, buyerId, 'INV-005', '2024-01-20', 15000, 'PENDING'],
                        ];
                        invoices.forEach(i => {
                            this.run("INSERT INTO invoices (supplierId, buyerId, invoiceNumber, invoiceDate, amount, status) VALUES ($1, $2, $3, $4, $5, $6)", i);
                        });
                        console.log("Sample invoices seeded.");
                    }
                });
            };

            const seedAdmin = async () => {
                const adminUsername = "admin";
                const adminEmail = "admin@sdn.tech";

                try {
                    const hashedPassword = await bcrypt.hash("Admin123!", SALT_ROUNDS);
                    this.run(`
                        INSERT INTO users (username, password, email, role, subrole) 
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role, email = EXCLUDED.email
                    `,
                        [adminUsername, hashedPassword, adminEmail, "ADMIN", "Super Admin"],
                        (err) => {
                            if (err) console.error("Error seeding admin", err);
                            else console.log("Admin user seeded/updated successfully");
                        }
                    );
                } catch (e) {
                    console.error("Failed to hash admin password", e);
                }

                // Trigger sample data seeding if we have a supplier
                this.get("SELECT supplierId, buyerId FROM suppliers LIMIT 1", [], (err, row) => {
                    if (row && (row.supplierid || row.supplierId)) {
                        seedSampleData(row.supplierid || row.supplierId, row.buyerid || row.buyerId || 1);
                    }
                });
            };

            const sqlSchema = `
                CREATE TABLE IF NOT EXISTS users (
                    userId SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    email TEXT UNIQUE,
                    role TEXT NOT NULL CHECK(role IN ('ADMIN', 'BUYER', 'SUPPLIER')),
                    subRole TEXT,
                    buyerId INTEGER,
                    supplierId INTEGER,
                    circleId INTEGER,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    mustChangePassword BOOLEAN DEFAULT FALSE
                );

                CREATE TABLE IF NOT EXISTS suppliers (
                    supplierId SERIAL PRIMARY KEY,
                    legalName TEXT NOT NULL,
                    businessType TEXT,
                    country TEXT,
                    taxId TEXT,
                    website TEXT,
                    description TEXT,
                    bankName TEXT,
                    accountNumber TEXT,
                    routingNumber TEXT,
                    isActive BOOLEAN DEFAULT TRUE,
                    approvalStatus TEXT DEFAULT 'DRAFT',
                    profileStatus TEXT DEFAULT 'PENDING',
                    documentStatus TEXT DEFAULT 'PENDING',
                    financeStatus TEXT DEFAULT 'PENDING',
                    gstin TEXT,
                    isGstRegistered BOOLEAN DEFAULT FALSE,
                    submittedAt TIMESTAMP,
                    reviewedAt TIMESTAMP,
                    approvalNotes TEXT,
                    createdByUserId INTEGER,
                    createdByUsername TEXT,
                    buyerId INTEGER,
                    assignedWorkflowId INTEGER
                );

                CREATE TABLE IF NOT EXISTS buyers (
                    buyerId SERIAL PRIMARY KEY,
                    buyerName TEXT NOT NULL,
                    buyerCode TEXT UNIQUE,
                    email TEXT,
                    phone TEXT,
                    country TEXT,
                    isActive BOOLEAN DEFAULT TRUE,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedAt TIMESTAMP,
                    isSandboxActive BOOLEAN DEFAULT FALSE
                );

                CREATE TABLE IF NOT EXISTS reviews (
                    reviewId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    reviewCycle INTEGER DEFAULT 1,
                    reviewType TEXT,
                    previousStatus TEXT,
                    newStatus TEXT,
                    reviewedByUserId INTEGER,
                    reviewedByUsername TEXT,
                    reviewerRole TEXT,
                    buyerId INTEGER,
                    reviewDecision TEXT,
                    reviewComments TEXT,
                    reworkFields TEXT,
                    reviewedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    supplierResponse TEXT,
                    respondedByUserId INTEGER,
                    respondedAt TIMESTAMP,
                    section TEXT
                );

                CREATE TABLE IF NOT EXISTS documents (
                    documentId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    documentType TEXT NOT NULL,
                    documentName TEXT NOT NULL,
                    filePath TEXT,
                    fileSize INTEGER,
                    fileType TEXT,
                    verificationStatus TEXT DEFAULT 'PENDING',
                    expiryDate DATE,
                    notes TEXT,
                    isActive BOOLEAN DEFAULT TRUE,
                    uploadedByUserId INTEGER,
                    uploadedByUsername TEXT,
                    verifiedByUserId INTEGER,
                    verifiedAt TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS invitations (
                    invitationId SERIAL PRIMARY KEY,
                    buyerId INTEGER,
                    buyerName TEXT,
                    supplierId INTEGER,
                    supplierName TEXT, -- Keep for backward compatibility or display
                    invitedByUsername TEXT,
                    email TEXT NOT NULL,
                    invitationToken TEXT UNIQUE NOT NULL,
                    status TEXT DEFAULT 'PENDING',
                    expiresAt TIMESTAMP,
                    acceptedAt TIMESTAMP,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    role TEXT DEFAULT 'SUPPLIER',
                    -- Enhanced Invite Fields
                    legalName TEXT,
                    supplierType TEXT,
                    country TEXT,
                    categories TEXT, -- JSON
                    riskLevel TEXT,
                    paymentMethods TEXT, -- JSON
                    currency TEXT,
                    workflowId INTEGER,
                    isPreApproved BOOLEAN DEFAULT FALSE,
                    internalCode TEXT,
                    buyerComments TEXT
                );

                CREATE TABLE IF NOT EXISTS contacts (
                    contactId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    contactType TEXT,
                    firstName TEXT,
                    lastName TEXT,
                    email TEXT,
                    phone TEXT,
                    mobile TEXT,
                    designation TEXT,
                    department TEXT,
                    isPrimary BOOLEAN DEFAULT FALSE,
                    isActive BOOLEAN DEFAULT TRUE
                );

                CREATE TABLE IF NOT EXISTS addresses (
                    addressId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    addressType TEXT,
                    addressLine1 TEXT,
                    addressLine2 TEXT,
                    city TEXT,
                    stateProvince TEXT,
                    postalCode TEXT,
                    country TEXT,
                    isPrimary BOOLEAN DEFAULT FALSE,
                    isActive BOOLEAN DEFAULT TRUE
                );

                CREATE TABLE IF NOT EXISTS messages (
                    messageId SERIAL PRIMARY KEY,
                    supplierId INTEGER,
                    buyerId INTEGER,
                    subject TEXT,
                    content TEXT,
                    isRead BOOLEAN DEFAULT FALSE,
                    sentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    senderName TEXT,
                    recipientRole TEXT DEFAULT 'SUPPLIER',
                    priority TEXT DEFAULT 'NORMAL',
                    type TEXT DEFAULT 'MESSAGE'
                );

                CREATE TABLE IF NOT EXISTS circles (
                    circleId SERIAL PRIMARY KEY,
                    buyerId INTEGER NOT NULL,
                    circleName TEXT NOT NULL,
                    description TEXT,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(buyerId, circleName)
                );
                CREATE TABLE IF NOT EXISTS circle_members (
                    circleId INTEGER NOT NULL,
                    supplierId INTEGER NOT NULL,
                    joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(circleId, supplierId)
                );
                CREATE TABLE IF NOT EXISTS circle_workflows (
                    circleId INTEGER NOT NULL,
                    workflowId INTEGER NOT NULL,
                    assignedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(circleId, workflowId)
                );
                CREATE TABLE IF NOT EXISTS buyer_roles (
                    roleId SERIAL PRIMARY KEY,
                    buyerId INTEGER NOT NULL,
                    roleName TEXT NOT NULL,
                    description TEXT,
                    permissions TEXT, -- JSON
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS workflows (
                    workflowId SERIAL PRIMARY KEY,
                    buyerId INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    isActive BOOLEAN DEFAULT TRUE,
                    isDefault BOOLEAN DEFAULT FALSE,
                    isSystemEnforced BOOLEAN DEFAULT FALSE,
                    criteria TEXT, -- JSON
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS workflow_steps (
                    stepId SERIAL PRIMARY KEY,
                    workflowId INTEGER NOT NULL,
                    stepOrder INTEGER NOT NULL,
                    stepName TEXT NOT NULL,
                    assignedRoleId INTEGER,
                    assignedUserId INTEGER,
                    requiredActions TEXT, -- JSON Array
                    isOptional BOOLEAN DEFAULT FALSE,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS workflow_instances (
                    instanceId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    workflowTemplateId INTEGER NOT NULL,
                    currentStepOrder INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
                    submissionType TEXT DEFAULT 'INITIAL', -- INITIAL, RESUBMISSION, UPDATE
                    startedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completedAt TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS step_instances (
                    stepInstanceId SERIAL PRIMARY KEY,
                    instanceId INTEGER NOT NULL,
                    stepOrder INTEGER NOT NULL,
                    stepName TEXT NOT NULL,
                    assignedRoleId INTEGER,
                    assignedUserId INTEGER,
                    status TEXT DEFAULT 'WAITING', -- WAITING, PENDING, APPROVED, REJECTED, REWORK_REQUIRED
                    isOptional BOOLEAN DEFAULT FALSE,
                    actionByUserId INTEGER,
                    actionAt TIMESTAMP,
                    comments TEXT
                );

                CREATE TABLE IF NOT EXISTS country_risk_rules (
                    ruleId SERIAL PRIMARY KEY,
                    buyerId INTEGER NOT NULL,
                    country TEXT NOT NULL,
                    riskLevel TEXT NOT NULL DEFAULT 'Low',
                    workflowId INTEGER NOT NULL,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(buyerId, country)
                );

                CREATE TABLE IF NOT EXISTS orders (
                    orderId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    buyerId INTEGER NOT NULL,
                    orderNumber TEXT UNIQUE NOT NULL,
                    orderDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    totalAmount DECIMAL(15, 2),
                    currency TEXT DEFAULT 'USD',
                    status TEXT DEFAULT 'OPEN', -- OPEN, COMPLETED, CANCELLED
                    expectedDeliveryDate TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS invoices (
                    invoiceId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    buyerId INTEGER NOT NULL,
                    orderId INTEGER,
                    invoiceNumber TEXT UNIQUE NOT NULL,
                    invoiceDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    amount DECIMAL(15, 2),
                    status TEXT DEFAULT 'PENDING', -- PENDING, PAID, OVERDUE, REJECTED
                    dueDate TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS notifications (
                    notificationId SERIAL PRIMARY KEY,
                    type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    entityId TEXT,
                    recipientRole TEXT,
                    supplierId INTEGER,
                    buyerId INTEGER,
                    isRead BOOLEAN DEFAULT FALSE,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS password_resets (
                    email TEXT PRIMARY KEY,
                    token TEXT NOT NULL,
                    expiresat TIMESTAMP NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_documents_supplier ON documents(supplierId);
                CREATE INDEX IF NOT EXISTS idx_addresses_supplier ON addresses(supplierId);
                CREATE INDEX IF NOT EXISTS idx_contacts_supplier ON contacts(supplierId);
                CREATE INDEX IF NOT EXISTS idx_workflow_instances_supplier ON workflow_instances(supplierId);
                CREATE INDEX IF NOT EXISTS idx_step_instances_instance ON step_instances(instanceId);
                CREATE INDEX IF NOT EXISTS idx_scr_supplier ON supplier_change_requests(supplierId);
                CREATE INDEX IF NOT EXISTS idx_sci_request ON supplier_change_items(requestId);
            `;

            // Execute all schema creation in one batch
            await new Promise((resolve) => {
                this.run(sqlSchema, [], (err) => {
                    if (err) {
                        console.error("Error initializing schema:", err.message);
                    } else {
                        console.log("Schema Initialized Successfully (Batch Mode)");
                    }
                    resolve();
                });
            });

            // MIGRATION: Rename expires_at to expiresat if it exists
            await new Promise((resolve) => {
                this.run(`
                    DO $$ 
                    BEGIN 
                        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='password_resets' AND column_name='expires_at') THEN
                            ALTER TABLE password_resets RENAME COLUMN expires_at TO expiresat;
                        END IF;
                    END $$;
                `, [], (err) => {
                    if (err) console.warn("Migration (expires_at) Warning:", err.message);
                    else console.log("Migration (expires_at -> expiresat) completed or already done.");
                    resolve();
                });
            });

            // Seed Admin
            await seedAdmin();

            const migrationSql = `
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gstin TEXT;
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS isGstRegistered BOOLEAN DEFAULT FALSE;
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS profilestatus TEXT DEFAULT 'PENDING';
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS documentstatus TEXT DEFAULT 'PENDING';
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS financestatus TEXT DEFAULT 'PENDING';
                ALTER TABLE workflows ADD COLUMN IF NOT EXISTS isSystemEnforced BOOLEAN DEFAULT FALSE;
                ALTER TABLE workflows ADD COLUMN IF NOT EXISTS clonedFromId INTEGER;
                ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS stepDescription TEXT;
                ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS requiredActions TEXT;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS mustChangePassword BOOLEAN DEFAULT FALSE;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS isActive BOOLEAN DEFAULT TRUE;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS "firstName" TEXT;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastName" TEXT;
                ALTER TABLE workflow_instances ADD COLUMN IF NOT EXISTS submissionType TEXT DEFAULT 'INITIAL';
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS score INTEGER DEFAULT 0;
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS riskLevel TEXT DEFAULT 'Low';
            `;
            await new Promise((resolve) => {
                this.run(migrationSql, [], (err) => {
                    if (err) console.warn("Migration Warning (Safe to ignore if columns exist):", err.message);
                    else console.log("Migrations applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Milestone 2 - Supplier Lifecycle Management
            const milestone2Sql = `
                CREATE TABLE IF NOT EXISTS supplier_change_requests (
                    requestId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    requestType TEXT NOT NULL, 
                    status TEXT DEFAULT 'PENDING',
                    requestedByUserId INTEGER,
                    requestedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reviewedByUserId INTEGER,
                    reviewedAt TIMESTAMP,
                    rejectionReason TEXT,
                    buyerId INTEGER -- Scoped to buyer if needed
                );

                CREATE TABLE IF NOT EXISTS supplier_change_items (
                    itemId SERIAL PRIMARY KEY,
                    requestId INTEGER NOT NULL,
                    fieldName TEXT NOT NULL,
                    oldValue TEXT,
                    newValue TEXT,
                    changeCategory TEXT DEFAULT 'MINOR',
                    status TEXT DEFAULT 'PENDING',
                    rejectionReason TEXT,
                    reviewedByUserId INTEGER,
                    reviewedAt TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS supplier_audit_logs (
                    auditId SERIAL PRIMARY KEY,
                    supplierId INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    entityId INTEGER,
                    entityType TEXT,
                    changes TEXT, -- JSON stored as TEXT for compatibility
                    performedByUserId INTEGER,
                    performedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    userRole TEXT
                );

                CREATE TABLE IF NOT EXISTS field_change_classification (
                    classificationId SERIAL PRIMARY KEY,
                    fieldName TEXT UNIQUE NOT NULL,
                    category TEXT DEFAULT 'MINOR'
                );

                INSERT INTO field_change_classification (fieldName, category) VALUES 
                ('legalName', 'MAJOR'),
                ('taxId', 'MAJOR'),
                ('bankName', 'MAJOR'),
                ('accountNumber', 'MAJOR'),
                ('routingNumber', 'MAJOR'),
                ('description', 'MAJOR'),
                ('website', 'MAJOR'),
                ('address', 'MAJOR'),
                ('bank_account', 'MAJOR'),
                ('contact', 'MAJOR'),
                ('email', 'MINOR'),
                ('phone', 'MINOR')
                ON CONFLICT (fieldName) DO UPDATE SET category = EXCLUDED.category;

                CREATE TABLE IF NOT EXISTS bank_accounts (
                    bankid SERIAL PRIMARY KEY,
                    supplierid INTEGER NOT NULL,
                    bankname TEXT NOT NULL,
                    accountnumber TEXT NOT NULL,
                    routingnumber TEXT,
                    swiftcode TEXT,
                    currency TEXT DEFAULT 'USD',
                    isprimary BOOLEAN DEFAULT FALSE,
                    status TEXT DEFAULT 'ACTIVE',
                    createdat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updatedat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (supplierid) REFERENCES suppliers(supplierid) ON DELETE CASCADE
                );
            `;

            await new Promise((resolve) => {
                this.run(milestone2Sql, [], (err) => {
                    if (err) console.warn("Milestone 2 Migration Warning:", err.message);
                    else console.log("Milestone 2 Schema applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Supplier Code (SDN-SUP-XXX)
            const supplierCodeSql = `
                ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplierCode TEXT UNIQUE;
            `;
            await new Promise((resolve) => {
                this.run(supplierCodeSql, [], async (err) => {
                    if (err) console.warn("Supplier Code Migration Warning:", err.message);
                    else {
                        // Backfill Logic
                        this.all("SELECT supplierId FROM suppliers WHERE supplierCode IS NULL", [], (err, rows) => {
                            if (!err && rows && rows.length > 0) {
                                console.log(`Backfilling supplierCode for ${rows.length} suppliers...`);
                                rows.forEach(r => {
                                    const code = `SDN-SUP-${String(r.supplierid || r.supplierId).padStart(3, '0')}`;
                                    this.run("UPDATE suppliers SET supplierCode = ? WHERE supplierId = ?", [code, r.supplierid || r.supplierId]);
                                });
                            }
                        });
                    }
                    resolve();
                });
            });

            // MIGRATION: Fix Invitation Role (missing column)
            const inviteRoleSql = `
                ALTER TABLE invitations ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'SUPPLIER';
            `;

            await new Promise((resolve) => {
                this.run(inviteRoleSql, [], (err) => {
                    if (err) console.warn("Invitation Role Migration Warning:", err.message);
                    else console.log("Invitation Role Migration applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Fix Messages Recipient Role (missing column)
            const messageRoleSql = `
                ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipientRole TEXT DEFAULT 'SUPPLIER';
            `;

            await new Promise((resolve) => {
                this.run(messageRoleSql, [], (err) => {
                    if (err) console.warn("Message Role Migration Warning:", err.message);
                    else console.log("Message Role Migration applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Fix Supplier Change Items (missing columns)
            const changeItemSql = `
                ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
                ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS rejectionReason TEXT;
            `;

            await new Promise((resolve) => {
                this.run(changeItemSql, [], (err) => {
                    if (err) console.warn("Change Item Columns Migration Warning:", err.message);
                    else console.log("Change Item Columns Migration applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Fix Supplier Change Items Approval Columns (Missing reviewedByUserId)
            const changeItemApprovalSql = `
                ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS reviewedByUserId INTEGER;
                ALTER TABLE supplier_change_items ADD COLUMN IF NOT EXISTS reviewedAt TIMESTAMP;
            `;

            await new Promise((resolve) => {
                this.run(changeItemApprovalSql, [], (err) => {
                    if (err) console.warn("Change Item Approval Columns Migration Warning:", err.message);
                    else console.log("Change Item Approval Columns Migration applied successfully.");
                    resolve();
                });
            });

            // MIGRATION: Multi-Buyer Support (Many-to-Many)
            const multiBuyerSql = `
                CREATE TABLE IF NOT EXISTS user_supplier_memberships (
                    membershipId SERIAL PRIMARY KEY,
                    userId INTEGER NOT NULL,
                    supplierId INTEGER NOT NULL,
                    isActive BOOLEAN DEFAULT TRUE,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(userId, supplierId)
                );
            `;
            await new Promise((resolve) => {
                this.run(multiBuyerSql, [], (err) => {
                    if (err) console.warn("Multi-Buyer Table Migration Warning:", err.message);
                    else {
                        console.log("Multi-Buyer Table created successfully.");
                        // Backfill: Add existing user-supplier associations
                        this.run(`
                            INSERT INTO user_supplier_memberships (userId, supplierId)
                            SELECT userId, supplierId FROM users 
                            WHERE supplierId IS NOT NULL 
                            ON CONFLICT (userId, supplierId) DO NOTHING
                        `);
                    }
                    resolve();
                });
            });

            // MIGRATION: Milestone 3 - Analytics & Advanced Circles
            const milestone3Sql = `
                CREATE TABLE IF NOT EXISTS reports (
                    reportId SERIAL PRIMARY KEY,
                    buyerId INTEGER NOT NULL,
                    reportType TEXT NOT NULL,
                    format TEXT NOT NULL,
                    filters TEXT, -- JSON
                    status TEXT DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, FAILED
                    filePath TEXT,
                    generatedByUserId INTEGER,
                    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completedAt TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS circle_members (
                    circleId INTEGER NOT NULL,
                    supplierId INTEGER NOT NULL,
                    joinedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (circleId, supplierId)
                );

                CREATE TABLE IF NOT EXISTS circle_workflows (
                    circleId INTEGER NOT NULL,
                    workflowId INTEGER NOT NULL,
                    assignedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (circleId, workflowId)
                );
            `;
            await new Promise((resolve) => {
                this.run(milestone3Sql, [], (err) => {
                    if (err) console.warn("Milestone 3 Migration Warning:", err.message);
                    else console.log("Milestone 3 Schema applied successfully.");
                    resolve();
                });
            });


            // MIGRATION: RFI Module
            const rfiModuleSql = `
                CREATE TABLE IF NOT EXISTS rfi_template (
                    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    template_name TEXT NOT NULL,
                    category TEXT,
                    subcategory TEXT,
                    version INTEGER DEFAULT 1,
                    status TEXT DEFAULT 'DRAFT',
                    created_by INTEGER,
                    buyer_id INTEGER,
                    applicable_regions TEXT[],
                    regulatory_overlays TEXT[],
                    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS template_section (
                    section_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    template_id UUID NOT NULL,
                    section_name TEXT NOT NULL,
                    section_description TEXT,
                    display_order INTEGER DEFAULT 0,
                    is_mandatory BOOLEAN DEFAULT TRUE
                );

                CREATE TABLE IF NOT EXISTS template_question (
                    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    section_id UUID,
                    template_id UUID NOT NULL,
                    question_text TEXT NOT NULL,
                    question_type TEXT NOT NULL,
                    mandatory BOOLEAN DEFAULT FALSE,
                    promote_to_rfp BOOLEAN DEFAULT FALSE,
                    options JSONB,
                    validation_rules JSONB,
                    display_order INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS rfi_question_library (
                    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    question_text TEXT NOT NULL,
                    question_type TEXT NOT NULL,
                    category_tags TEXT[],
                    capability_tags TEXT[],
                    compliance_tags TEXT[],
                    created_by INTEGER,
                    is_deleted BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS rfi_rule_engine (
                    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    template_id UUID NOT NULL,
                    condition_field TEXT NOT NULL,
                    condition_operator TEXT NOT NULL,
                    condition_value TEXT NOT NULL,
                    action_type TEXT NOT NULL,
                    target_question_id UUID
                );

                CREATE TABLE IF NOT EXISTS rfi_event (
                    rfi_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    template_id UUID,
                    title TEXT NOT NULL,
                    description TEXT,
                    buyer_id INTEGER,
                    publish_date TIMESTAMP,
                    deadline TIMESTAMP,
                    status TEXT DEFAULT 'DRAFT',
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS rfi_invitation (
                    invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfi_id UUID NOT NULL,
                    supplier_id INTEGER,
                    guest_email TEXT,
                    invitation_status TEXT DEFAULT 'CREATED',
                    sent_timestamp TIMESTAMP,
                    token TEXT UNIQUE
                );

                CREATE TABLE IF NOT EXISTS supplier_rfi_response (
                    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfi_id UUID NOT NULL,
                    supplier_id INTEGER NOT NULL,
                    submission_date TIMESTAMP,
                    status TEXT DEFAULT 'NOT_STARTED',
                    internal_notes TEXT,
                    evaluation_status TEXT DEFAULT 'UNDER_REVIEW',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_rfi_response_unique ON supplier_rfi_response(rfi_id, supplier_id);

                CREATE TABLE IF NOT EXISTS supplier_rfi_response_detail (
                    response_detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    response_id UUID NOT NULL,
                    question_id UUID NOT NULL,
                    answer_value TEXT,
                    attachment_id UUID
                );

                CREATE TABLE IF NOT EXISTS rfi_document_reference (
                    doc_ref_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    response_id UUID NOT NULL,
                    file_name TEXT NOT NULL,
                    file_type TEXT,
                    file_url TEXT,
                    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                ALTER TABLE template_section ADD COLUMN IF NOT EXISTS section_description TEXT;
            `;
            await new Promise((resolve) => {
                this.run(rfiModuleSql, [], (err) => {
                    if (err) console.warn("RFI Module Migration Warning:", err.message);
                    else console.log("RFI Module schema applied successfully.");
                    resolve();
                });
            });

            // Migration: Add guest_name to rfi_invitation
            await new Promise((resolve) => {
                this.run(`ALTER TABLE rfi_invitation ADD COLUMN IF NOT EXISTS guest_name TEXT;`, [], (err) => {
                    if (err) console.warn("RFI Invitation guest_name migration error (likely already exists):", err.message);
                    else console.log("RFI Invitation guest_name column added.");
                    resolve();
                });
            });

            // Migration: Change notifications.entityId from INTEGER to TEXT (to support UUID entity references)
            const notificationsMigrationSql = `
                ALTER TABLE notifications ALTER COLUMN entityid TYPE TEXT USING entityid::TEXT;
            `;
            await new Promise((resolve) => {
                this.run(notificationsMigrationSql, [], (err) => {
                    if (err) console.warn("Notifications migration (entityId TEXT) already applied or skipped:", err.message);
                    else console.log("Notifications entityId column migrated to TEXT.");
                    resolve();
                });
            });

            // Migration: Allow messages.supplierId to be NULL so admin can message buyers without a supplier context
            const messagesMigrationSql = `
                ALTER TABLE messages ALTER COLUMN supplierid DROP NOT NULL;
            `;
            await new Promise((resolve) => {
                this.run(messagesMigrationSql, [], (err) => {
                    if (err) console.warn("Messages migration (supplierId nullable) already applied or skipped:", err.message);
                    else console.log("Messages supplierId column made nullable.");
                    resolve();
                });
            });

        };

        runSchema().then(() => {
            this.initialized = true;
        }).catch(err => {
            console.error("Database initialization failed:", err);
        });
    }
}

// --- Initialization ---
// Force Postgres Initialization
db = new PostgresWrapper();

// We REMOVED top-level execution.
module.exports = db;
