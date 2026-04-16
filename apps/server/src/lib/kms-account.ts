/**
 * AWS KMS-backed viem Account.
 *
 * Signs transactions using an asymmetric ECC_SECG_P256K1 key stored in
 * AWS KMS. The private key never leaves the HSM boundary.
 *
 * Prerequisites:
 *   1. Create KMS key: aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY
 *   2. Install SDK:    pnpm add @aws-sdk/client-kms
 *   3. IAM policy:     kms:Sign, kms:GetPublicKey on the key ARN
 *
 * Environment:
 *   KMS_KEY_ID  — Key ARN, alias, or alias ARN
 *   KMS_REGION  — AWS region (default: us-east-1)
 */
import { type Account, type Hex, toHex, keccak256 } from 'viem';
import { toAccount } from 'viem/accounts';

// Lazy-load AWS SDK to keep it optional
async function getKmsClient(region: string) {
  const { KMSClient, SignCommand, GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
  return { client: new KMSClient({ region }), SignCommand, GetPublicKeyCommand };
}

/**
 * Parse a DER-encoded ECDSA signature into { r, s } components.
 * AWS KMS returns signatures in DER format (SEQUENCE { INTEGER r, INTEGER s }).
 */
function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  // DER: 0x30 <total-len> 0x02 <r-len> <r-bytes> 0x02 <s-len> <s-bytes>
  let offset = 2; // skip SEQUENCE tag + length

  // Parse r
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected INTEGER tag for r');
  offset++;
  const rLen = der[offset++];
  const rBytes = der.slice(offset, offset + rLen);
  offset += rLen;

  // Parse s
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected INTEGER tag for s');
  offset++;
  const sLen = der[offset++];
  const sBytes = der.slice(offset, offset + sLen);

  // Remove leading zero padding (DER uses signed integers)
  const trimZero = (b: Uint8Array) => (b[0] === 0 ? b.slice(1) : b);

  const r = BigInt(toHex(trimZero(rBytes)));
  let s = BigInt(toHex(trimZero(sBytes)));

  // Normalize s to lower half of curve order (EIP-2)
  const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
  }

  return { r, s };
}

/**
 * Extract the uncompressed public key from a DER-encoded SubjectPublicKeyInfo.
 * KMS returns the public key in this format.
 */
function extractPubKeyFromDer(der: Uint8Array): Uint8Array {
  // The uncompressed public key is the last 65 bytes (0x04 + 32 byte X + 32 byte Y)
  const uncompressed = der.slice(-65);
  if (uncompressed[0] !== 0x04) {
    throw new Error('Expected uncompressed public key (0x04 prefix)');
  }
  return uncompressed;
}

/**
 * Derive Ethereum address from uncompressed public key (drop 0x04 prefix, keccak256, take last 20 bytes).
 */
function pubKeyToAddress(pubKey: Uint8Array): `0x${string}` {
  // Remove the 0x04 prefix
  const pubKeyNoPrefix = pubKey.slice(1);
  const hash = keccak256(toHex(pubKeyNoPrefix));
  return `0x${hash.slice(-40)}` as `0x${string}`;
}

export class KmsAccount {
  private constructor(
    private keyId: string,
    private region: string,
    public address: `0x${string}`,
    private pubKey: Uint8Array
  ) {}

  static async create(keyId: string, region: string): Promise<Account> {
    const { client, GetPublicKeyCommand } = await getKmsClient(region);

    const pubKeyResponse = await client.send(new GetPublicKeyCommand({ KeyId: keyId }));

    if (!pubKeyResponse.PublicKey) {
      throw new Error('KMS returned no public key');
    }

    const pubKeyDer = new Uint8Array(pubKeyResponse.PublicKey);
    const pubKey = extractPubKeyFromDer(pubKeyDer);
    const address = pubKeyToAddress(pubKey);

    const instance = new KmsAccount(keyId, region, address, pubKey);

    return toAccount({
      address,
      async signMessage({ message }) {
        return instance.sign(
          typeof message === 'string' ? keccak256(toHex(message)) : keccak256(message.raw as Hex)
        );
      },
      async signTransaction(tx) {
        // viem handles serialization; we just need to sign the hash
        const { serializeTransaction, keccak256: k } = await import('viem');
        const serialized = serializeTransaction(tx);
        return instance.sign(k(serialized));
      },
      async signTypedData(typedData) {
        const { hashTypedData } = await import('viem');
        const hash = hashTypedData(typedData);
        return instance.sign(hash);
      },
    });
  }

  private async sign(hash: Hex): Promise<Hex> {
    const { client, SignCommand } = await getKmsClient(this.region);

    const response = await client.send(
      new SignCommand({
        KeyId: this.keyId,
        Message: Buffer.from(hash.slice(2), 'hex'),
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      })
    );

    if (!response.Signature) {
      throw new Error('KMS returned no signature');
    }

    const { r, s } = parseDerSignature(new Uint8Array(response.Signature));

    // Determine v (recovery id) by trying both 27 and 28
    const rHex = r.toString(16).padStart(64, '0');
    const sHex = s.toString(16).padStart(64, '0');

    // Try v=27 first, then v=28
    for (const v of [27, 28]) {
      const sig = `0x${rHex}${sHex}${v.toString(16)}` as Hex;
      try {
        const { recoverAddress } = await import('viem');
        const recovered = await recoverAddress({ hash, signature: sig });
        if (recovered.toLowerCase() === this.address.toLowerCase()) {
          return sig;
        }
      } catch {
        continue;
      }
    }

    throw new Error('Could not determine recovery parameter (v) for KMS signature');
  }
}
