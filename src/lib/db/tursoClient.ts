import { createClient } from "@libsql/client";

// Validate environment variables
const tursoDbUrl = process.env.TURSO_DATABASE_URL;
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoDbUrl) {
  throw new Error("TURSO_DATABASE_URL environment variable is required");
}

if (!tursoAuthToken) {
  throw new Error("TURSO_AUTH_TOKEN environment variable is required");
}

export const tursoClient = createClient({
  url: tursoDbUrl,
  authToken: tursoAuthToken
});
