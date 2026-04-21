export interface FirestoreUniverse {
  id: string;
  name?: string;
  description?: string;
  image_url?: string;
  imageURL?: string;
  portrait_image_url?: string;
  creator?: string;
  tokenAddress?: string;
  governanceAddress?: string;
  created_at?: { _seconds: number };
}
