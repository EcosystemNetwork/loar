// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/**
 * LoarAgentResolver — ENSIP-10 wildcard + EIP-3668 CCIP-Read resolver for
 * LOAR's offchain agent subnames (e.g. *.agents.loar.eth).
 *
 * Set this as the resolver for the parent name (agents.loar.eth). Resolution of
 * any subname reverts with OffchainLookup, directing the client to LOAR's CCIP
 * gateway (GET /api/ens/ccip/{sender}/{data}.json). The gateway returns a
 * signed answer that resolveWithProof() verifies against a trusted signer, so
 * an entire agent fleet gets gasless, verifiable ENS names.
 *
 * Signing scheme matches apps/server/src/routes/ens.ts:
 *   digest = keccak256(0x1900 ‖ resolver ‖ uint64(expires)
 *                       ‖ keccak256(request) ‖ keccak256(result))
 */
contract LoarAgentResolver {
    /// EIP-3668 CCIP-Read.
    error OffchainLookup(
        address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData
    );

    string[] public gatewayUrls;
    address public owner;
    mapping(address => bool) public signers;

    event GatewayUrlsChanged(string[] urls);
    event SignerChanged(address indexed signer, bool allowed);
    event OwnerChanged(address indexed newOwner);

    constructor(string[] memory _urls, address _signer) {
        owner = msg.sender;
        gatewayUrls = _urls;
        signers[_signer] = true;
        emit GatewayUrlsChanged(_urls);
        emit SignerChanged(_signer, true);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function setGatewayUrls(string[] calldata _urls) external onlyOwner {
        gatewayUrls = _urls;
        emit GatewayUrlsChanged(_urls);
    }

    function setSigner(address signer, bool allowed) external onlyOwner {
        signers[signer] = allowed;
        emit SignerChanged(signer, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        owner = newOwner;
        emit OwnerChanged(newOwner);
    }

    /**
     * ENSIP-10 resolve(): always defers offchain. `name` is DNS-encoded, `data`
     * is the inner resolver call (addr/text). We forward both to the gateway.
     */
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeWithSelector(this.resolve.selector, name, data);
        revert OffchainLookup(
            address(this), gatewayUrls, callData, this.resolveWithProof.selector, callData
        );
    }

    /**
     * CCIP callback: verify the gateway's signed response and return the result.
     * `response` = abi.encode(bytes result, uint64 expires, bytes sig).
     * `extraData` = the original request (callData) passed through.
     */
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) =
            abi.decode(response, (bytes, uint64, bytes));
        require(expires >= block.timestamp, "signature expired");

        bytes32 digest = keccak256(
            abi.encodePacked(
                hex"1900", address(this), expires, keccak256(extraData), keccak256(result)
            )
        );
        address signer = _recover(digest, sig);
        require(signers[signer], "invalid signer");
        return result;
    }

    /// ENSIP-10 interface id + ERC-165.
    function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
        return interfaceID == 0x9061b923 // IExtendedResolver.resolve
            || interfaceID == 0x01ffc9a7; // ERC-165
    }

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "bad sig");
        return signer;
    }
}
