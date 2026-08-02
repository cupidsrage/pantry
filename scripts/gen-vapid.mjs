// Generate the VAPID keypair that signs push notifications.
//   npm run vapid
// Paste the two lines it prints into the service's environment variables.
import crypto from "crypto";

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const raw = (b64) => Buffer.from(b64, "base64url");

// Push services want the public key as an uncompressed point: 0x04 || x || y.
const publicKey = Buffer.concat([Buffer.from([4]), raw(jwk.x), raw(jwk.y)]).toString("base64url");

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com   # your email, so push services can reach you`);
