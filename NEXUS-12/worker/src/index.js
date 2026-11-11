const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...cors }
  });
}

function authorized(request, env) {
  const h = request.headers.get("Authorization") || "";
  return !!env.NEXUS_ACCESS_TOKEN && h === `Bearer ${env.NEXUS_ACCESS_TOKEN}`;
}

const systemPrompt = `You are NEXUS-12, a careful autonomous software engineering assistant.
Plan software tasks, explain tradeoffs, produce code and help debug.
Do not claim to have edited files or controlled a browser unless a connected tool actually did so.
Never request or expose API keys, passwords, cookies or private tokens.
Ask for explicit human approval before purchases, payments, sending messages, publishing,
deleting important data, changing account security, or irreversible external actions.
Do not bypass CAPTCHAs, access controls, anti-bot protections or website terms.
Return concise, actionable answers.`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers:cors });
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      if (!authorized(request, env)) return json({error:"Unauthorized"},401);
      return json({ok:true,service:"NEXUS-12 API",model:env.OPENAI_MODEL || "gpt-4.1-mini"});
    }
    if (url.pathname === "/api/agent" && request.method === "POST") {
      if (!authorized(request, env)) return json({error:"Unauthorized"},401);
      if (!env.OPENAI_API_KEY) return json({error:"OPENAI_API_KEY secret is not configured."},503);
      let body;
      try { body = await request.json(); } catch { return json({error:"Invalid JSON body."},400); }
      const mission = String(body.mission || "").trim();
      if (!mission || mission.length > 12000) return json({error:"Mission is required and must be under 12,000 characters."},400);
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{
          "Authorization":`Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:env.OPENAI_MODEL || "gpt-4.1-mini",
          temperature:0.3,
          messages:[
            {role:"system",content:systemPrompt},
            {role:"user",content:mission}
          ]
        })
      });
      const raw = await upstream.text();
      let data;
      try { data = JSON.parse(raw); } catch { return json({error:"AI provider returned an unreadable response."},502); }
      if (!upstream.ok) return json({error:data.error?.message || "AI provider request failed."},upstream.status);
      return json({reply:data.choices?.[0]?.message?.content || "No response generated."});
    }
    return json({error:"Not found"},404);
  }
};
