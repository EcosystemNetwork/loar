/**
 * authorizedMediaUrl — episode export / clip-library merge download stored
 * clip URLs server-side; dedicated gateways (media.loar.fun) 401 without the
 * pinataGatewayToken, which surfaced as "Failed to download clip 0: HTTP 401".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizedMediaUrl } from '../services/ffmpeg/clip-pipeline';

const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
// Subdomain gateways need a (lowercase) CIDv1 — hostnames are case-folded.
const CID_V1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('authorizedMediaUrl', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PINATA_GATEWAY_URL = 'https://media.loar.fun';
    process.env.PINATA_GATEWAY_TOKEN = 'tok123';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('adds the token to an untokenized dedicated-gateway URL', () => {
    expect(authorizedMediaUrl(`https://media.loar.fun/ipfs/${CID}`)).toBe(
      `https://media.loar.fun/ipfs/${CID}?pinataGatewayToken=tok123`
    );
  });

  it('re-points other gateways (path and subdomain style) at the dedicated one', () => {
    expect(authorizedMediaUrl(`https://foo.mypinata.cloud/ipfs/${CID}/clip.mp4`)).toBe(
      `https://media.loar.fun/ipfs/${CID}/clip.mp4?pinataGatewayToken=tok123`
    );
    expect(authorizedMediaUrl(`https://${CID_V1}.ipfs.dweb.link/`)).toBe(
      `https://media.loar.fun/ipfs/${CID_V1}?pinataGatewayToken=tok123`
    );
  });

  it('leaves non-IPFS URLs untouched', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/x/o/clip.mp4?alt=media';
    expect(authorizedMediaUrl(url)).toBe(url);
  });

  it('never attaches a token for a public gateway config or a missing token', () => {
    process.env.PINATA_GATEWAY_URL = 'https://ipfs.io';
    expect(authorizedMediaUrl(`https://ipfs.io/ipfs/${CID}`)).toBe(`https://ipfs.io/ipfs/${CID}`);
    process.env.PINATA_GATEWAY_URL = 'https://media.loar.fun';
    process.env.PINATA_GATEWAY_TOKEN = '';
    expect(authorizedMediaUrl(`https://media.loar.fun/ipfs/${CID}`)).toBe(
      `https://media.loar.fun/ipfs/${CID}`
    );
  });
});
