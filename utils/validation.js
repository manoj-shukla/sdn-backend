/**
 * Comprehensive Validation Module for SDN Tech Application
 * Provides validation utilities for all entity types
 */

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password strength requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

/**
 * Phone number validation (international format)
 * Supports: +1234567890, 123-456-7890, (123) 456-7890
 */
const phoneRegex = /^[\+]?[0-9\-\s\(\)]+$/;

/**
 * URL validation
 */
const urlRegex = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;

/**
 * Tax ID / VAT number validation (alphanumeric, 8-15 characters)
 */
const taxIdRegex = /^[A-Z0-9\-\s]{8,15}$/;

/**
 * Validates whether the given string is a properly formatted email address.
 */
function isValidEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return emailRegex.test(email.trim());
}

/**
 * Validates password strength
 */
function isValidPassword(password) {
    if (!password || typeof password !== 'string') return false;
    return passwordRegex.test(password);
}

/**
 * Validates phone number format
 */
function isValidPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    return phoneRegex.test(phone.trim());
}

/**
 * Validates URL format
 */
function isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return urlRegex.test(url.trim());
}

/**
 * Validates Tax ID / VAT number format
 */
function isValidTaxId(taxId) {
    if (!taxId || typeof taxId !== 'string') return false;
    return taxIdRegex.test(taxId.trim().toUpperCase());
}

/**
 * Common validation error messages
 */
const ErrorMessages = {
    REQUIRED: (field) => `${field} is required`,
    INVALID_EMAIL: 'Invalid email format',
    INVALID_PASSWORD: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character (@$!%*?&)',
    WEAK_PASSWORD: 'Password is too weak',
    PASSWORDS_MISMATCH: 'Passwords do not match',
    INVALID_PHONE: 'Invalid phone number format',
    INVALID_URL: 'Invalid URL format',
    INVALID_TAX_ID: 'Tax ID must be 8-15 alphanumeric characters',
    INVALID_DATE: 'Invalid date format',
    DATE_IN_PAST: 'Date cannot be in the past',
    INVALID_NUMBER: (field) => `${field} must be a valid number`,
    INVALID_POSITIVE_NUMBER: (field) => `${field} must be a positive number`,
    INVALID_ROLE: (roles) => `Invalid role. Must be one of: ${roles.join(', ')}`,
    INVALID_STATUS: (statuses) => `Invalid status. Must be one of: ${statuses.join(', ')}`,
    INVALID_PERMISSION: (perm) => `Invalid permission: ${perm}`,
};

const VALID_PERMISSIONS = [
    'ALL',
    'CAN_INVITE',
    'VIEW_WORKFLOWS',
    'CAN_APPROVE',
    'CAN_REJECT',
    'VIEW_SUPPLIERS',
    'EDIT_SUPPLIERS',
    'APPROVE_SUPPLIERS',
    'VIEW_MESSAGES',
    'SEND_MESSAGES',
    'VIEW_USERS',
    'EDIT_USERS',
    'MANAGE_ROLES',
    'MANAGE_CIRCLES'
];

/**
 * Validator class for validating different entities
 */
class Validator {
    /**
     * Validates user creation/update data
     */
    static validateUser(data, isUpdate = false) {
        const errors = [];

        // Username validation
        if (!isUpdate || data.username !== undefined) {
            if (!data.username) {
                errors.push({ field: 'username', message: ErrorMessages.REQUIRED('Username') });
            } else if (data.username.length < 3) {
                errors.push({ field: 'username', message: 'Username must be at least 3 characters' });
            } else if (data.username.length > 50) {
                errors.push({ field: 'username', message: 'Username must not exceed 50 characters' });
            } else if (!/^[a-zA-Z0-9._ -]+$/.test(data.username)) {
                errors.push({ field: 'username', message: 'Username can only contain letters, numbers, dots, hyphens, underscores and spaces' });
            }
        }

        // Email validation
        if (!isUpdate || data.email !== undefined) {
            if (!data.email) {
                errors.push({ field: 'email', message: ErrorMessages.REQUIRED('Email') });
            } else if (!isValidEmail(data.email)) {
                errors.push({ field: 'email', message: ErrorMessages.INVALID_EMAIL });
            }
        }

        // Password validation (no complexity rules enforced)
        // Removed mandatory check for creation to allow server-side default password

        // Role validation
        if (!isUpdate || data.role !== undefined) {
            if (!data.role && !isUpdate) {
                errors.push({ field: 'role', message: ErrorMessages.REQUIRED('Role') });
            } else if (data.role && !['ADMIN', 'BUYER', 'SUPPLIER'].includes(data.role)) {
                errors.push({ field: 'role', message: ErrorMessages.INVALID_ROLE(['ADMIN', 'BUYER', 'SUPPLIER']) });
            }
        }

        // Phone validation (optional)
        if (data.phone && !isValidPhone(data.phone)) {
            errors.push({ field: 'phone', message: ErrorMessages.INVALID_PHONE });
        }

        return errors;
    }

    /**
     * Validates supplier data
     */
    static validateSupplier(data, isUpdate = false) {
        const errors = [];

        // Legal name (required)
        if (!isUpdate || data.legalName !== undefined) {
            if (!data.legalName) {
                errors.push({ field: 'legalName', message: ErrorMessages.REQUIRED('Legal name') });
            } else if (data.legalName.length < 2) {
                errors.push({ field: 'legalName', message: 'Legal name must be at least 2 characters' });
            } else if (data.legalName.length > 200) {
                errors.push({ field: 'legalName', message: 'Legal name must not exceed 200 characters' });
            }
        }

        // Business type (required)
        if (!isUpdate || data.businessType !== undefined) {
            if (!data.businessType) {
                errors.push({ field: 'businessType', message: ErrorMessages.REQUIRED('Business type') });
            } else if (!['LLC', 'Corporation', 'Corp', 'Sole Proprietorship', 'Partnership', 'Other', 'SME', 'Enterprise', 'Freelance'].includes(data.businessType)) {
                errors.push({ field: 'businessType', message: 'Invalid business type. Must be: LLC, Corporation, Corp, Sole Proprietorship, Partnership, SME, Enterprise, Freelance, or Other' });
            }
        }

        // Country (required)
        if (!isUpdate || data.country !== undefined) {
            if (!data.country) {
                errors.push({ field: 'country', message: ErrorMessages.REQUIRED('Country') });
            } else if (data.country.length < 2 || data.country.length > 100) {
                errors.push({ field: 'country', message: 'Country must be between 2 and 100 characters' });
            }
        }

        // Email validation
        if (!isUpdate || data.email !== undefined) {
            if (data.email && !isValidEmail(data.email)) {
                errors.push({ field: 'email', message: ErrorMessages.INVALID_EMAIL });
            }
        }

        // Phone validation
        if (data.phone && !isValidPhone(data.phone)) {
            errors.push({ field: 'phone', message: ErrorMessages.INVALID_PHONE });
        }

        // Website validation (optional)
        if (data.website && !isValidUrl(data.website)) {
            errors.push({ field: 'website', message: ErrorMessages.INVALID_URL });
        }

        // Tax ID validation (optional)
        if (data.taxId && !isValidTaxId(data.taxId)) {
            errors.push({ field: 'taxId', message: ErrorMessages.INVALID_TAX_ID });
        }

        return errors;
    }

    /**
     * Validates buyer data
     */
    static validateBuyer(data, isUpdate = false) {
        const errors = [];

        // Buyer name (required)
        if (!isUpdate || data.buyerName !== undefined) {
            if (!data.buyerName) {
                errors.push({ field: 'buyerName', message: ErrorMessages.REQUIRED('Buyer name') });
            } else if (data.buyerName.length < 2) {
                errors.push({ field: 'buyerName', message: 'Buyer name must be at least 2 characters' });
            } else if (data.buyerName.length > 200) {
                errors.push({ field: 'buyerName', message: 'Buyer name must not exceed 200 characters' });
            }
        }

        // Email validation
        if (!isUpdate || data.email !== undefined) {
            if (data.email && !isValidEmail(data.email)) {
                errors.push({ field: 'email', message: ErrorMessages.INVALID_EMAIL });
            }
        }

        // Phone validation
        if (data.phone && !isValidPhone(data.phone)) {
            errors.push({ field: 'phone', message: ErrorMessages.INVALID_PHONE });
        }

        return errors;
    }

    /**
     * Validates circle data
     */
    static validateCircle(data, isUpdate = false) {
        const errors = [];

        // Circle name (required)
        const name = data.circleName || data.name;
        if (!isUpdate || data.circleName !== undefined || data.name !== undefined) {
            if (!name) {
                errors.push({ field: 'circleName', message: ErrorMessages.REQUIRED('Circle name') });
            } else if (name.length < 3) {
                errors.push({ field: 'circleName', message: 'Circle name must be at least 3 characters' });
            } else if (name.length > 100) {
                errors.push({ field: 'circleName', message: 'Circle name must not exceed 100 characters' });
            }
        }

        // Description (optional)
        if (data.description && data.description.length > 500) {
            errors.push({ field: 'description', message: 'Description must not exceed 500 characters' });
        }

        return errors;
    }

    /**
     * Validates workflow data
     */
    static validateWorkflow(data, isUpdate = false) {
        const errors = [];

        // Workflow name (required)
        if (!isUpdate || data.workflowName !== undefined) {
            if (!data.workflowName) {
                errors.push({ field: 'workflowName', message: ErrorMessages.REQUIRED('Workflow name') });
            } else if (data.workflowName.length < 3) {
                errors.push({ field: 'workflowName', message: 'Workflow name must be at least 3 characters' });
            } else if (data.workflowName.length > 100) {
                errors.push({ field: 'workflowName', message: 'Workflow name must not exceed 100 characters' });
            }
        }

        // Description (optional)
        if (data.description && data.description.length > 500) {
            errors.push({ field: 'description', message: 'Description must not exceed 500 characters' });
        }

        return errors;
    }

    /**
     * Validates message data
     */
    static validateMessage(data) {
        const errors = [];

        // Supplier ID (required unless sending Admin -> Buyer)
        if (!data.supplierId && data.recipientRole !== 'BUYER') {
            errors.push({ field: 'supplierId', message: ErrorMessages.REQUIRED('Supplier') });
        }
        
        // Buyer ID (required if recipient is BUYER)
        if (!data.buyerId && data.recipientRole === 'BUYER') {
            errors.push({ field: 'buyerId', message: ErrorMessages.REQUIRED('Buyer') });
        }

        // Subject (required)
        if (!data.subject) {
            errors.push({ field: 'subject', message: ErrorMessages.REQUIRED('Subject') });
        } else if (data.subject.length > 200) {
            errors.push({ field: 'subject', message: 'Subject must not exceed 200 characters' });
        }

        // Content (required)
        if (!data.content) {
            errors.push({ field: 'content', message: ErrorMessages.REQUIRED('Content') });
        } else if (data.content.length > 5000) {
            errors.push({ field: 'content', message: 'Content must not exceed 5000 characters' });
        }

        // Recipient role (required)
        if (!data.recipientRole) {
            errors.push({ field: 'recipientRole', message: ErrorMessages.REQUIRED('Recipient role') });
        } else if (!['BUYER', 'SUPPLIER', 'ADMIN', 'Compliance', 'Finance', 'AP', 'Procurement'].includes(data.recipientRole)) {
            errors.push({ field: 'recipientRole', message: 'Invalid recipient role' });
        }

        return errors;
    }

    /**
     * Validates address data
     */
    static validateAddress(data) {
        const errors = [];

        // Address line 1 (required)
        if (!data.addressLine1) {
            errors.push({ field: 'addressLine1', message: ErrorMessages.REQUIRED('Address line 1') });
        } else if (data.addressLine1.length > 200) {
            errors.push({ field: 'addressLine1', message: 'Address line 1 must not exceed 200 characters' });
        }

        // City (required)
        if (!data.city) {
            errors.push({ field: 'city', message: ErrorMessages.REQUIRED('City') });
        } else if (data.city.length > 100) {
            errors.push({ field: 'city', message: 'City must not exceed 100 characters' });
        }

        // State/Province (required)
        if (!data.state && !data.stateProvince) {
            errors.push({ field: 'stateProvince', message: ErrorMessages.REQUIRED('State/Province') });
        }

        // Postal code (required)
        if (!data.postalCode) {
            errors.push({ field: 'postalCode', message: ErrorMessages.REQUIRED('Postal code') });
        }

        // Country (required)
        if (!data.country) {
            errors.push({ field: 'country', message: ErrorMessages.REQUIRED('Country') });
        } else if (data.country.length !== 2) {
            errors.push({ field: 'country', message: 'Country must be a 2-letter ISO code' });
        }

        // Address type (required)
        if (!data.addressType) {
            errors.push({ field: 'addressType', message: ErrorMessages.REQUIRED('Address type') });
        } else if (!['BILLING', 'SHIPPING', 'HEADQUARTERS', 'OTHER', 'BUSINESS'].includes(data.addressType)) {
            errors.push({ field: 'addressType', message: 'Invalid address type. Must be: BILLING, SHIPPING, HEADQUARTERS, OTHER, or BUSINESS' });
        }

        return errors;
    }

    /**
     * Validates contact data
     */
    static validateContact(data) {
        const errors = [];

        // Contact name (required)
        if (!data.contactName && (!data.firstName || !data.lastName)) {
            errors.push({ field: 'contactName', message: ErrorMessages.REQUIRED('Contact name') });
        } else if (data.contactName && data.contactName.length > 100) {
            errors.push({ field: 'contactName', message: 'Contact name must not exceed 100 characters' });
        }

        // Email (required)
        if (!data.email) {
            errors.push({ field: 'email', message: ErrorMessages.REQUIRED('Email') });
        } else if (!isValidEmail(data.email)) {
            errors.push({ field: 'email', message: ErrorMessages.INVALID_EMAIL });
        }

        // Phone (required)
        if (!data.phone) {
            errors.push({ field: 'phone', message: ErrorMessages.REQUIRED('Phone') });
        } else if (!isValidPhone(data.phone)) {
            errors.push({ field: 'phone', message: ErrorMessages.INVALID_PHONE });
        }

        // Role (optional)
        if (data.role && !['Primary', 'Billing', 'Technical', 'Sales', 'Other'].includes(data.role)) {
            errors.push({ field: 'role', message: 'Invalid contact role' });
        }

        return errors;
    }

    /**
     * Validates authentication request (login)
     */
    static validateLogin(data) {
        const errors = [];

        if (!data.username) {
            errors.push({ field: 'username', message: ErrorMessages.REQUIRED('Username or email') });
        }

        if (!data.password) {
            errors.push({ field: 'password', message: ErrorMessages.REQUIRED('Password') });
        } else if (data.password.length < 1) {
            errors.push({ field: 'password', message: 'Password cannot be empty' });
        }

        return errors;
    }

    /**
     * Validates password reset request
     */
    static validatePasswordReset(data) {
        const errors = [];

        if (!data.token) {
            errors.push({ field: 'token', message: ErrorMessages.REQUIRED('Reset token') });
        }

        if (!data.newPassword) {
            errors.push({ field: 'newPassword', message: ErrorMessages.REQUIRED('New password') });
        }

        return errors;
    }

    /**
     * Validates change password request
     */
    static validateChangePassword(data) {
        const errors = [];

        if (!data.currentPassword) {
            errors.push({ field: 'currentPassword', message: ErrorMessages.REQUIRED('Current password') });
        }

        if (!data.newPassword) {
            errors.push({ field: 'newPassword', message: ErrorMessages.REQUIRED('New password') });
        }

        return errors;
    }

    /**
     * Validates role data
     */
    static validateRole(data, isUpdate = false) {
        const errors = [];

        // Role name (required)
        if (!isUpdate || data.roleName !== undefined) {
            if (!data.roleName) {
                errors.push({ field: 'roleName', message: ErrorMessages.REQUIRED('Role name') });
            } else if (data.roleName.length < 2) {
                errors.push({ field: 'roleName', message: 'Role name must be at least 2 characters' });
            } else if (data.roleName.length > 100) {
                errors.push({ field: 'roleName', message: 'Role name must not exceed 100 characters' });
            }
        }

        // Permissions
        if (data.permissions && Array.isArray(data.permissions)) {
            for (const perm of data.permissions) {
                if (!VALID_PERMISSIONS.includes(perm)) {
                    errors.push({ field: 'permissions', message: ErrorMessages.INVALID_PERMISSION(perm) });
                }
            }
        }

        return errors;
    }

    /**
     * Validates report generation data
     */
    static validateReport(data) {
        const errors = [];
        const VALID_TYPES = ['SUPPLIER_LIST', 'BUYER_SUMMARY', 'COMPLIANCE_STATS', 'SUPPLIERS', 'BUYERS', 'USERS', 'WORKFLOWS', 'CHANGE_REQUESTS'];
        const VALID_FORMATS = ['CSV', 'PDF', 'EXCEL', 'JSON'];

        if (!data.reportType && !data.entityType) {
            errors.push({ field: 'reportType', message: ErrorMessages.REQUIRED('Report type or Entity type') });
        } else {
            const type = data.reportType || data.entityType;
            if (!VALID_TYPES.includes(type)) {
                errors.push({ field: 'reportType', message: 'Invalid report type' });
            }
        }

        if (!data.format) {
            errors.push({ field: 'format', message: ErrorMessages.REQUIRED('Format') });
        } else if (!VALID_FORMATS.includes(data.format.toUpperCase())) {
            errors.push({ field: 'format', message: 'Invalid format. Must be: CSV, PDF, EXCEL, or JSON' });
        }

        return errors;
    }
}

/**
 * Middleware factory for creating validation middleware
 * @param {string} entity - The entity to validate ('user', 'supplier', 'buyer', 'circle', 'workflow', 'message', 'address', 'contact')
 * @param {boolean} isUpdate - Whether this is an update operation (optional fields)
 */
function validateMiddleware(entity, isUpdate = false) {
    return (req, res, next) => {
        console.log(`[validateMiddleware] START for entity: ${entity}, isUpdate: ${isUpdate}`);
        let errors = [];

        switch (entity) {
            case 'user':
                errors = Validator.validateUser(req.body, isUpdate);
                break;
            case 'supplier':
                errors = Validator.validateSupplier(req.body, isUpdate);
                break;
            case 'buyer':
                errors = Validator.validateBuyer(req.body, isUpdate);
                break;
            case 'circle':
                errors = Validator.validateCircle(req.body, isUpdate);
                break;
            case 'workflow':
                errors = Validator.validateWorkflow(req.body, isUpdate);
                break;
            case 'message':
                errors = Validator.validateMessage(req.body);
                break;
            case 'address':
                errors = Validator.validateAddress(req.body);
                break;
            case 'contact':
                errors = Validator.validateContact(req.body);
                break;
            case 'login':
                errors = Validator.validateLogin(req.body);
                break;
            case 'passwordReset':
                errors = Validator.validatePasswordReset(req.body);
                break;
            case 'changePassword':
                errors = Validator.validateChangePassword(req.body);
                break;
            case 'role':
                errors = Validator.validateRole(req.body, isUpdate);
                break;
            case 'report':
                errors = Validator.validateReport(req.body);
                break;
            default:
                return res.status(500).json({ error: 'Invalid validation type' });
        }

        if (errors.length > 0) {
            console.warn(`[validateMiddleware] Validation FAILED for ${entity}:`, errors);
            return res.status(400).json({
                error: `Validation failed: ${errors[0].message}`,
                details: errors
            });
        }

        next();
    };
}

/**
 * Sanitizes user input to prevent XSS and injection attacks
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;

    // Remove potentially dangerous characters
    return input
        .replace(/[<>]/g, '') // Remove < and >
        .trim();
}

/**
 * Sanitizes an object recursively
 */
function sanitizeObject(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            const value = obj[key];
            if (typeof value === 'string') {
                sanitized[key] = sanitizeInput(value);
            } else if (typeof value === 'object') {
                sanitized[key] = sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
    }

    return sanitized;
}

/**
 * SQL Injection prevention - validates parameterized query inputs
 */
function validateSqlInput(input) {
    // Check for SQL injection patterns
    const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION)\b)/i,
        /(--|\/\*|\*\/)/,
        /(;|\sOR\s+.*=.*\sOR\s|;\s*DROP)/i
    ];

    const str = String(input);
    for (const pattern of sqlPatterns) {
        if (pattern.test(str)) {
            return false;
        }
    }
    return true;
}

module.exports = {
    Validator,
    validateMiddleware,
    sanitizeInput,
    sanitizeObject,
    validateSqlInput,
    ErrorMessages,
    isValidEmail,
    isValidPassword,
    isValidPhone,
    isValidUrl,
    isValidTaxId
};
