export default async function handler(req, res) {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!code || !state) return res.status(400).send("Missing code/state");

  const cookies = parseCookies(req.headers.cookie || "");
  const savedState = cookies.lnl_state || "";
  const wallet = cookies.lnl_wallet || "";

  if (!wallet) return res.status(400).send("Missing wallet cookie (start again).");
  if (!savedState || savedState !== state) return res.status(400).send("Invalid state (start again).");

  // Exchange code -> access token
  const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    })
  });

  const tokenJson = await tokenResp.json();
  if (!tokenJson.access_token) {
    return res.status(400).send("Token exchange failed: " + JSON.stringify(tokenJson));
  }

  // Get the authenticated Discord user
  const meResp = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const me = await meResp.json();

  // TODO (later): store in a DB: wallet -> me.id
  // for now we just send it back to the page

  const origin = process.env.APP_ORIGIN;

  res.setHeader("Content-Type", "text/html");
  res.end(`
    <script>
      (function(){
        const discordTag =
  (me.global_name && String(me.global_name).trim())
    ? String(me.global_name).trim()
    : (me.username && me.discriminator && me.discriminator !== "0")
      ? `${me.username}#${me.discriminator}`
      : (me.username || "");
    const payload = {
      type: "discord_connected",

      // ✅ what your dashboard should store in Supabase
      discord_user_id: String(me.id),
      discord_tag: discordTag,

      // ✅ keep old fields too (backwards compatible)
      id: String(me.id),
      username: me.username || "",
      discriminator: me.discriminator || "",
      global_name: me.global_name || "",

      wallet: wallet
    };
    }

function parseCookies(cookieHeader) {
  const out = {};
  cookieHeader.split(";").forEach(part => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(v.join("=") || "");
  });
  return out;

}
