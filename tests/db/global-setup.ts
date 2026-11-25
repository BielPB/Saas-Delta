import { execFileSync } from "node:child_process";
import path from "node:path";

/** Rebuilds the test database from migrations before the DB suite runs. */
export default function setup() {
  if (process.env.SKIP_DB_RESET === "1") return;
  execFileSync("bash", [path.resolve(__dirname, "../../scripts/db-reset-test.sh")], { stdio: "inherit" });
}
