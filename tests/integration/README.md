# Backend Integration Tests

This directory contains comprehensive integration tests for the SDN Tech backend API.

## Test Files

### Core API Tests

- **`suppliers.test.js`** - Supplier management tests
  - CRUD operations (create, read, update, list)
  - Address management
  - Contact management
  - Document management
  - Review workflow (submit, approve/reject)
  - Bulk upload operations

- **`change-requests.test.js`** - Change request workflow tests
  - Request creation and triggering
  - Buyer view of pending requests
  - Role-based visibility (Finance, Compliance, Procurement)
  - Item-level approval/rejection
  - Full request approval/rejection
  - Supplier view of own requests

- **`auth-buyer.test.js`** - Authentication and buyer management tests
  - User login and authentication
  - Token validation
  - Password management (forgot, reset)
  - Buyer CRUD operations
  - Buyer workflows and RBAC
  - User invitations

- **`messages-documents.test.js`** - Communication and document tests
  - Message exchange (buyer ↔ supplier)
  - Message filtering and search
  - Document upload (multiple types)
  - Document verification workflow
  - Document expiry tracking

## Running Tests

### Prerequisites

1. Ensure the backend server is running:
```bash
cd backend
npm start
```

2. Install test dependencies (if not already installed):
```bash
cd backend
npm install --save-dev jest
```

### Run All Tests

```bash
# Run all integration tests
npm test

# Or run directly with Jest
npx jest tests/integration/

# Run with verbose output
npx jest tests/integration/ --verbose

# Run specific test file
npx jest tests/integration/suppliers.test.js

# Run tests in watch mode
npx jest tests/integration/ --watch
```

### Run Individual Test Suites

```bash
# Supplier tests
node tests/integration/suppliers.test.js

# Change request tests
node tests/integration/change-requests.test.js

# Auth and buyer tests
node tests/integration/auth-buyer.test.js

# Messages and documents tests
node tests/integration/messages-documents.test.js
```

## Environment Configuration

Create a `.env` file in the backend directory:

```env
# Database
DB_PATH=./database.sqlite

# JWT Secret (must match your application)
JWT_SECRET=sdn-tech-super-secret-key

# API Base URL for testing
TEST_BASE_URL=http://localhost:8083/api
```

## Test Data Management

### Cleanup

Tests include automatic cleanup of test data:
- Test suppliers are deleted after tests complete
- Change requests are cleaned up
- Test users and invitations are removed

### Manual Cleanup

If tests fail and leave data behind:

```javascript
// Run in Node.js REPL
const db = require('./config/database');
db.run("DELETE FROM suppliers WHERE legalName LIKE 'Test%'", (err) => {
    if (err) console.error(err);
    else console.log('Cleaned up test suppliers');
});
```

## Test Structure

### Test Organization

```javascript
describe('Feature Name', () => {
    beforeAll(() => {
        // Setup: create test data, login
    });

    afterAll(async () => {
        // Cleanup: delete test data
    });

    describe('Specific Scenario', () => {
        test('should do something correctly', async () => {
            // Arrange
            const data = { ... };

            // Act
            const response = await axios.post(url, data, config);

            // Assert
            expect(response.status).toBe(200);
        });
    });
});
```

### Common Patterns

#### Authentication

```javascript
const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET;

const buyerToken = jwt.sign(
    { userId: 1, role: 'BUYER', subRole: 'Admin', buyerId: 1 },
    SECRET_KEY,
    { expiresIn: '1h' }
);

const response = await axios.get(url, {
    headers: { 'Authorization': `Bearer ${buyerToken}` }
});
```

#### Error Testing

```javascript
test('should reject invalid input', async () => {
    try {
        await axios.post(url, invalidData);
        fail('Should have thrown an error');
    } catch (error) {
        expect(error.response?.status).toBe(400);
    }
});
```

#### Async Cleanup

```javascript
afterAll(async () => {
    await new Promise(r => db.run("DELETE FROM table WHERE id = ?", [id], r));
});
```

## Coverage

### Current Test Coverage

| Feature | Endpoints Tested | Status |
|---------|-----------------|--------|
| Suppliers | 8/8 | ✅ Complete |
| Change Requests | 7/7 | ✅ Complete |
| Authentication | 4/4 | ✅ Complete |
| Buyers | 6/6 | ✅ Complete |
| Invitations | 5/5 | ✅ Complete |
| Messages | 6/6 | ✅ Complete |
| Documents | 8/8 | ✅ Complete |

### Test Scenarios Covered

#### Happy Path Tests
- ✅ Successful supplier creation
- ✅ Successful authentication
- ✅ Complete change request workflow
- ✅ Document upload and verification
- ✅ Message exchange

#### Unhappy Path Tests
- ✅ Invalid credentials
- ✅ Unauthorized access
- ✅ Invalid input validation
- ✅ Permission denied scenarios
- ✅ Missing required fields

#### Edge Cases
- ✅ Empty result sets
- ✅ Large data sets (bulk upload)
- ✅ Role-based access control
- ✅ Concurrent operations

## Debugging Failed Tests

### Enable Detailed Logging

```javascript
function log(step, msg, data) {
    console.log(`[${step}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}
```

### Check Database State

```bash
# Open SQLite database
sqlite3 backend/database.sqlite

# Query test data
SELECT * FROM suppliers WHERE legalName LIKE 'Test%';
SELECT * FROM supplier_change_requests;
SELECT * FROM users;
```

### Common Issues

1. **Port already in use**
   ```bash
   # Check what's using port 8080
   lsof -i :8080

   # Kill the process
   kill -9 <PID>
   ```

2. **Database locked**
   ```bash
   # Stop the server before running tests
   # Or use a separate test database
   ```

3. **Authentication failures**
   ```bash
   # Check JWT_SECRET matches between .env and test files
   echo $JWT_SECRET
   ```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm start &
      - run: npm test
        env:
          TEST_BASE_URL: http://localhost:8083/api
```

## Contributing

When adding new features:

1. **Write tests first** (TDD approach)
2. **Test happy path** - normal successful operations
3. **Test unhappy path** - error conditions
4. **Test edge cases** - boundary conditions
5. **Clean up test data** - use `afterAll` hooks

### Test Checklist

- [ ] Test successful operation
- [ ] Test validation errors
- [ ] Test authentication/authorization
- [ ] Test with invalid IDs
- [ ] Test with empty/missing data
- [ ] Clean up test data

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Axios Documentation](https://axios-http.com/)
- [Node.js SQLite3](https://github.com/TryGhost/node-sqlite3)
- [JWT Best Practices](https://jwt.io/introduction)
