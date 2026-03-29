/**
 * Global test setup
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sdn-tech-super-secret-key';

// Extend Jest timeout for integration tests
jest.setTimeout(30000);

// Global test teardown
afterAll(async () => {
    // Give time for any pending database operations to complete
    await new Promise(resolve => setTimeout(resolve, 100));
});

// Mock console to reduce noise in tests (optional)
global.console = {
    ...console,
    // Uncomment to silence console.log during tests
    // log: jest.fn(),
    // debug: jest.fn(),
    // info: jest.fn(),
};
