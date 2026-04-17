# Deployment Notes

## Single-Server Deployment

This application is configured to run as:

- static frontend from `client/dist`
- Express API from `server/server.js`
- MongoDB as the backing datastore

## Safe Deployment Steps

1. Install dependencies:
   `npm run install:all`
2. Create the server environment file from [`server/.env.example`](D:/Yashraj/Manihar-Enterprises/server/.env.example)
3. Build the frontend:
   `npm run build`
4. Start the production server:
   `npm run start:prod`

## Required Environment Variables

- `MONGO_URI`
- `JWT_SECRET`

## Runtime Behavior

- In production, Express serves `client/dist` directly.
- Non-API routes fall back to `client/dist/index.html`.
- API routes remain under `/api/*`.
- The server fails fast on startup if required environment variables are missing or the production client build is absent.

## Read-Safe Verification

After deployment, these are safe checks that do not modify application data:

- `GET /api/health`
- open the login page
- authenticate with an existing user
- open reports
- download PDF and Excel exports
