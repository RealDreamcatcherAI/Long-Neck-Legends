export default async function handler(req, res) {
  const wallet = String(req.query.wallet || "");
  if (!wallet) return res.status(400).send("Missing wallet");

  // simple random state (ties callback to the request)
  const state = cryptoRandom();

  // store wallet in a cookie just for this flow (simple beginner method)
  res.setHeader("Set-Cookie", [
    `lnl_wallet=${encodeURIComponent(wallet)}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    `lnl_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax`
  ]);

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
    state
  });

  res.writeHead(302, { Location: "https://discord.com/oauth2/authorize?" + params.toString() });
  res.end();
}

function cryptoRandom() {
  // works in Vercel node runtime
  const crypto = require("crypto");
  return crypto.randomBytes(16).toString("hex");
}