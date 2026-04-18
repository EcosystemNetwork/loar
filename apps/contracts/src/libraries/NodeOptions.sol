// SPDX-License-Identifier: MIT
pragma solidity =0.8.30;

/// @notice Controls who can create new nodes in a universe timeline.
enum NodeCreationOptions {
    PUBLIC,      // Anyone can create nodes
    WHITELISTED  // Only whitelisted addresses can create nodes
}

/// @notice Controls who can view node content in a universe timeline.
enum NodeVisibilityOptions {
    PUBLIC,      // Visible to everyone
    HOLDERS,     // Only governance token holders can view
    WHITELISTED  // Only whitelisted addresses can view
}
