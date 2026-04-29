export default async function handler(req, res) {
  const wallet = String(req.query.wallet || "");
  if (!wallet) return res.status(400).send("Missing wallet");

  // Encode wallet directly into state so we don't rely on cookies.
  // Cookies break on mobile OAuth redirects (SameSite=Lax blocks them
  // when Discord redirects back, causing the callback to lose the wallet).
  const nonce = cryptoRandom();
  const state = Buffer.from(JSON.stringify({ wallet, nonce })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope:         "identify",
    state
  });

  res.writeHead(302, { Location: "https://discord.com/oauth2/authorize?" + params.toString() });
  res.end();
}

function cryptoRandom() {
  const crypto = require("crypto");
  return crypto.randomBytes(16).toString("hex");
}
