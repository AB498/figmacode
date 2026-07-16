import { ConvexHttpClient } from "convex/browser";
const client = new ConvexHttpClient("https://rare-newt-287.convex.cloud");
const token = JSON.parse(require("fs").readFileSync(require("path").join(require("os").homedir(), ".cc", "config.json"), "utf-8")).token;
const requestId = "cc5a81b0-6af1-4960-a322-f6f62c4653f9";

for (let i = 0; i < 5; i++) {
  await new Promise(r => setTimeout(r, 2000));
  console.log("Query", i, "...");
  try {
    const res = await Promise.race([
      client.query("action:getResult", { token, requestId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT after 15s")), 15000))
    ]);
    console.log("Query", i, "result:", JSON.stringify(res).slice(0, 200));
  } catch (e) { console.log("Query", i, "error:", e.message); }
}
console.log("DONE");
