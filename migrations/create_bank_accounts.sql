-- Migration to create bank_accounts table
CREATE TABLE IF NOT EXISTS bank_accounts (
    bankid INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_bank_accounts_supplierid ON bank_accounts(supplierid);
