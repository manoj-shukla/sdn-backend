/**
 * migrate_rfp_schema.js
 * Run once to create all RFP module tables in the running Postgres database.
 * Usage: node scripts/migrate_rfp_schema.js
 */
const db = require('../config/database');

async function migrateRFP() {
    console.log('⏳ Running RFP module schema migration...');

    const steps = [
        {
            name: 'rfp',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp (
                    rfp_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name TEXT NOT NULL,
                    category TEXT,
                    currency TEXT NOT NULL DEFAULT 'USD',
                    deadline TIMESTAMP NOT NULL,
                    description TEXT,
                    status TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK(status IN ('DRAFT','OPEN','CLOSED','AWARDED','ARCHIVED')),
                    buyer_id INTEGER,
                    source_rfi_id UUID,
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'rfp_item',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_item (
                    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    description TEXT,
                    quantity NUMERIC NOT NULL DEFAULT 1,
                    unit TEXT,
                    specifications TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'rfp_supplier',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_supplier (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER,
                    email TEXT,
                    status TEXT NOT NULL DEFAULT 'INVITED'
                        CHECK(status IN ('INVITED','ACCEPTED','DECLINED','SUBMITTED','AWARDED')),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id),
                    UNIQUE(rfp_id, email)
                )
            `
        },
        {
            name: 'supplier_rfp_response',
            sql: `
                CREATE TABLE IF NOT EXISTS supplier_rfp_response (
                    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK(status IN ('DRAFT','SUBMITTED')),
                    notes TEXT,
                    submitted_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'rfp_response_item',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_response_item (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    response_id UUID NOT NULL REFERENCES supplier_rfp_response(response_id) ON DELETE CASCADE,
                    item_id UUID NOT NULL REFERENCES rfp_item(item_id) ON DELETE CASCADE,
                    price NUMERIC,
                    lead_time INTEGER,
                    moq NUMERIC,
                    notes TEXT
                )
            `
        },
        {
            name: 'rfp_insight',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_insight (
                    insight_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER,
                    type TEXT NOT NULL
                        CHECK(type IN ('PRICE_GAP','LEAD_TIME','MOQ','RISK')),
                    message TEXT NOT NULL,
                    severity TEXT NOT NULL DEFAULT 'MEDIUM'
                        CHECK(severity IN ('LOW','MEDIUM','HIGH')),
                    auto_generated BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'negotiation_round',
            sql: `
                CREATE TABLE IF NOT EXISTS negotiation_round (
                    round_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    round_number INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK(status IN ('OPEN','CLOSED')),
                    created_by INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'negotiation_change',
            sql: `
                CREATE TABLE IF NOT EXISTS negotiation_change (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    round_id UUID NOT NULL REFERENCES negotiation_round(round_id) ON DELETE CASCADE,
                    rfp_id UUID NOT NULL,
                    supplier_id INTEGER,
                    item_id UUID,
                    prev_price NUMERIC,
                    new_price NUMERIC,
                    delta_pct NUMERIC,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
        {
            name: 'rfp_award',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_award (
                    award_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    allocation_pct NUMERIC,
                    awarded_value NUMERIC,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `
        },
    ];

    for (const step of steps) {
        await new Promise((resolve) => {
            db.run(step.sql, [], (err) => {
                if (err) {
                    console.error(`  ✗ ${step.name}: ${err.message}`);
                } else {
                    console.log(`  ✓ ${step.name}`);
                }
                resolve();
            });
        });
    }

    console.log('\n✅ RFP schema migration complete. Restart your server if it is running.');
    process.exit(0);
}

// Wait for db to be ready
const waitForDb = setInterval(() => {
    if (db && db.initialized !== false) {
        clearInterval(waitForDb);
        setTimeout(migrateRFP, 1500); // small delay for pool to settle
    }
}, 300);
