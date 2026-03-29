const swaggerAutogen = require('swagger-autogen')();

const outputFile = './swagger.json';
const endpointsFiles = [
    './index.js',
    './routes/*.js' // Ensure it picks up all actual route handlers
];

const doc = {
    info: {
        title: 'Supplier Onboarding API',
        description: 'REST API for Supplier Onboarding System with RBAC',
        version: '1.0.0',
    },
    // Do not hardcode the host so it works relative to where it is deployed
    // Example: local will use localhost:8080/8083, Vercel will use the Vercel URL natively
    host: '',
    schemes: ['http', 'https'],
    securityDefinitions: {
        bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
        }
    }
};

swaggerAutogen(outputFile, endpointsFiles, doc);
