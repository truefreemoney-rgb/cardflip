/**
 * Print a fresh VAPID key pair for phone notifications. Run: npm run push:keys
 * Put them in Vercel as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ VAPID_SUBJECT),
 * redeploy, and the Account row's "Turn On" starts working.
 */
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:support@cardflip.io");
