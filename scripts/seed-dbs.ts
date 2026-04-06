import dotenv from "dotenv";
import path from "path";

// Load .env.local FIRST before any other imports
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// NOW import seedDbs
import { seedDbs } from "@/lib/db/seedDbs";

async function main() {
  console.log("🌱 Seeding Turso database...");
  console.log("TURSO_DATABASE_URL:", process.env.TURSO_DATABASE_URL ? "✅ Found" : "❌ Missing");
  console.log("TURSO_AUTH_TOKEN:", process.env.TURSO_AUTH_TOKEN ? "✅ Found" : "❌ Missing");
  
  try {
    await seedDbs({ forceRecreate: false });
    console.log("✅ Done! Turso database seeded successfully.");
  } catch (err) {
    console.error("❌ Seeding error:", err);
    process.exit(1);
  }
}

main();
