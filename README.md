# Supplier Onboarding Backend

## Overview
Backend service for the Supplier Onboarding System, built with Node.js, Express, and PostgreSQL. It handles supplier registration, approval workflows, document management, and RBAC (Role-Based Access Control).

## Tech Stack
- **Runtime**: Node.js (>= 18.0.0)
- **Framework**: Express.js
- **Database**: PostgreSQL (pg, node-postgres)
- **Authentication**: JWT (jsonwebtoken), bcryptjs
- **Cloud Integration**: AWS RDS (I AM Auth support)

## Prerequisites
- Node.js (v18+)
- PostgreSQL Database

## Installation

1.  Clone the repository and navigate to the backend directory:
    ```bash
    cd backend
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Server
PORT=8080

# Database (PostgreSQL)
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=sdntech

# AWS Integration (Optional for IAM Auth)
AWS_REGION=us-east-1
AWS_ROLE_ARN=arn:aws:iam::ACCOUNT_ID:role/rds-role
ENABLE_IAM_AUTH=false

# File Uploads (Local dev vs Vercel)
VERCEL=false
```

## Running the Application

### Development
Start the server with nodemon for hot-reloading:
```bash
npm run dev
```
The server will start on `http://localhost:8083` (or port specified in `dev` script).

### Production
Start the server in production mode:
```bash
npm start
```

## API Documentation

Swagger UI is available at:
- `http://localhost:8083/api-docs` (when running locally)

## Project Structure

- `config/`: Database connection and configuration.
- `controllers/`: Logic for handling API requests.
- `middleware/`: Express middleware (Auth, Error Handling, Logging).
- `models/`: Database schema definitions (managed via SQL migrations in `config/database.js`).
- `routes/`: API route definitions.
- `services/`: Business logic layer.
- `uploads/`: Directory for file storage (local environment).
- `utils/`: Utility functions.

## Features
- **Supplier Onboarding**: Complete registration flow.
- **Approval Workflow**: Configurable multi-step approval process.
- **Document Management**: Upload, verify, and manage compliance documents.
- **Role-Based Access**: Granular permissions for Admin, Buyer, and Supplier roles.
# sdn-backend
