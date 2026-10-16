import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const required = ["package.json", "package-lock.json", "src/data/hot100.json", "src/data/solutions.json", "scripts/start.command", "scripts/start.bat"];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`missing ${file}`);
if (!fs.existsSync("node_modules")) throw new Error("node_modules is missing; run npm install");
const hot100 = JSON.parse(fs.readFileSync("src/data/hot100.json", "utf8"));
if (hot100.questions.length !== 100) throw new Error("Hot 100 data count is not 100");
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { stdio: "inherit" });
console.log("smoke check passed: dependencies, data count, build, and startup scripts");
