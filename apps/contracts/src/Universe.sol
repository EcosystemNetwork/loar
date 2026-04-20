// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

import {IUniverse} from "./interfaces/IUniverse.sol";
import {IUniverseManager} from "./interfaces/IUniverseManager.sol";
import {NodeCreationOptions, NodeVisibilityOptions} from "./libraries/NodeOptions.sol";
import {IERC20} from "@openzeppelin/interfaces/IERC20.sol";
import {ReentrancyGuard} from "solady/src/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/utils/Pausable.sol";

contract Universe is IUniverse, ReentrancyGuard, Pausable {
    struct VideoNode {
        bytes32 contentHash; // SHA-256 hash of media file
        uint256 id;
        bytes32 plotHash; // SHA-256 hash of plot text
        uint256 previous;
        uint256[] next;
        /// @dev Only meaningful for currentCanonId. Use getCanonChain() to determine full canon membership.
        bool canon;
        address creator;
    }

    constructor(IUniverseManager.UniverseConfig memory config) {
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
    mapping(uint256 => VideoNode) public nodes;
    uint256 public latestNodeId;
    mapping(address user => bool) isWhitelisted;
    mapping(address user => bool) public vaultWhitelisted;

    NodeCreationOptions private nodeCreationOption;
    NodeVisibilityOptions private nodeVisibilityOption;

    address public associatedToken;
    IUniverseManager public immutable universeManager;
    address public universeAdmin;
    uint256 public currentCanonId; // current canon tip node ID (not "is part of canon chain" — use getCanonChain())

    /// @notice Maximum children per node (prevents unbounded array growth)
    uint256 public constant MAX_CHILDREN_PER_NODE = 100;

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

    function nodeIdToHex(uint256 id) public view returns (bytes32) {
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

    /// @notice Batch whitelist multiple addresses in a single transaction.
    /// @param users Array of addresses to update
    /// @param status Whitelist status to set for all addresses
    function batchSetWhitelisted(address[] calldata users, bool status) external onlyAdmin {
        require(users.length <= 200, "Batch too large");
        for (uint256 i = 0; i < users.length; i++) {
            isWhitelisted[users[i]] = status;
            emit WhitelistedUpdated(users[i], status);
        }
    }

    function getWhitelisted(address user) public view returns (bool) {
        return isWhitelisted[user];
    }

    function setVaultWhitelisted(address user, bool status) public onlyAdmin {
        vaultWhitelisted[user] = status;
        emit VaultWhitelistUpdated(user, status);
    }

    /// @notice Batch vault whitelist multiple addresses in a single transaction.
    function batchSetVaultWhitelisted(address[] calldata users, bool status) external onlyAdmin {
        require(users.length <= 200, "Batch too large");
        for (uint256 i = 0; i < users.length; i++) {
            vaultWhitelisted[users[i]] = status;
            emit VaultWhitelistUpdated(users[i], status);
        }
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
        uint256 _previous,
        string calldata _link,
        string calldata _plot
    ) public nonReentrant whenNotPaused returns (uint256) {
        if (nodeCreationOption == NodeCreationOptions.WHITELISTED) {
            require(isWhitelisted[msg.sender], "Not whitelisted");
        }
        require(_previous == 0 || nodes[_previous].id != 0, "Previous node does not exist");
        // Token-gated creation: if visibility is HOLDERS, require token balance
        if (nodeVisibilityOption == NodeVisibilityOptions.HOLDERS && associatedToken != address(0))
        {
            require(IERC20(associatedToken).balanceOf(msg.sender) > 0, "Must hold universe token");
        }
        latestNodeId++;
        uint256 newId = latestNodeId;

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

    function getNode(uint256 id)
        public
        view
        returns (uint256, bytes32, bytes32, uint256, uint256[] memory, bool, address)
    {
        VideoNode storage n = nodes[id];
        return (n.id, n.contentHash, n.plotHash, n.previous, n.next, n.canon, n.creator);
    }

    /// @notice Maximum timeline traversal depth to prevent gas exhaustion DoS
    uint256 public constant MAX_TIMELINE_DEPTH = 1000;

    function getTimeline(uint256 fromId) public view returns (uint256[] memory) {
        uint256 count = 0;
        uint256 cursor = fromId;

        while (cursor != 0 && count < MAX_TIMELINE_DEPTH) {
            count++;
            cursor = nodes[cursor].previous;
        }

        uint256[] memory chain = new uint256[](count);
        cursor = fromId;
        for (uint256 i = 0; i < count; i++) {
            chain[i] = cursor;
            cursor = nodes[cursor].previous;
        }

        return chain;
    }

    function getLeaves() public view returns (uint256[] memory) {
        uint256[] memory temp = new uint256[](latestNodeId);
        uint256 count = 0;

        for (uint256 i = 1; i <= latestNodeId; i++) {
            if (nodes[i].id != 0 && nodes[i].next.length == 0) {
                temp[count] = i;
                count++;
            }
        }

        uint256[] memory leaves = new uint256[](count);
        for (uint256 j = 0; j < count; j++) {
            leaves[j] = temp[j];
        }
        return leaves;
    }

    /// @notice Paginated version of getLeaves() (L1 fix)
    function getLeavesPage(uint256 offset, uint256 limit) public view returns (uint256[] memory) {
        // First pass: count all leaves
        uint256 count = 0;
        for (uint256 i = 1; i <= latestNodeId; i++) {
            if (nodes[i].id != 0 && nodes[i].next.length == 0) {
                count++;
            }
        }

        if (offset >= count) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > count) end = count;
        uint256 resultSize = end - offset;

        uint256[] memory result = new uint256[](resultSize);
        uint256 leafIndex = 0;
        uint256 resultIndex = 0;

        for (uint256 i = 1; i <= latestNodeId && resultIndex < resultSize; i++) {
            if (nodes[i].id != 0 && nodes[i].next.length == 0) {
                if (leafIndex >= offset) {
                    result[resultIndex] = i;
                    resultIndex++;
                }
                leafIndex++;
            }
        }

        return result;
    }

    function getMedia(uint256 id) public view returns (bytes32) {
        return nodes[id].contentHash;
    }

    /// @notice UNIVERSE-01: setMedia is now restricted to the original creator OR admin
    ///         on non-canon nodes only. Canon content is immutable on-chain — admin cannot
    ///         rewrite media that has been promoted to the canonical chain.
    function setMedia(uint256 id, bytes32 _contentHash, string calldata _link) public {
        require(nodes[id].id != 0, "Node does not exist");
        address originalCreator = nodes[id].creator;
        require(
            msg.sender == originalCreator || (msg.sender == universeAdmin && !nodes[id].canon),
            "UNIVERSE-01: creator-only after canon promotion"
        );
        nodes[id].contentHash = _contentHash;
        emit MediaUpdated(id, msg.sender, _contentHash, _link);
        emit MediaUpdatedAttribution(id, msg.sender, originalCreator, _contentHash);
    }

    /// @notice Swap the content (media + plot) between two nodes, keeping DAG structure intact.
    /// @dev    UNIVERSE-01: Canon nodes cannot be involved in a swap — preserves on-chain
    ///         canon integrity.
    /// @param nodeA First node ID
    /// @param nodeB Second node ID
    function swapNodes(uint256 nodeA, uint256 nodeB) public onlyAdmin {
        require(nodeA != nodeB, "Cannot swap a node with itself");
        require(nodes[nodeA].id != 0, "Node A does not exist");
        require(nodes[nodeB].id != 0, "Node B does not exist");
        require(
            !nodes[nodeA].canon && !nodes[nodeB].canon, "UNIVERSE-01: canon nodes are immutable"
        );

        bytes32 tempContentHash = nodes[nodeA].contentHash;
        bytes32 tempPlotHash = nodes[nodeA].plotHash;
        address tempCreator = nodes[nodeA].creator;

        nodes[nodeA].contentHash = nodes[nodeB].contentHash;
        nodes[nodeA].plotHash = nodes[nodeB].plotHash;
        nodes[nodeA].creator = nodes[nodeB].creator;

        nodes[nodeB].contentHash = tempContentHash;
        nodes[nodeB].plotHash = tempPlotHash;
        nodes[nodeB].creator = tempCreator;

        emit NodesSwapped(nodeA, nodeB, msg.sender);
    }

    function setNodeVisibilityOption(NodeVisibilityOptions _option) public onlyAdmin {
        nodeVisibilityOption = _option;
        emit NodeVisibilityOptionUpdated(_option);
    }

    function setNodeCreationOption(NodeCreationOptions _option) public onlyAdmin {
        nodeCreationOption = _option;
        emit NodeCreationOptionUpdated(_option);
    }

    function getFullGraph()
        public
        view
        returns (
            uint256[] memory ids,
            bytes32[] memory contentHashes,
            bytes32[] memory plotHashes,
            uint256[] memory previousIds,
            uint256[][] memory nextIds,
            bool[] memory canonFlags
        )
    {
        require(latestNodeId <= 500, "Use getGraphPage for large graphs");
        uint256 total = latestNodeId;

        ids = new uint256[](total);
        contentHashes = new bytes32[](total);
        plotHashes = new bytes32[](total);
        previousIds = new uint256[](total);
        nextIds = new uint256[][](total);
        canonFlags = new bool[](total);

        for (uint256 i = 1; i <= total; i++) {
            VideoNode storage n = nodes[i];

            ids[i - 1] = n.id;
            contentHashes[i - 1] = n.contentHash;
            plotHashes[i - 1] = n.plotHash;
            previousIds[i - 1] = n.previous;
            canonFlags[i - 1] = n.canon;

            uint256 len = n.next.length;
            uint256[] memory tmpNext = new uint256[](len);
            for (uint256 j = 0; j < len; j++) {
                tmpNext[j] = n.next[j];
            }
            nextIds[i - 1] = tmpNext;
        }

        return (ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags);
    }

    /// @notice Paginated version of getFullGraph. Returns nodes from startId to startId+count-1.
    /// @param startId First node ID to include (must be >= 1)
    /// @param count   Maximum number of nodes to return
    function getGraphPage(uint256 startId, uint256 count)
        public
        view
        returns (
            uint256[] memory ids,
            bytes32[] memory contentHashes,
            bytes32[] memory plotHashes,
            uint256[] memory previousIds,
            uint256[][] memory nextIds,
            bool[] memory canonFlags
        )
    {
        uint256 endId = startId + count - 1;
        if (endId > latestNodeId) endId = latestNodeId;
        if (startId > endId || startId == 0) {
            return (
                new uint256[](0),
                new bytes32[](0),
                new bytes32[](0),
                new uint256[](0),
                new uint256[][](0),
                new bool[](0)
            );
        }
        uint256 total = endId - startId + 1;

        ids = new uint256[](total);
        contentHashes = new bytes32[](total);
        plotHashes = new bytes32[](total);
        previousIds = new uint256[](total);
        nextIds = new uint256[][](total);
        canonFlags = new bool[](total);

        for (uint256 i = 0; i < total; i++) {
            VideoNode storage n = nodes[startId + i];
            ids[i] = n.id;
            contentHashes[i] = n.contentHash;
            plotHashes[i] = n.plotHash;
            previousIds[i] = n.previous;
            canonFlags[i] = n.canon;

            uint256 len = n.next.length;
            uint256[] memory tmpNext = new uint256[](len);
            for (uint256 j = 0; j < len; j++) {
                tmpNext[j] = n.next[j];
            }
            nextIds[i] = tmpNext;
        }

        return (ids, contentHashes, plotHashes, previousIds, nextIds, canonFlags);
    }

    // ---- Canon ----

    /// @notice Set the canon tip. The full canon chain is derived via getCanonChain() / getTimeline().
    /// @dev The `canon` boolean on VideoNode is ONLY meaningful for `currentCanonId` — it marks the
    ///      current tip, not membership in the canon chain. Use getCanonChain() to get the full chain.
    ///      This is an O(1) operation — walk-and-update would be O(n) and gas-prohibitive for long chains.
    function setCanon(uint256 id) public onlyAdmin {
        if (nodes[id].id == 0) {
            revert NodeDoesNotExist();
        }

        uint256 previousCanon = currentCanonId;

        // O(1) — unset previous canon, set new one
        if (previousCanon != 0) {
            nodes[previousCanon].canon = false;
        }
        nodes[id].canon = true;
        currentCanonId = id;
        emit CanonChanged(id, previousCanon, msg.sender);
    }

    function getCanonChain() public view returns (uint256[] memory) {
        if (currentCanonId == 0) {
            revert CanonNotSet();
        }
        return getTimeline(currentCanonId);
    }

    function getToken() public view returns (address) {
        return associatedToken;
    }

    function setToken(address token) external onlyManager {
        require(token != address(0), "Zero token address");
        associatedToken = token;
        emit TokenUpdated(token);
    }

    function setAdmin(address newAdmin) public onlyManager {
        require(newAdmin != address(0), "Zero admin address");
        universeAdmin = newAdmin;
        emit AdminUpdated(newAdmin);
    }

    function getAdmin() external view returns (address) {
        return universeAdmin;
    }

    // ---- Pausable (emergency stop) ----

    /// @notice Pause node creation. Only callable by admin (governor after token deploy).
    function pause() external onlyAdmin {
        _pause();
    }

    /// @notice Unpause node creation.
    function unpause() external onlyAdmin {
        _unpause();
    }
}
