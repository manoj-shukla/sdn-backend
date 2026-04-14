/**
 * migrate_rfp_sections.js
 * Adds all 8 RFP section tables + column extensions to the existing RFP schema.
 * Usage: node scripts/migrate_rfp_sections.js
 */
const db = require('../config/database');

async function run() {
    console.log('⏳ Running RFP Sections migration...\n');

    const steps = [
        // ── Extend rfp table (Section 1 enhancements) ──────────────────────────
        {
            name: 'rfp.bu_region',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS bu_region TEXT`
        },
        {
            name: 'rfp.incoterms',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS incoterms TEXT`
        },
        {
            name: 'rfp.contact_person',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS contact_person TEXT`
        },
        {
            name: 'rfp.instructions',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS instructions TEXT`
        },
        {
            name: 'rfp.require_compliance_ack',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS require_compliance_ack BOOLEAN DEFAULT FALSE`
        },

        // ── Buyer certification requirements (Section 2/6 gates) ──────────────
        {
            name: 'rfp.require_iso',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS require_iso BOOLEAN DEFAULT FALSE`
        },
        {
            name: 'rfp.require_gmp',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS require_gmp BOOLEAN DEFAULT FALSE`
        },
        {
            name: 'rfp.require_fsc',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS require_fsc BOOLEAN DEFAULT FALSE`
        },
        {
            name: 'rfp.min_revenue_m',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS min_revenue_m NUMERIC DEFAULT 0`
        },

        // ── Configurable scoring weights (Section 7/Scoring) ────────────────
        {
            name: 'rfp.weight_commercial',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS weight_commercial NUMERIC DEFAULT 40`
        },
        {
            name: 'rfp.weight_technical',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS weight_technical NUMERIC DEFAULT 25`
        },
        {
            name: 'rfp.weight_quality',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS weight_quality NUMERIC DEFAULT 15`
        },
        {
            name: 'rfp.weight_logistics',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS weight_logistics NUMERIC DEFAULT 10`
        },
        {
            name: 'rfp.weight_esg',
            sql: `ALTER TABLE rfp ADD COLUMN IF NOT EXISTS weight_esg NUMERIC DEFAULT 10`
        },

        // ── Compliance ack on supplier response ───────────────────────────────
        {
            name: 'supplier_rfp_response.compliance_ack_accepted',
            sql: `ALTER TABLE supplier_rfp_response ADD COLUMN IF NOT EXISTS compliance_ack_accepted BOOLEAN DEFAULT FALSE`
        },

        // ── Extend rfp_item (Section 3: target/should-cost price) ──────────────
        {
            name: 'rfp_item.target_price',
            sql: `ALTER TABLE rfp_item ADD COLUMN IF NOT EXISTS target_price NUMERIC`
        },
        {
            name: 'rfp_item.target_price_note',
            sql: `ALTER TABLE rfp_item ADD COLUMN IF NOT EXISTS target_price_note TEXT`
        },

        // ── Extend rfp_response_item (Section 4: cost breakdown) ───────────────
        {
            name: 'rfp_response_item.raw_material_cost',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS raw_material_cost NUMERIC`
        },
        {
            name: 'rfp_response_item.conversion_cost',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS conversion_cost NUMERIC`
        },
        {
            name: 'rfp_response_item.labor_cost',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS labor_cost NUMERIC`
        },
        {
            name: 'rfp_response_item.logistics_cost',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS logistics_cost NUMERIC`
        },
        {
            name: 'rfp_response_item.overhead_cost',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS overhead_cost NUMERIC`
        },
        {
            name: 'rfp_response_item.supplier_margin',
            sql: `ALTER TABLE rfp_response_item ADD COLUMN IF NOT EXISTS supplier_margin NUMERIC`
        },

        // ── Section 2: Supplier Qualification responses ─────────────────────────
        {
            name: 'rfp_qualification_response',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_qualification_response (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    legal_entity TEXT,
                    headquarters TEXT,
                    annual_revenue NUMERIC,
                    employees INTEGER,
                    monthly_capacity TEXT,
                    certifications JSONB DEFAULT '[]',
                    major_clients TEXT,
                    financial_notes TEXT,
                    financial_score NUMERIC DEFAULT 0,
                    capability_score NUMERIC DEFAULT 0,
                    experience_score NUMERIC DEFAULT 0,
                    compliance_score NUMERIC DEFAULT 0,
                    total_qual_score NUMERIC DEFAULT 0,
                    is_disqualified BOOLEAN DEFAULT FALSE,
                    disqualification_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_qual_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_qual_rfp ON rfp_qualification_response(rfp_id)`
        },

        // ── Section 5: Logistics & Supply Capability responses ─────────────────
        {
            name: 'rfp_logistics_response',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_logistics_response (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    delivery_terms TEXT,
                    warehouse_locations TEXT,
                    transport_method TEXT,
                    supply_capacity_monthly NUMERIC,
                    has_backup_supplier BOOLEAN DEFAULT FALSE,
                    risk_level TEXT DEFAULT 'LOW' CHECK(risk_level IN ('LOW','MEDIUM','HIGH')),
                    risk_reasons JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_logistics_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_logistics_rfp ON rfp_logistics_response(rfp_id)`
        },

        // ── Section 6: Quality & Compliance responses ──────────────────────────
        {
            name: 'rfp_quality_response',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_quality_response (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    iso_certified BOOLEAN DEFAULT FALSE,
                    gmp_certified BOOLEAN DEFAULT FALSE,
                    fsc_certified BOOLEAN DEFAULT FALSE,
                    other_certifications TEXT,
                    inspection_process TEXT,
                    traceability_system TEXT,
                    defect_rate_pct NUMERIC,
                    audit_report_url TEXT,
                    quality_manual_url TEXT,
                    compliance_score NUMERIC DEFAULT 0,
                    is_compliant BOOLEAN DEFAULT TRUE,
                    disqualification_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_quality_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_quality_rfp ON rfp_quality_response(rfp_id)`
        },

        // ── Section 7: Sustainability & ESG responses ──────────────────────────
        {
            name: 'rfp_esg_response',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_esg_response (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    recycled_content_pct NUMERIC,
                    carbon_footprint_kg NUMERIC,
                    renewable_energy_pct NUMERIC,
                    packaging_reduction_initiative TEXT,
                    esg_policies TEXT,
                    esg_score NUMERIC DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_esg_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_esg_rfp ON rfp_esg_response(rfp_id)`
        },

        // ── Section 8: Commercial Terms responses ──────────────────────────────
        {
            name: 'rfp_terms_response',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_terms_response (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    payment_terms TEXT,
                    price_validity_days INTEGER,
                    accepts_penalty_clauses BOOLEAN DEFAULT FALSE,
                    commodity_index_linkage TEXT,
                    general_terms_accepted BOOLEAN DEFAULT FALSE,
                    terms_notes TEXT,
                    has_flags BOOLEAN DEFAULT FALSE,
                    flag_reasons JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_terms_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_terms_rfp ON rfp_terms_response(rfp_id)`
        },

        // ── Weighted Evaluation Scores ─────────────────────────────────────────
        {
            name: 'rfp_eval_score',
            sql: `
                CREATE TABLE IF NOT EXISTS rfp_eval_score (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rfp_id UUID NOT NULL REFERENCES rfp(rfp_id) ON DELETE CASCADE,
                    supplier_id INTEGER NOT NULL,
                    commercial_score NUMERIC DEFAULT 0,
                    technical_score NUMERIC DEFAULT 0,
                    quality_score NUMERIC DEFAULT 0,
                    logistics_score NUMERIC DEFAULT 0,
                    sustainability_score NUMERIC DEFAULT 0,
                    total_weighted_score NUMERIC DEFAULT 0,
                    rank INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(rfp_id, supplier_id)
                )
            `
        },
        {
            name: 'idx_rfp_eval_rfp',
            sql: `CREATE INDEX IF NOT EXISTS idx_rfp_eval_rfp ON rfp_eval_score(rfp_id)`
        },
    ];

    let ok = 0;
    let fail = 0;

    for (const step of steps) {
        await new Promise((resolve) => {
            db.run(step.sql, [], (err) => {
                if (err) {
                    console.error(`  ✗ ${step.name}: ${err.message}`);
                    fail++;
                } else {
                    console.log(`  ✓ ${step.name}`);
                    ok++;
                }
                resolve();
            });
        });
    }

    console.log(`\n✅ Migration complete — ${ok} succeeded, ${fail} failed.`);
    console.log('ℹ️  Restart your server if it is running.\n');
    process.exit(0);
}

// Wait for DB pool to be ready
const waitForDb = setInterval(() => {
    if (db && db.initialized !== false) {
        clearInterval(waitForDb);
        setTimeout(run, 1500);
    }
}, 300);
