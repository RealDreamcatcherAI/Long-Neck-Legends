export default async function handler(req, res) {
  const wallet    = String(req.query.wallet  || "");
  const returnUrl = String(req.query.return  || ""); // page to come back to after auth
  if (!wallet) return res.status(400).send("Missing wallet");

  // Encode wallet + returnUrl into state — no cookies, works on mobile
  const nonce = cryptoRandom();
  const state = Buffer.from(JSON.stringify({ wallet, nonce, returnUrl })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     process.env.DISCORD_CLIENT_ID,
    redirect_uri:  process.env.DISCORD_REDIRECT_URI,
    response_type: "code",
    scope:         "identify",
    state,
    prompt:        "none"
  });

  res.writeHead(302, { Location: "https://discord.com/oauth2/authorize?" + params.toString() });
  res.end();
}

function cryptoRandom() {
  const crypto = require("crypto");
  return crypto.randomBytes(16).toString("hex");
}
