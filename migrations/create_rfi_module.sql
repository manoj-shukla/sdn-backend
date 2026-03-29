-- ============================================================
-- RFI (Request for Information) Module Migration
-- ============================================================

-- Extension for UUID generation (PostgreSQL 13+ has gen_random_uuid() built-in)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TEMPLATE DOMAIN
-- ============================================================

CREATE TABLE IF NOT EXISTS rfi_template (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL,
    category TEXT,
    subcategory TEXT,
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    created_by INTEGER REFERENCES users(userId),
    buyer_id INTEGER REFERENCES buyers(buyerId),
    applicable_regions TEXT[],
    regulatory_overlays TEXT[],
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfi_template_buyer ON rfi_template(buyer_id);
CREATE INDEX IF NOT EXISTS idx_rfi_template_status ON rfi_template(status);

CREATE TABLE IF NOT EXISTS template_section (
    section_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES rfi_template(template_id) ON DELETE CASCADE,
    section_name TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_mandatory BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_template_section_template ON template_section(template_id);

CREATE TABLE IF NOT EXISTS template_question (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id UUID REFERENCES template_section(section_id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES rfi_template(template_id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL CHECK (question_type IN (
        'SHORT_TEXT','LONG_TEXT','YES_NO','SINGLE_SELECT',
        'MULTI_SELECT','NUMERIC','ATTACHMENT','TABLE'
    )),
    mandatory BOOLEAN DEFAULT FALSE,
    promote_to_rfp BOOLEAN DEFAULT FALSE,
    options JSONB,
    validation_rules JSONB,
    display_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_template_question_template ON template_question(template_id);
CREATE INDEX IF NOT EXISTS idx_template_question_section ON template_question(section_id);

CREATE TABLE IF NOT EXISTS rfi_question_library (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,
    category_tags TEXT[],
    capability_tags TEXT[],
    compliance_tags TEXT[],
    created_by INTEGER REFERENCES users(userId),
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rfi_rule_engine (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES rfi_template(template_id) ON DELETE CASCADE,
    condition_field TEXT NOT NULL,
    condition_operator TEXT NOT NULL CHECK (condition_operator IN ('EQUALS','NOT_EQUALS','CONTAINS','IN','NOT_IN','GT','LT')),
    condition_value TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('SHOW', 'HIDE')),
    target_question_id UUID REFERENCES template_question(question_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rfi_rule_template ON rfi_rule_engine(template_id);

-- ============================================================
-- EVENT DOMAIN
-- ============================================================

CREATE TABLE IF NOT EXISTS rfi_event (
    rfi_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID REFERENCES rfi_template(template_id),
    title TEXT NOT NULL,
    description TEXT,
    buyer_id INTEGER REFERENCES buyers(buyerId),
    publish_date TIMESTAMP,
    deadline TIMESTAMP,
    status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','OPEN','CLOSED','CONVERTED','ARCHIVED')),
    created_by INTEGER REFERENCES users(userId),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfi_event_buyer ON rfi_event(buyer_id);
CREATE INDEX IF NOT EXISTS idx_rfi_event_status ON rfi_event(status);

CREATE TABLE IF NOT EXISTS rfi_invitation (
    invitation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfi_id UUID NOT NULL REFERENCES rfi_event(rfi_id) ON DELETE CASCADE,
    supplier_id INTEGER REFERENCES suppliers(supplierId),
    guest_email TEXT,
    invitation_status TEXT DEFAULT 'CREATED' CHECK (invitation_status IN (
        'CREATED','SENT','VIEWED','IN_PROGRESS','SUBMITTED','EXPIRED'
    )),
    sent_timestamp TIMESTAMP,
    token TEXT UNIQUE,
    CONSTRAINT chk_supplier_or_guest CHECK (supplier_id IS NOT NULL OR guest_email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_rfi_invitation_rfi ON rfi_invitation(rfi_id);
CREATE INDEX IF NOT EXISTS idx_rfi_invitation_supplier ON rfi_invitation(supplier_id);

-- ============================================================
-- RESPONSE DOMAIN
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier_rfi_response (
    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfi_id UUID NOT NULL REFERENCES rfi_event(rfi_id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(supplierId),
    submission_date TIMESTAMP,
    status TEXT DEFAULT 'NOT_STARTED' CHECK (status IN (
        'NOT_STARTED','DRAFT','SUBMITTED','CLARIFICATION_REQUESTED'
    )),
    internal_notes TEXT,
    evaluation_status TEXT DEFAULT 'UNDER_REVIEW' CHECK (evaluation_status IN (
        'UNDER_REVIEW','SHORTLISTED','REJECTED','CLARIFICATION_PENDING'
    )),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(rfi_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_rfi_response_rfi ON supplier_rfi_response(rfi_id);
CREATE INDEX IF NOT EXISTS idx_rfi_response_supplier ON supplier_rfi_response(supplier_id);

CREATE TABLE IF NOT EXISTS supplier_rfi_response_detail (
    response_detail_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES supplier_rfi_response(response_id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES template_question(question_id),
    answer_value TEXT,
    attachment_id UUID
);

CREATE INDEX IF NOT EXISTS idx_rfi_response_detail_response ON supplier_rfi_response_detail(response_id);

CREATE TABLE IF NOT EXISTS rfi_document_reference (
    doc_ref_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_id UUID NOT NULL REFERENCES supplier_rfi_response(response_id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_url TEXT,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rfi_doc_ref_response ON rfi_document_reference(response_id);

-- ============================================================
-- ANALYTICS VIEWS
-- ============================================================

CREATE OR REPLACE VIEW rfi_event_metrics AS
SELECT
    e.rfi_id,
    e.title,
    e.buyer_id,
    e.deadline,
    e.status,
    COUNT(DISTINCT i.invitation_id) AS total_invited,
    COUNT(DISTINCT CASE WHEN i.invitation_status = 'SUBMITTED' THEN i.supplier_id END) AS total_submitted,
    COUNT(DISTINCT CASE WHEN r.status = 'SUBMITTED' THEN r.supplier_id END) AS total_responses,
    ROUND(
        100.0 * COUNT(DISTINCT CASE WHEN r.status = 'SUBMITTED' THEN r.supplier_id END)
        / NULLIF(COUNT(DISTINCT i.invitation_id), 0),
        2
    ) AS completion_rate_pct
FROM rfi_event e
LEFT JOIN rfi_invitation i ON e.rfi_id = i.rfi_id
LEFT JOIN supplier_rfi_response r ON e.rfi_id = r.rfi_id
GROUP BY e.rfi_id, e.title, e.buyer_id, e.deadline, e.status;
