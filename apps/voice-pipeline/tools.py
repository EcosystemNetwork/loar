"""The Voice Director's tool layer.

Each tool is a thin call into LOAR's existing tRPC backend (see
apps/server/src/routers/director/director.routes.ts) — the pipeline never
writes to the database itself, so ownership checks, credit gating and
validation stay wherever LOAR already enforces them.

Tool results go back to the LLM, which speaks them, so they're kept compact
and errors are returned as `{"error": ...}` (never raised) — a failed call
becomes a sentence the director says aloud rather than a dead pipeline.
"""

from __future__ import annotations

from typing import Any

from loguru import logger
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.llm_service import FunctionCallParams

from loar_client import LoarClient, LoarError

MAX_CONTEXT_CHARS = 6000
MAX_CONTENT_CHARS = 2000
CANON_SPLIT = "\n\n[STORY NODES]"


def primary_tail(nodes: list[dict[str, Any]]) -> int:
    """Node id at the end of the story's primary path (0 if the graph is empty).

    Follows the earliest-created child from the root, matching the server's
    `primaryPath` — later siblings are alternate branches, not the main line.
    """
    children: dict[int, list[int]] = {}
    for n in nodes:
        children.setdefault(int(n.get("previousNodeId") or 0), []).append(int(n["nodeId"]))
    tail, current, seen = 0, min(children.get(0, []), default=None), set()
    while current is not None and current not in seen:
        seen.add(current)
        tail = current
        current = min(children.get(current, []), default=None)
    return tail


class DirectorSession:
    """Per-connection state shared by the tool handlers."""

    def __init__(
        self,
        client: LoarClient,
        universe_id: str,
        characters: list[dict[str, str]],
        nodes: list[dict[str, Any]],
    ) -> None:
        self.client = client
        self.universe_id = universe_id
        self.characters = {c["name"]: c["id"] for c in characters}
        # What "that scene" means when the user says "change that": the node
        # touched most recently this session, else the end of the main line.
        self.last_node_id: int | None = None
        self._initial_tail = primary_tail(nodes)

    @property
    def default_node_id(self) -> int:
        return self.last_node_id if self.last_node_id is not None else self._initial_tail

    def resolve_character(self, name: str) -> tuple[str, str] | None:
        needle = name.strip().lower()
        for known, entity_id in self.characters.items():
            if known.lower() == needle:
                return known, entity_id
        matches = [(k, v) for k, v in self.characters.items() if needle and needle in k.lower()]
        return matches[0] if len(matches) == 1 else None

    # ── helpers ───────────────────────────────────────────────────────

    async def _reply(self, params: FunctionCallParams, result: dict[str, Any]) -> None:
        await params.result_callback(result)

    @staticmethod
    def _error(err: Exception) -> dict[str, Any]:
        if isinstance(err, KeyError):
            return {"error": f"missing required argument: {err.args[0]}"}
        return {"error": str(err)}

    async def _notify_changed(self, params: FunctionCallParams, action: str, **data: Any) -> None:
        # Tells the browser to refresh its story graph; RTVI's own
        # function-call events only carry the tool name, not what changed.
        try:
            await params.llm.push_frame(
                RTVIServerMessageFrame(data={"type": "loar_story_changed", "action": action, **data})
            )
        except Exception:  # best-effort UI hint; never fail the tool over it
            logger.warning("could not push story-changed message", exc_info=True)

    async def _story_action(self, kind: str, **payload: Any) -> dict[str, Any]:
        return await self.client.mutate(
            "director.executeStoryAction",
            {"universeId": self.universe_id, "kind": kind, **payload},
        )

    # ── read tools ────────────────────────────────────────────────────

    async def get_universe_context(self, params: FunctionCallParams) -> None:
        try:
            data = await self.client.query(
                "director.getContext",
                {"universeId": self.universe_id, "perspective": "director"},
            )
        except LoarError as err:
            return await self._reply(params, self._error(err))
        await self._reply(params, {"context": data["context"][:MAX_CONTEXT_CHARS]})

    async def get_canon(self, params: FunctionCallParams) -> None:
        try:
            data = await self.client.query(
                "director.getContext",
                {"universeId": self.universe_id, "perspective": "director"},
            )
        except LoarError as err:
            return await self._reply(params, self._error(err))
        lore = data["context"].split(CANON_SPLIT)[0]
        canon_nodes = [
            f"#{n['nodeId']} {n['title'] or 'Untitled'} — {n['plot'][:300]}"
            for n in data["nodes"]
            if n.get("canon")
        ]
        await self._reply(
            params,
            {"canon": lore[:MAX_CONTEXT_CHARS], "canon_story_nodes": canon_nodes},
        )

    async def get_character(self, params: FunctionCallParams) -> None:
        name = str(params.arguments.get("name", ""))
        resolved = self.resolve_character(name)
        if not resolved:
            return await self._reply(
                params,
                {"error": f"No unique character matches '{name}'", "known": list(self.characters)},
            )
        display, entity_id = resolved
        try:
            data = await self.client.query(
                "director.getContext",
                {"universeId": self.universe_id, "entityId": entity_id, "perspective": "director"},
            )
        except LoarError as err:
            return await self._reply(params, self._error(err))
        await self._reply(
            params, {"character": display, "context": data["context"][:MAX_CONTEXT_CHARS]}
        )

    # ── write tools ───────────────────────────────────────────────────

    async def create_story_node(self, params: FunctionCallParams) -> None:
        args = params.arguments
        parent = args.get("parent_node_id")
        parent = self.default_node_id if parent is None else int(parent)
        try:
            result = await self._story_action(
                "create_node",
                title=str(args.get("title", ""))[:200],
                description=str(args["content"])[:MAX_CONTENT_CHARS],
                previousNodeId=parent,
            )
        except (LoarError, KeyError) as err:
            return await self._reply(params, self._error(err))
        self.last_node_id = int(result["nodeId"])
        await self._notify_changed(params, "created", nodeId=self.last_node_id)
        await self._reply(
            params, {"ok": True, "node_id": self.last_node_id, "follows_node_id": parent}
        )

    async def create_story_branch(self, params: FunctionCallParams) -> None:
        args = params.arguments
        try:
            result = await self._story_action(
                "branch_story",
                title=str(args.get("title", ""))[:200],
                description=str(args["content"])[:MAX_CONTENT_CHARS],
                previousNodeId=int(args["parent_node_id"]),
            )
        except (LoarError, KeyError, ValueError) as err:
            return await self._reply(params, self._error(err))
        self.last_node_id = int(result["nodeId"])
        await self._notify_changed(params, "branched", nodeId=self.last_node_id)
        await self._reply(
            params,
            {"ok": True, "node_id": self.last_node_id, "branches_from_node_id": args["parent_node_id"]},
        )

    async def update_story_node(self, params: FunctionCallParams) -> None:
        args = params.arguments
        node_id = args.get("node_id")
        node_id = self.default_node_id if node_id is None else int(node_id)
        if node_id <= 0:
            return await self._reply(params, {"error": "There is no scene to update yet."})
        try:
            payload: dict[str, Any] = {
                "nodeId": node_id,
                "description": str(args["content"])[:MAX_CONTENT_CHARS],
            }
            if args.get("title"):
                payload["title"] = str(args["title"])[:200]
            await self._story_action("update_node", **payload)
        except (LoarError, KeyError) as err:
            return await self._reply(params, self._error(err))
        self.last_node_id = node_id
        await self._notify_changed(params, "updated", nodeId=node_id)
        await self._reply(params, {"ok": True, "node_id": node_id})

    async def generate_scene(self, params: FunctionCallParams) -> None:
        args = params.arguments
        prompt = str(args["scene_description"]).strip()
        if args.get("visual_direction"):
            prompt += f". Visual direction: {args['visual_direction']}"
        if args.get("characters"):
            prompt += f". Characters: {', '.join(map(str, args['characters']))}"
        try:
            result = await self._story_action("generate_scene", description=prompt[:MAX_CONTENT_CHARS])
        except (LoarError, KeyError) as err:
            return await self._reply(params, self._error(err))
        generation = result.get("generation") or {}
        await self._notify_changed(params, "generation_started")
        await self._reply(
            params,
            {
                "ok": True,
                "status": generation.get("status", "queued"),
                "generation_id": generation.get("generationId"),
                "note": "Video generation takes a while; it will appear in the universe when ready.",
            },
        )

    async def submit_canon_proposal(self, params: FunctionCallParams) -> None:
        args = params.arguments
        node_id = args.get("node_id")
        node_id = self.default_node_id if node_id is None else int(node_id)
        try:
            result = await self.client.mutate(
                "director.submitCanonProposal",
                {
                    "universeId": self.universe_id,
                    "nodeId": node_id,
                    "title": str(args["title"])[:200],
                    "description": str(args.get("description", ""))[:1500],
                },
            )
        except (LoarError, KeyError) as err:
            return await self._reply(params, self._error(err))
        await self._notify_changed(params, "proposal", nodeId=node_id, pollId=result["pollId"])
        await self._reply(
            params, {"ok": True, "poll_id": result["pollId"], "voting_ends": result["endsAt"]}
        )


def tool_schemas() -> ToolsSchema:
    str_ = {"type": "string"}
    int_ = {"type": "integer"}
    return ToolsSchema(
        standard_tools=[
            FunctionSchema(
                name="get_universe_context",
                description=(
                    "Get the universe overview: synopsis, characters, relationships and the full "
                    "story tree with node ids. Call this before any continuity-sensitive change."
                ),
                properties={},
                required=[],
            ),
            FunctionSchema(
                name="get_canon",
                description=(
                    "Get the established canon: lore, relationships, and the story nodes that are "
                    "marked canon. Use to check whether a requested change contradicts canon."
                ),
                properties={"topic": {**str_, "description": "What you're checking (optional)."}},
                required=[],
            ),
            FunctionSchema(
                name="get_character",
                description=(
                    "Look up one character: profile, relationships, what they know. Use their name."
                ),
                properties={"name": {**str_, "description": "Character name, e.g. 'Kira'."}},
                required=["name"],
            ),
            FunctionSchema(
                name="create_story_node",
                description=(
                    "Add a new scene that continues the story. Defaults to following the most "
                    "recent scene. Creative action — do it immediately, no confirmation needed."
                ),
                properties={
                    "title": {**str_, "description": "Short episode/scene title."},
                    "content": {**str_, "description": "The scene itself, 2-6 sentences of plot."},
                    "parent_node_id": {
                        **int_,
                        "description": "Node this follows. Omit to follow the latest scene.",
                    },
                },
                required=["title", "content"],
            ),
            FunctionSchema(
                name="create_story_branch",
                description=(
                    "Create an ALTERNATE timeline that forks from an existing node, leaving the "
                    "original continuation intact. Use for 'what if' / alternate-ending requests."
                ),
                properties={
                    "parent_node_id": {
                        **int_,
                        "description": "The node to fork from (the last shared moment).",
                    },
                    "title": {**str_, "description": "Short title for the alternate scene."},
                    "content": {**str_, "description": "The alternate scene, 2-6 sentences."},
                },
                required=["parent_node_id", "title", "content"],
            ),
            FunctionSchema(
                name="update_story_node",
                description=(
                    "Revise a scene in place. Provide the FULL revised scene text (not a diff). "
                    "Defaults to the scene most recently created or edited."
                ),
                properties={
                    "content": {**str_, "description": "The complete revised scene."},
                    "title": {**str_, "description": "New title (optional)."},
                    "node_id": {**int_, "description": "Node to revise. Omit for the latest."},
                },
                required=["content"],
            ),
            FunctionSchema(
                name="generate_scene",
                description=(
                    "Generate a video clip for a scene using LOAR's generation pipeline. "
                    "This spends credits — only call when the user asks to generate/render a shot."
                ),
                properties={
                    "scene_description": {**str_, "description": "What happens in the shot."},
                    "visual_direction": {**str_, "description": "Camera/lighting/style (optional)."},
                    "characters": {
                        "type": "array",
                        "items": str_,
                        "description": "Characters in the shot (optional).",
                    },
                },
                required=["scene_description"],
            ),
            FunctionSchema(
                name="submit_canon_proposal",
                description=(
                    "Open a community vote on whether a story node becomes canon. Defaults to the "
                    "scene most recently created or edited."
                ),
                properties={
                    "title": {**str_, "description": "Proposal title."},
                    "description": {**str_, "description": "Why this should be canon (optional)."},
                    "node_id": {**int_, "description": "Node to propose. Omit for the latest."},
                },
                required=["title"],
            ),
        ]
    )


def register_tools(llm: Any, session: DirectorSession) -> None:
    for name in (
        "get_universe_context",
        "get_canon",
        "get_character",
        "create_story_node",
        "create_story_branch",
        "update_story_node",
        "generate_scene",
        "submit_canon_proposal",
    ):
        llm.register_function(name, getattr(session, name))
