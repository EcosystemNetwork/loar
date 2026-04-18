// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";
import {Base64} from "@openzeppelin/utils/Base64.sol";

/// @dev IDENTITY-02: Minimal interface for dynamic universe metadata lookup at tokenURI time.
interface IUniverseMeta {
    function universeName() external view returns (string memory);
    function universeImageUrl() external view returns (string memory);
}

/// @title IdentityNFT (INFT)
/// @notice Soulbound-style identity NFTs for universe co-creators.
///         When a universe is created by a Gnosis Safe multi-sig, each signer
///         receives an INFT labelled "1/3", "2/3", etc. EOA creators receive
///         a single "1/1" INFT.
///
///         Minted exclusively by the UniverseManager. Fully on-chain metadata.
contract IdentityNFT is ERC721, Ownable {
    using Strings for uint256;
    using Strings for address;

    struct SignerInfo {
        uint256 universeId;
        uint8 signerIndex;   // 1-based
        uint8 totalSigners;  // total signers at mint time
        address safeAddress; // address(0) for EOA creators
        address universeContract;
        string universeName;
        string universeImage;
    }

    /// @notice Only the UniverseManager can mint INFTs.
    address public minter;

    uint256 private _nextTokenId;

    /// @notice Per-token signer metadata.
    mapping(uint256 => SignerInfo) public signerInfo;

    /// @notice Tracks whether a signer already has an INFT for a given universe.
    ///         keccak256(universeId, signer) => tokenId (0 means none).
    mapping(bytes32 => uint256) public signerTokenForUniverse;

    event Minted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 indexed universeId,
        uint8 signerIndex,
        uint8 totalSigners
    );
    event MinterUpdated(address oldMinter, address newMinter);

    error OnlyMinter();
    error AlreadyMinted();

    constructor(address _minter) ERC721("LOAR Identity", "INFT") Ownable(msg.sender) {
        minter = _minter;
        _nextTokenId = 1; // start at 1
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert OnlyMinter();
        _;
    }

    function setMinter(address _minter) external onlyOwner {
        address old = minter;
        minter = _minter;
        emit MinterUpdated(old, _minter);
    }

    /// @notice Mint an identity NFT to a universe co-creator.
    /// @param to          The signer/creator receiving the INFT.
    /// @param universeId  On-chain universe ID.
    /// @param signerIndex 1-based index of this signer.
    /// @param totalSigners Total signers (1 for EOA, N for multi-sig).
    /// @param safe        The Safe address (address(0) for EOA).
    /// @param universeContract The Universe contract address.
    /// @param universeName Universe name (for on-chain metadata).
    /// @param universeImage Universe image URL (for on-chain metadata).
    function mint(
        address to,
        uint256 universeId,
        uint8 signerIndex,
        uint8 totalSigners,
        address safe,
        address universeContract,
        string calldata universeName,
        string calldata universeImage
    ) external onlyMinter returns (uint256 tokenId) {
        // Prevent duplicate INFTs for the same signer + universe
        bytes32 key = keccak256(abi.encodePacked(universeId, to));
        if (signerTokenForUniverse[key] != 0) revert AlreadyMinted();

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        signerInfo[tokenId] = SignerInfo({
            universeId: universeId,
            signerIndex: signerIndex,
            totalSigners: totalSigners,
            safeAddress: safe,
            universeContract: universeContract,
            universeName: universeName,
            universeImage: universeImage
        });

        signerTokenForUniverse[key] = tokenId;

        emit Minted(tokenId, to, universeId, signerIndex, totalSigners);
    }

    /// @notice Fully on-chain tokenURI. Shows signer fraction, universe info.
    /// @dev IDENTITY-02: Reads universeName and universeImage dynamically from the
    ///      Universe contract so rebrands flow through to INFT metadata. Falls back
    ///      to the snapshot taken at mint if the live call reverts.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        SignerInfo storage info = signerInfo[tokenId];

        string memory liveName = info.universeName;
        string memory liveImage = info.universeImage;
        if (info.universeContract != address(0)) {
            try IUniverseMeta(info.universeContract).universeName() returns (string memory n) {
                if (bytes(n).length > 0) liveName = n;
            } catch {}
            try IUniverseMeta(info.universeContract).universeImageUrl() returns (string memory img) {
                if (bytes(img).length > 0) liveImage = img;
            } catch {}
        }

        string memory fraction = string(abi.encodePacked(
            uint256(info.signerIndex).toString(),
            "/",
            uint256(info.totalSigners).toString()
        ));

        string memory name = info.totalSigners == 1
            ? string(abi.encodePacked("LOAR Creator - ", liveName))
            : string(abi.encodePacked("LOAR Signer ", fraction, " - ", liveName));

        string memory description = info.totalSigners == 1
            ? string(abi.encodePacked("Identity NFT for the creator of ", liveName))
            : string(abi.encodePacked(
                "Identity NFT for signer ", fraction, " of the multi-sig governing ", liveName
            ));

        string memory json = string(abi.encodePacked(
            '{"name":"', name,
            '","description":"', description,
            '","image":"', liveImage,
            '","external_url":"https://loar.fun/universe/', info.universeContract.toHexString(),
            '","attributes":[',
                '{"trait_type":"Universe ID","value":"', info.universeId.toString(), '"}',
                ',{"trait_type":"Signer Position","value":"', fraction, '"}',
                ',{"trait_type":"Total Signers","value":"', uint256(info.totalSigners).toString(), '"}',
                ',{"trait_type":"Universe Contract","value":"', info.universeContract.toHexString(), '"}',
                info.safeAddress != address(0)
                    ? string(abi.encodePacked(',{"trait_type":"Safe Address","value":"', info.safeAddress.toHexString(), '"}'))
                    : '',
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    // IDENTITY-01: Soulbound — only mints allowed, no transfers
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        require(from == address(0), "Soulbound: transfers disabled");
        return from;
    }

    /// @notice Total INFTs minted.
    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
