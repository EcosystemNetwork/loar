// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "./libraries/NodeOptions.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";

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
    mapping(address user => bool) public vaultWhitelisted;

    NodeCreationOptions private nodeCreationOption;
    NodeVisibilityOptions private nodeVisibilityOption;

    address public associatedToken;
    IUniverseManager public immutable universeManager;
    address public universeAdmin;
    uint public currentCanonId;  // tracked canon node (avoids unbounded loop)

    /// @notice Maximum children per node (prevents unbounded array growth)
    uint public constant MAX_CHILDREN_PER_NODE = 100;

    modifier onlyAdmin() {
      _checkAdmin();
      _;
    }

    function _checkAdmin() internal view {
      if (universeAdmin != msg.sender) {
        revert CallerNotAdmin(msg.sender);
      }
    }

    modifier onlyManager() {
      _checkManager();
      _;
    }

    function _checkManager() internal view {
      if (address(universeManager) != msg.sender) {
        revert CallerNotManager();
      }
    }

    function nodeIdToHex(uint id) public view returns (bytes32){
        if (id == 0 || id > latestNodeId) {
            revert NodeDoesNotExist();
        }
        bytes32 hash = keccak256(abi.encode(id));
        return hash;
    }

    function setWhitelisted(address user, bool status) public onlyAdmin {
        isWhitelisted[user] = status;
        emit WhitelistedUpdated(user, status);
    }

    function getWhitelisted(address user) public view returns (bool) {
        return isWhitelisted[user];
    }

    function setVaultWhitelisted(address user, bool status) public onlyAdmin {
        vaultWhitelisted[user] = status;
        emit VaultWhitelistUpdated(user, status);
    }

    function getVaultWhitelisted(address user) public view returns (bool) {
        return vaultWhitelisted[user];
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
        require(_previous == 0 || nodes[_previous].id != 0, "Previous node does not exist");
        // Token-gated creation: if visibility is HOLDERS, require token balance
        if (nodeVisibilityOption == NodeVisibilityOptions.HOLDERS && associatedToken != address(0)) {
            require(
                IERC20(associatedToken).balanceOf(msg.sender) > 0,
                "Must hold universe token"
            );
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
            require(nodes[_previous].next.length < MAX_CHILDREN_PER_NODE, "Max children reached");
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

    /// @notice Maximum timeline traversal depth to prevent gas exhaustion DoS
    uint public constant MAX_TIMELINE_DEPTH = 1000;

    function getTimeline(uint fromId) public view returns (uint[] memory) {
        uint count = 0;
        uint cursor = fromId;

        while (cursor != 0 && count < MAX_TIMELINE_DEPTH) {
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
        require(nodes[id].id != 0, "Node does not exist");
        nodes[id].contentHash = _contentHash;
        emit MediaUpdated(id, msg.sender, _contentHash, _link);
    }

    /// @notice Swap the content (media + plot) between two nodes, keeping DAG structure intact.
    /// @param nodeA First node ID
    /// @param nodeB Second node ID
    function swapNodes(uint nodeA, uint nodeB) public onlyAdmin {
        require(nodeA != nodeB, "Cannot swap a node with itself");
        require(nodes[nodeA].id != 0, "Node A does not exist");
        require(nodes[nodeB].id != 0, "Node B does not exist");

        bytes32 tempContentHash = nodes[nodeA].contentHash;
        bytes32 tempPlotHash = nodes[nodeA].plotHash;

        nodes[nodeA].contentHash = nodes[nodeB].contentHash;
        nodes[nodeA].plotHash = nodes[nodeB].plotHash;

        nodes[nodeB].contentHash = tempContentHash;
        nodes[nodeB].plotHash = tempPlotHash;

        emit NodesSwapped(nodeA, nodeB, msg.sender);
    }

    function setNodeVisibilityOption(
        NodeVisibilityOptions _option
    ) public onlyAdmin {
        nodeVisibilityOption = _option;
        emit NodeVisibilityOptionUpdated(_option);
    }

    function setNodeCreationOption(
        NodeCreationOptions _option
    ) public onlyAdmin {
        nodeCreationOption = _option;
        emit NodeCreationOptionUpdated(_option);
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

    /// @notice Paginated version of getFullGraph. Returns nodes from startId to startId+count-1.
    /// @param startId First node ID to include (must be >= 1)
    /// @param count   Maximum number of nodes to return
    function getGraphPage(uint startId, uint count)
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
        uint endId = startId + count - 1;
        if (endId > latestNodeId) endId = latestNodeId;
        if (startId > endId || startId == 0) {
            return (new uint[](0), new bytes32[](0), new bytes32[](0), new uint[](0), new uint[][](0), new bool[](0));
        }
        uint total = endId - startId + 1;

        ids = new uint[](total);
        contentHashes = new bytes32[](total);
        plotHashes = new bytes32[](total);
        previousIds = new uint[](total);
        nextIds = new uint[][](total);
        canonFlags = new bool[](total);

        for (uint i = 0; i < total; i++) {
            VideoNode storage n = nodes[startId + i];
            ids[i] = n.id;
            contentHashes[i] = n.contentHash;
            plotHashes[i] = n.plotHash;
            previousIds[i] = n.previous;
            canonFlags[i] = n.canon;

            uint len = n.next.length;
            uint[] memory tmpNext = new uint[](len);
            for (uint j = 0; j < len; j++) {
                tmpNext[j] = n.next[j];
            }
            nextIds[i] = tmpNext;
        }

        return (ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags);
    }

    // ---- Canon ----

    function setCanon(uint id) public onlyAdmin {
        if (nodes[id].id == 0) {
            revert NodeDoesNotExist();
        }

        // O(1) — unset previous canon, set new one
        if (currentCanonId != 0) {
            nodes[currentCanonId].canon = false;
        }
        nodes[id].canon = true;
        currentCanonId = id;
        emit NodeCanonized(id, msg.sender);
    }

    function getCanonChain() public view returns (uint[] memory) {
        if (currentCanonId == 0) {
            revert CanonNotSet();
        }
        return getTimeline(currentCanonId);
    }

    function getToken() public view returns (address) {
      return associatedToken;
    }

    function setToken(address token) external onlyManager{
        require(token != address(0), "Zero token address");
        associatedToken = token;
        emit TokenUpdated(token);
    }
    function setAdmin(address newAdmin) public onlyManager {
      require(newAdmin != address(0), "Zero admin address");
      universeAdmin = newAdmin;
      emit AdminUpdated(newAdmin);
    }
    function getAdmin() external view returns(address) {
      return universeAdmin;
    }
}
