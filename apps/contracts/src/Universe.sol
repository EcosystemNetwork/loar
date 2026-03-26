// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.13;

import {Ownable} from "@openzeppelin/access/Ownable.sol";
import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "./libraries/NodeOptions.sol";

contract Universe is IUniverse {

    struct VideoNode {
        bytes32 contentHash;   // SHA-256 hash of media file
        uint id;
        bytes32 plotHash;      // SHA-256 hash of plot text
        uint previous;
        uint[] next;
        bool canon;
        address creator;
    }

    constructor(
        IUniverseManager.UniverseConfig memory config
    ) {
        require(config.universeAdmin != address(0), "Zero admin address");
        require(config.universeManager != address(0), "Zero manager address");
        nodeCreationOption = config.nodeCreationOption;
        nodeVisibilityOption = config.nodeVisibilityOption;
        universeImageUrl = config.imageURL;
        universeManager = IUniverseManager(config.universeManager);
        universeDescription = config.description;
        universeName = config.name;
        universeAdmin = config.universeAdmin;
    }

    string public universeImageUrl;
    string public universeName;
    string public universeDescription;
    mapping(uint => VideoNode) public nodes;
    uint public latestNodeId;
    mapping(address user => bool) isWhitelisted;

    NodeCreationOptions private nodeCreationOption;
    NodeVisibilityOptions private nodeVisibilityOption;

    address public associatedToken;
    IUniverseManager public universeManager;
    address public universeAdmin;

    modifier onlyAdmin() {
      if (universeAdmin != msg.sender) {
        revert CallerNotAdmin(msg.sender);
      }
      _;
    }
    modifier onlyManager() {
      if (address(universeManager) != msg.sender) {
        revert CallerNotManager();
      }
      _;
    }

    function nodeIDToHex(uint id) public view returns (bytes32){
        if (id == 0 || id > latestNodeId) {
            revert NodeDoesNotExist();
        }
        bytes32 hash = keccak256(abi.encode(id));
        return hash;
    }

    function setWhitelisted(address user, bool status) public onlyAdmin {
        isWhitelisted[user] = status;
    }

    function getWhitelisted(address user) public view returns (bool) {
        return isWhitelisted[user];
    }

    /// @notice Create a new narrative node. Hashes are stored on-chain; full strings emitted in event only.
    /// @param _contentHash SHA-256 hash of the media file
    /// @param _plotHash SHA-256 hash of the plot text
    /// @param _previous ID of parent node (0 if root)
    /// @param _link Full media URL (emitted in event only, not stored)
    /// @param _plot Full plot text (emitted in event only, not stored)
    function createNode(
        bytes32 _contentHash,
        bytes32 _plotHash,
        uint _previous,
        string calldata _link,
        string calldata _plot
    ) public returns (uint) {
        if (nodeCreationOption == NodeCreationOptions.WHITELISTED) {
            require(isWhitelisted[msg.sender], "Not whitelisted");
        }
        latestNodeId++;
        uint newId = latestNodeId;

        nodes[newId].id = newId;
        nodes[newId].contentHash = _contentHash;
        nodes[newId].plotHash = _plotHash;
        nodes[newId].previous = _previous;
        nodes[newId].creator = msg.sender;

        if (_previous == 0) {
            nodes[newId].canon = true;
        }

        if (_previous != 0) {
            nodes[_previous].next.push(newId);
        }

        emit NodeCreated(newId, _previous, msg.sender, _contentHash, _plotHash, _link, _plot);
        return newId;
    }

    function getNode(
        uint id
    )
        public
        view
        returns (
            uint,
            bytes32,
            bytes32,
            uint,
            uint[] memory,
            bool,
            address
        )
    {
        VideoNode storage n = nodes[id];
        return (n.id, n.contentHash, n.plotHash, n.previous, n.next, n.canon, n.creator);
    }

    function getTimeline(uint fromId) public view returns (uint[] memory) {
        uint count = 0;
        uint cursor = fromId;

        while (cursor != 0) {
            count++;
            cursor = nodes[cursor].previous;
        }

        uint[] memory chain = new uint[](count);
        cursor = fromId;
        for (uint i = 0; i < count; i++) {
            chain[i] = cursor;
            cursor = nodes[cursor].previous;
        }

        return chain;
    }

    function getLeaves() public view returns (uint[] memory) {
        uint[] memory temp = new uint[](latestNodeId);
        uint count = 0;

        for (uint i = 1; i <= latestNodeId; i++) {
            if (nodes[i].id != 0 && nodes[i].next.length == 0) {
                temp[count] = i;
                count++;
            }
        }

        uint[] memory leaves = new uint[](count);
        for (uint j = 0; j < count; j++) {
            leaves[j] = temp[j];
        }
        return leaves;
    }

    function getMedia(uint id) public view returns (bytes32) {
        return nodes[id].contentHash;
    }

    function setMedia(uint id, bytes32 _contentHash, string calldata _link) public onlyAdmin {
        nodes[id].contentHash = _contentHash;
        emit MediaUpdated(msg.sender, _contentHash, _link);
    }

    function setNodeVisibilityOption(
        NodeVisibilityOptions _option
    ) public onlyAdmin {
        nodeVisibilityOption = _option;
    }

    function setNodeCreationOption(
        NodeCreationOptions _option
    ) public onlyAdmin {
        nodeCreationOption = _option;
    }

    function getFullGraph()
        public
        view
        returns (
            uint[] memory ids,
            bytes32[] memory contentHashes,
            bytes32[] memory plotHashes,
            uint[] memory previousIds,
            uint[][] memory nextIds,
            bool[] memory canonFlags
        )
    {
        uint total = latestNodeId;

        ids = new uint[](total);
        contentHashes = new bytes32[](total);
        plotHashes = new bytes32[](total);
        previousIds = new uint[](total);
        nextIds = new uint[][](total);
        canonFlags = new bool[](total);

        for (uint i = 1; i <= total; i++) {
            VideoNode storage n = nodes[i];

            ids[i - 1] = n.id;
            contentHashes[i - 1] = n.contentHash;
            plotHashes[i - 1] = n.plotHash;
            previousIds[i - 1] = n.previous;
            canonFlags[i - 1] = n.canon;

            uint len = n.next.length;
            uint[] memory tmpNext = new uint[](len);
            for (uint j = 0; j < len; j++) {
                tmpNext[j] = n.next[j];
            }
            nextIds[i - 1] = tmpNext;
        }

        return (ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags);
    }

    // ---- Canon ----

    function setCanon(uint id) public onlyAdmin {
        if (nodes[id].id == 0) {
            revert NodeDoesNotExist();
        }

        for (uint i = 1; i <= latestNodeId; i++) {
            if (nodes[i].canon) {
                nodes[i].canon = false;
            }
        }

        nodes[id].canon = true;
        emit NodeCanonized(id, msg.sender);
    }

    function getCanonChain() public view returns (uint[] memory) {
        uint canonId = 0;
        for (uint i = 1; i <= latestNodeId; i++) {
            if (nodes[i].canon) {
                canonId = i;
                break;
            }
        }
        if (canonId == 0) {
            revert CanonNotSet();
        }
        return getTimeline(canonId);
    }

    function getToken() public view returns (address) {
      return associatedToken;
    }

    function setToken(address token) external onlyManager{
        associatedToken = token;
    }
    function setAdmin(address newAdmin) public onlyManager {
      universeAdmin = newAdmin;
    }
    function getAdmin() external view returns(address) {
      return universeAdmin;
    }
}
