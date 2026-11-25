import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });
const shots = [
  { url: "/entrar", name: "login-desktop-light", vp: { width: 1366, height: 820 }, dark: false },
  { url: "/entrar", name: "login-desktop-dark", vp: { width: 1366, height: 820 }, dark: true },
  { url: "/entrar", name: "login-mobile", vp: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }, dark: false },
  { url: "/aprovacao/" + "0".repeat(64), name: "portal-gate-mobile", vp: { width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 }, dark: false },
];
const errors = [];
for (const s of shots) {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${s.name}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${s.name}: ${e.message}`));
  await page.setViewport(s.vp);
  await page.evaluateOnNewDocument((d) => localStorage.setItem("df-theme", d ? "dark" : "light"), s.dark);
  await page.goto("http://localhost:3100" + s.url, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `/tmp/shots/${s.name}.png` });
  await page.close();
}
// Validation feedback on submit with empty fields
const p = await browser.newPage(); await p.setViewport({ width: 1366, height: 820 });
await p.goto("http://localhost:3100/entrar", { waitUntil: "networkidle0" });
await p.click("button[type=submit]"); await new Promise((r) => setTimeout(r, 1500));
await p.screenshot({ path: "/tmp/shots/login-validation.png" });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
