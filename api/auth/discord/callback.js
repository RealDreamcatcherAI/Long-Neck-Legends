function parseCookies(cookieHeader) {
  const out = {};
  (cookieHeader || "").split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;
}

export default async function handler(req, res) {
  const code  = String(req.query.code  || "");
  const state = String(req.query.state || "");
  if (!code || !state) return res.status(400).send("Missing code/state");

  const cookies    = parseCookies(req.headers.cookie || "");
  const savedState = cookies.lnl_state  || "";
  const wallet     = cookies.lnl_wallet || "";

  if (!wallet)                        return res.status(400).send("Missing wallet cookie (start again).");
  if (!savedState || savedState !== state) return res.status(400).send("Invalid state (start again).");

  // ── 1. Exchange code for access token ─────────────────────────────
  const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type:    "authorization_code",
      code,
      redirect_uri:  process.env.DISCORD_REDIRECT_URI
    })
  });

  const tokenJson = await tokenResp.json();
  if (!tokenJson.access_token) {
    return res.status(400).send("Token exchange failed: " + JSON.stringify(tokenJson));
  }

  // ── 2. Fetch the Discord user ──────────────────────────────────────
  const meResp = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const me = await meResp.json();

  if (!me || !me.id) {
    return res.status(400).send("Failed to fetch Discord user.");
  }

  const origin = process.env.APP_ORIGIN || "*";

  // ── 3. Build the display tag ───────────────────────────────────────
  // New Discord usernames have discriminator "0" — use global_name or username only
  const discordTag =
    (me.global_name && String(me.global_name).trim())
      ? String(me.global_name).trim()
      : (me.username && me.discriminator && me.discriminator !== "0")
        ? `${me.username}#${me.discriminator}`
        : (me.username || "");

  // ── 4. Return a closer page that postMessages back to the opener ───
  // NOTE: backticks inside res.end() template literal are escaped as \`
  res.setHeader("Content-Type", "text/html");
  res.end(`<!DOCTYPE html>
<html>
<head><title>Connecting Discord…</title></head>
<body>
<script>
(function () {
  var payload = {
    type:            "discord_connected",

    // Primary fields the dashboard reads
    id:              ${JSON.stringify(String(me.id))},
    discord_id:      ${JSON.stringify(String(me.id))},
    username:        ${JSON.stringify(me.username        || "")},
    discriminator:   ${JSON.stringify(me.discriminator   || "")},
    global_name:     ${JSON.stringify(me.global_name     || "")},
    discord_tag:     ${JSON.stringify(discordTag)},

    wallet:          ${JSON.stringify(wallet)}
  };

  var target = ${JSON.stringify(origin)};

  if (window.opener) {
    window.opener.postMessage(payload, target);
    window.close();
  } else {
    document.body.innerText = "Discord connected! You can close this window.";
  }
})();
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:4rem;">
  Discord connected — closing window…
</p>
</body>
</html>`);
}
