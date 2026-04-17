/**
 * Stub type declarations for @aws-sdk/client-kms.
 * The SDK is an optional runtime dependency — only needed when KMS_KEY_ID is set.
 * Install with: pnpm add @aws-sdk/client-kms
 */
declare module '@aws-sdk/client-kms' {
  export class KMSClient {
    constructor(config: { region: string });
    send(command: any): Promise<any>;
  }
  export class SignCommand {
    constructor(input: {
      KeyId: string;
      Message: Uint8Array;
      MessageType: string;
      SigningAlgorithm: string;
    });
  }
  export class GetPublicKeyCommand {
    constructor(input: { KeyId: string });
  }
}
