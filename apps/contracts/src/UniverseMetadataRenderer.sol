// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IUniverseMetadataRenderer} from "./interfaces/IUniverseMetadataRenderer.sol";
import {IUniverse} from "./interfaces/IUniverse.sol";
import {Strings} from "@openzeppelin/utils/Strings.sol";
import {Base64} from "@openzeppelin/utils/Base64.sol";

/// @title UniverseMetadataRenderer
/// @notice Generates fully on-chain ERC-721 tokenURI JSON for universe NFTs.
///         Extracted from UniverseManager to reduce its bytecode size
///         (Strings + Base64 libraries add ~2 KB).
contract UniverseMetadataRenderer is IUniverseMetadataRenderer {
    using Strings for uint256;
    using Strings for address;

    function tokenURI(uint256 tokenId, address universeAddr, address tokenAddr)
        external
        view
        returns (string memory)
    {
        IUniverse universe = IUniverse(universeAddr);

        string memory universeName = universe.universeName();
        string memory universeDesc = universe.universeDescription();
        string memory universeImage = universe.universeImageUrl();
        bool hasToken = tokenAddr != address(0);

        string memory json = string(
            abi.encodePacked(
                '{"name":"',
                universeName,
                '","description":"',
                universeDesc,
                '","image":"',
                universeImage,
                '","external_url":"https://loar.fun/universe/',
                universeAddr.toHexString(),
                '","attributes":[',
                '{"trait_type":"Universe Contract","value":"',
                universeAddr.toHexString(),
                '"}',
                ',{"trait_type":"Universe ID","value":"',
                tokenId.toString(),
                '"}',
                ',{"trait_type":"Has Token","value":"',
                hasToken ? "true" : "false",
                '"}',
                hasToken
                    ? string(
                        abi.encodePacked(
                            ',{"trait_type":"Token","value":"', tokenAddr.toHexString(), '"}'
                        )
                    )
                    : "",
                "]}"
            )
        );

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
