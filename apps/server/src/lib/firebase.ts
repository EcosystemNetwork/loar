import { initializeApp, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let serviceAccount: ServiceAccount | undefined;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  const fs = await import("fs");
  serviceAccount = JSON.parse(
    fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf-8")
  );
}

const app = initializeApp(
  serviceAccount ? { credential: cert(serviceAccount) } : undefined
);

export const db = getFirestore(app);
export const adminAuth = getAuth(app);
