/**
 * RFIRegulatoryOverlayService
 * Injects country/context-specific questions based on supplier profile.
 * India: GST, PAN, MSME, IEC, PF-ESI
 * Cross-border: AML, export control
 */

const INDIA_QUESTIONS = [
    { questionId: 'overlay_gstin', questionText: 'Please provide your GSTIN (Goods and Services Tax Identification Number)', questionType: 'SHORT_TEXT', mandatory: true, tag: 'INDIA_GST' },
    { questionId: 'overlay_pan', questionText: 'Please provide your PAN (Permanent Account Number)', questionType: 'SHORT_TEXT', mandatory: true, tag: 'INDIA_PAN' },
    { questionId: 'overlay_msme', questionText: 'Is your organization registered under MSME? If yes, provide Udyam Registration Number.', questionType: 'YES_NO', mandatory: false, tag: 'INDIA_MSME' },
    { questionId: 'overlay_iec', questionText: 'Please provide your IEC (Import Export Code) if applicable', questionType: 'SHORT_TEXT', mandatory: false, tag: 'INDIA_IEC' },
    { questionId: 'overlay_pf_esi', questionText: 'Provide your PF Registration Number and ESI Registration Number', questionType: 'LONG_TEXT', mandatory: false, tag: 'INDIA_PF_ESI' }
];

const AML_QUESTIONS = [
    { questionId: 'overlay_aml_policy', questionText: 'Does your organization have a formal Anti-Money Laundering (AML) policy? Please attach.', questionType: 'ATTACHMENT', mandatory: true, tag: 'AML' },
    { questionId: 'overlay_aml_officer', questionText: 'Name and contact details of your AML Compliance Officer', questionType: 'SHORT_TEXT', mandatory: true, tag: 'AML' },
    { questionId: 'overlay_sanctions', questionText: 'Has your organization or any of its directors been subject to sanctions in the past 5 years?', questionType: 'YES_NO', mandatory: true, tag: 'AML' }
];

const EXPORT_CONTROL_QUESTIONS = [
    { questionId: 'overlay_export_license', questionText: 'Does your organization hold any export control licenses? Please provide details.', questionType: 'LONG_TEXT', mandatory: false, tag: 'EXPORT_CONTROL' },
    { questionId: 'overlay_eccn', questionText: 'What is the Export Control Classification Number (ECCN) for your primary products/services?', questionType: 'SHORT_TEXT', mandatory: false, tag: 'EXPORT_CONTROL' },
    { questionId: 'overlay_restricted_parties', questionText: 'Do you screen your customers and partners against restricted parties lists?', questionType: 'YES_NO', mandatory: true, tag: 'EXPORT_CONTROL' }
];

class RFIRegulatoryOverlayService {

    /**
     * Returns overlay questions based on supplier context.
     * @param {object} supplierContext - { country, crossBorder, ... }
     * @returns {Array} overlay question objects
     */
    static getOverlayQuestions(supplierContext) {
        if (!supplierContext) return [];

        const overlays = [];
        const country = (supplierContext.country || '').toLowerCase();
        const crossBorder = supplierContext.crossBorder === true || supplierContext.crossBorder === 'true';

        // India-specific regulatory questions
        if (country === 'india' || country === 'in') {
            overlays.push(...INDIA_QUESTIONS);
        }

        // Cross-border: AML and export control
        if (crossBorder) {
            overlays.push(...AML_QUESTIONS);
            overlays.push(...EXPORT_CONTROL_QUESTIONS);
        }

        return overlays;
    }

    /**
     * Applies regulatory overlay to template context (returns section object for the overlay).
     * @param {string} templateId
     * @param {object} supplierContext
     * @returns {object} section with overlaid questions (not persisted, runtime-only)
     */
    static applyOverlay(templateId, supplierContext) {
        const questions = RFIRegulatoryOverlayService.getOverlayQuestions(supplierContext);
        if (questions.length === 0) return null;

        return {
            sectionId: 'overlay_regulatory',
            templateId,
            sectionName: 'Regulatory Compliance',
            displayOrder: 9999,
            isMandatory: true,
            isOverlay: true,
            questions
        };
    }

    /**
     * Get list of applicable regulatory frameworks for a context.
     */
    static getApplicableFrameworks(supplierContext) {
        const frameworks = [];
        const country = (supplierContext.country || '').toLowerCase();
        const crossBorder = supplierContext.crossBorder === true || supplierContext.crossBorder === 'true';

        if (country === 'india' || country === 'in') {
            frameworks.push('GST', 'PAN', 'MSME', 'IEC', 'PF-ESI');
        }
        if (crossBorder) {
            frameworks.push('AML', 'EXPORT_CONTROL');
        }

        return frameworks;
    }
}

module.exports = RFIRegulatoryOverlayService;
