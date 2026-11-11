import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readWorkspaceFile, writeWorkspaceFile, validateCommand } from "./safety.js";

const API = (process.env.NEXUS_API_URL || "").replace(/\/+$/,"");
const TOKEN = process.env.NEXUS_ACCESS_TOKEN || "";
const WORKSPACE = path.resolve(process.env.NEXUS_WORKSPACE || "./workspace");
const HEADLESS = String(process.env.NEXUS_HEADLESS || "false").toLowerCase() === "true";
const MAX_MS = Math.min(12, Math.max(1, Number(process.env.NEXUS_MAX_HOURS || 12))) * 60 * 60 * 1000;
const SESSION_FILE = path.resolve(".nexus-session.json");
const mission = process.argv.slice(2).join(" ").trim();

if (!API || !TOKEN) {
  console.error("Set NEXUS_API_URL and NEXUS_ACCESS_TOKEN in runner/.env first.");
  process.exit(1);
}
if (!mission) {
  console.error('Usage: npm start -- "Describe the software task"');
  process.exit(1);
}

await fs.mkdir(WORKSPACE,{recursive:true});
const started = Date.now();
const deadline = started + MAX_MS;
const messages = [{role:"user",content:mission}];
let browser, page;
let steps = 0;
let finished = false;

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const save = async (status="running") => {
  await fs.writeFile(SESSION_FILE, JSON.stringify({
    mission, status, startedAt:new Date(started).toISOString(),
    elapsedMs:Date.now()-started, steps, messages
  },null,2));
};
const remaining = () => deadline-Date.now();
const wait = ms => new Promise(r=>setTimeout(r,ms));

async function askAI() {
  const res = await fetch(API+"/api/agent", {
    method:"POST",
    headers:{"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"},
    body:JSON.stringify({mission:
`You are operating a local software workspace. Return exactly one JSON object and no markdown.
Allowed actions:
{"action":"write_file","path":"relative/path","content":"complete file contents"}
{"action":"read_file","path":"relative/path"}
{"action":"run_command","command":"npm test"}
{"action":"browser_navigate","url":"https://example.com"}
{"action":"browser_click","selector":"CSS selector"}
{"action":"browser_type","selector":"CSS selector","text":"text"}
{"action":"browser_screenshot"}
{"action":"wait","seconds":number}
{"action":"done","summary":"what is finished"}
{"action":"ask_user","question":"what approval or clarification is needed"}
Rules: one action per response; use only paths inside workspace; commands must be exactly one of npm test, npm run build, npm run lint, npm install, npm ci, node --version, npm --version, git status --short. Do not attempt payments, purchases, sending messages, publishing, account changes, deleting user data, credential access, CAPTCHA solving, or security bypass. Ask the user before external side effects. Use browser only for the assigned task and public or user-authorized pages. Never fake progress.
Mission: ${mission}
Previous action results:
${JSON.stringify(messages.slice(-8))}
Next action:`
    })
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `AI gateway HTTP ${res.status}`);
  const text = data.reply || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return a JSON action: "+text.slice(0,500));
  return JSON.parse(match[0]);
}

async function runCommand(command) {
  validateCommand(command);
  return await new Promise(resolve=>{
    const child=spawn(command,{cwd:WORKSPACE,shell:true,windowsHide:true});
    let out="",err="";
    child.stdout.on("data",d=>out+=d.toString());
    child.stderr.on("data",d=>err+=d.toString());
    const timeout=setTimeout(()=>child.kill("SIGTERM"),120000);
    child.on("close",code=>{
      clearTimeout(timeout);
      resolve({code,stdout:out.slice(-12000),stderr:err.slice(-12000)});
    });
  });
}

async function execute(a) {
  switch(a.action) {
    case "write_file": {
      const p=await writeWorkspaceFile(WORKSPACE,a.path,a.content);
      return {ok:true,wrote:path.relative(WORKSPACE,p)};
    }
    case "read_file": return {ok:true,path:a.path,content:await readWorkspaceFile(WORKSPACE,a.path)};
    case "run_command": return {ok:true,...await runCommand(a.command)};
    case "browser_navigate": {
      const u=new URL(a.url);
      if (!["http:","https:"].includes(u.protocol)) throw new Error("Only HTTP/HTTPS navigation is allowed.");
      if (!browser) {
        browser=await chromium.launch({headless:HEADLESS});
        page=await browser.newPage();
      }
      await page.goto(u.href,{waitUntil:"domcontentloaded",timeout:30000});
      return {ok:true,url:page.url(),title:await page.title()};
    }
    case "browser_click":
      if (!page) throw new Error("Navigate to a page first.");
      await page.locator(a.selector).first().click({timeout:10000});
      return {ok:true,clicked:a.selector};
    case "browser_type":
      if (!page) throw new Error("Navigate to a page first.");
      await page.locator(a.selector).first().fill(String(a.text||""),{timeout:10000});
      return {ok:true,typedInto:a.selector};
    case "browser_screenshot":
      if (!page) throw new Error("Navigate to a page first.");
      await page.screenshot({path:path.join(WORKSPACE,"nexus-screenshot.png"),fullPage:true});
      return {ok:true,saved:"nexus-screenshot.png"};
    case "wait": {
      const seconds=Math.max(1,Math.min(55,Number(a.seconds)||5));
      await wait(seconds*1000);
      return {ok:true,waitedSeconds:seconds};
    }
    case "ask_user":
      throw new Error("Human approval/clarification required: "+String(a.question||"Please review the current task."));
    case "done":
      finished=true;
      log("MISSION COMPLETE:",a.summary||"Agent marked the task complete.");
      return {ok:true,summary:a.summary||""};
    default: throw new Error("Unknown action: "+a.action);
  }
}

try {
  log("NEXUS-12 started. Maximum session:",Math.round(MAX_MS/3600000),"hours.");
  log("Workspace:",WORKSPACE);
  await save();
  while (remaining()>0 && !finished) {
    if (++steps>500) throw new Error("Safety stop: reached 500 action steps.");
    const action=await askAI();
    log("Action:",action.action);
    const result=await execute(action);
    messages.push({role:"assistant",content:JSON.stringify(action)});
    messages.push({role:"tool",content:JSON.stringify(result).slice(0,12000)});
    await save();
    if (action.action==="done") break;
    // A randomized check interval, capped at 55 seconds, is used only for wait actions.
    if (remaining()<=0) break;
  }
  if (!finished && remaining()<=0) log("12-hour session limit reached.");
  await save(finished?"completed":"stopped");
} catch(e) {
  log("STOPPED:",e.message);
  messages.push({role:"system",content:"Stopped: "+e.message});
  await save("needs_attention");
} finally {
  if (browser) await browser.close().catch(()=>{});
  log("Session checkpoint saved to",SESSION_FILE);
}
