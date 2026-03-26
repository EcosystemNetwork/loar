import { adminAuth } from "./firebase";
import type { DecodedIdToken } from "firebase-admin/auth";

export async function verifyAuth(
  headers: Headers
): Promise<DecodedIdToken | null> {
  const token = headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    return await adminAuth.verifyIdToken(token);
  } catch {
    return null;
  }
}
