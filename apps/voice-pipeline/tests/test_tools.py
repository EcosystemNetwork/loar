"""Tool handlers against a fake LOAR backend (httpx MockTransport).

These pin the contract with apps/server/src/routers/director/director.routes.ts:
which procedure each tool calls, the exact payload shape, and how results and
errors are handed back to the LLM.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from loar_client import LoarClient, LoarError
from tools import DirectorSession, primary_tail, tool_schemas

UNIVERSE = "0xuniverse"

NODES = [
    {"nodeId": 1, "previousNodeId": 0, "title": "Ep 1", "plot": "p1", "canon": True},
    {"nodeId": 2, "previousNodeId": 1, "title": "Ep 2", "plot": "p2", "canon": True},
    {"nodeId": 3, "previousNodeId": 2, "title": "Ep 3", "plot": "p3", "canon": True},
]
CHARACTERS = [
    {"id": "e-kira", "name": "Kira Voss"},
    {"id": "e-reyes", "name": "Commander Elias Reyes"},
]


class FakeLoar:
    """Records each request and answers from a {procedure: handler} map."""

    def __init__(self, handlers):
        self.handlers = handlers
        self.calls: list[tuple[str, str, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        procedure = request.url.path.removeprefix("/trpc/")
        if request.method == "GET":
            payload = json.loads(request.url.params["input"])["0"]
        else:
            payload = json.loads(request.content)["0"]
        self.calls.append((request.method, procedure, payload))
        outcome = self.handlers[procedure](payload)
        if isinstance(outcome, Exception):
            return httpx.Response(200, json=[{"error": {"message": str(outcome)}}])
        return httpx.Response(200, json=[{"result": {"data": outcome}}])


def make_session(handlers, nodes=NODES):
    fake = FakeLoar(handlers)
    client = LoarClient("https://loar.test", "loar_key", transport=httpx.MockTransport(fake))
    return DirectorSession(client, UNIVERSE, CHARACTERS, nodes), fake


def make_params(**arguments):
    return SimpleNamespace(
        arguments=arguments,
        result_callback=AsyncMock(),
        llm=SimpleNamespace(push_frame=AsyncMock()),
    )


def replied(params):
    return params.result_callback.await_args.args[0]


def notified(params):
    return params.llm.push_frame.await_args.args[0].data


# ── primary_tail ──────────────────────────────────────────────────────


def test_primary_tail_follows_the_earliest_child_not_alternate_branches():
    nodes = NODES + [
        {"nodeId": 4, "previousNodeId": 3},
        {"nodeId": 5, "previousNodeId": 3},  # alternate branch off 3
    ]
    assert primary_tail(nodes) == 4
    assert primary_tail([]) == 0


# ── create / branch / update ──────────────────────────────────────────


async def test_create_node_defaults_to_continuing_from_the_end_of_the_main_line():
    session, fake = make_session({"director.executeStoryAction": lambda p: {"kind": "create_node", "nodeId": 4}})
    params = make_params(title="Ep 4 — Static", content="Kira finds edited memories.")

    await session.create_story_node(params)

    _, procedure, payload = fake.calls[0]
    assert procedure == "director.executeStoryAction"
    assert payload == {
        "universeId": UNIVERSE,
        "kind": "create_node",
        "title": "Ep 4 — Static",
        "description": "Kira finds edited memories.",
        "previousNodeId": 3,
    }
    assert replied(params) == {"ok": True, "node_id": 4, "follows_node_id": 3}
    assert notified(params) == {"type": "loar_story_changed", "action": "created", "nodeId": 4}
    assert session.last_node_id == 4


async def test_update_targets_the_scene_just_created_when_no_id_is_given():
    session, fake = make_session(
        {
            "director.executeStoryAction": lambda p: {"kind": p["kind"], "nodeId": p.get("nodeId", 4)},
        }
    )
    await session.create_story_node(make_params(title="t", content="c"))
    params = make_params(content="Revised: she only finds evidence.")

    await session.update_story_node(params)

    payload = fake.calls[-1][2]
    assert payload["kind"] == "update_node" and payload["nodeId"] == 4
    assert payload["description"] == "Revised: she only finds evidence."
    assert "title" not in payload
    assert replied(params) == {"ok": True, "node_id": 4}


async def test_branch_forks_from_the_requested_parent_not_the_latest_node():
    session, fake = make_session({"director.executeStoryAction": lambda p: {"kind": "branch_story", "nodeId": 5}})
    params = make_params(parent_node_id=3, title="Alt", content="Kira joins the AI.")

    await session.create_story_branch(params)

    assert fake.calls[0][2]["kind"] == "branch_story"
    assert fake.calls[0][2]["previousNodeId"] == 3
    assert replied(params)["branches_from_node_id"] == 3
    assert notified(params)["action"] == "branched"


async def test_update_with_nothing_to_update_is_a_spoken_error_not_a_backend_call():
    session, fake = make_session({}, nodes=[])
    params = make_params(content="x")

    await session.update_story_node(params)

    assert "no scene to update" in replied(params)["error"].lower()
    assert fake.calls == []
    params.llm.push_frame.assert_not_awaited()


# ── error handling ────────────────────────────────────────────────────


async def test_backend_errors_become_tool_results_and_do_not_notify_the_ui():
    session, _ = make_session(
        {"director.executeStoryAction": lambda p: LoarError("Only the node creator can update it")}
    )
    params = make_params(content="x", node_id=2)

    await session.update_story_node(params)

    assert "Only the node creator" in replied(params)["error"]
    params.llm.push_frame.assert_not_awaited()
    assert session.last_node_id is None


async def test_missing_required_argument_is_named_clearly():
    session, fake = make_session({})
    params = make_params(title="no content given")

    await session.create_story_node(params)

    assert replied(params) == {"error": "missing required argument: content"}
    assert fake.calls == []


# ── read tools ────────────────────────────────────────────────────────


async def test_get_character_resolves_partial_names_and_uses_the_director_view():
    session, fake = make_session(
        {"director.getContext": lambda p: {"context": "Kira context", "nodes": [], "characters": []}}
    )
    params = make_params(name="kira")

    await session.get_character(params)

    method, procedure, payload = fake.calls[0]
    assert (method, procedure) == ("GET", "director.getContext")
    assert payload == {"universeId": UNIVERSE, "entityId": "e-kira", "perspective": "director"}
    assert replied(params) == {"character": "Kira Voss", "context": "Kira context"}


async def test_get_character_unknown_name_lists_who_exists():
    session, fake = make_session({})
    params = make_params(name="Zed")

    await session.get_character(params)

    assert replied(params)["known"] == ["Kira Voss", "Commander Elias Reyes"]
    assert fake.calls == []


async def test_get_canon_returns_lore_without_the_story_tree_plus_canon_nodes_only():
    context = "[UNIVERSE: M]\nlore text\n\n[STORY NODES]\n#1 Ep 1 — p1"
    nodes = NODES + [{"nodeId": 5, "previousNodeId": 3, "title": "Alt", "plot": "alt", "canon": False}]
    session, _ = make_session({"director.getContext": lambda p: {"context": context, "nodes": nodes}})
    params = make_params()

    await session.get_canon(params)

    result = replied(params)
    assert result["canon"] == "[UNIVERSE: M]\nlore text"
    assert len(result["canon_story_nodes"]) == 3
    assert all("Alt" not in n for n in result["canon_story_nodes"])


# ── generate / proposal ───────────────────────────────────────────────


async def test_generate_scene_composes_prompt_and_reports_status():
    session, fake = make_session(
        {"director.executeStoryAction": lambda p: {"kind": "generate_scene", "generation": {"status": "queued", "generationId": "g1"}}}
    )
    params = make_params(
        scene_description="Kira opens the vault door",
        visual_direction="cold blue light, handheld",
        characters=["Kira Voss"],
    )

    await session.generate_scene(params)

    payload = fake.calls[0][2]
    assert payload["kind"] == "generate_scene"
    assert payload["description"] == (
        "Kira opens the vault door. Visual direction: cold blue light, handheld. Characters: Kira Voss"
    )
    assert replied(params)["generation_id"] == "g1"


async def test_submit_canon_proposal_defaults_to_the_latest_scene():
    session, fake = make_session(
        {"director.submitCanonProposal": lambda p: {"pollId": "poll-1", "title": p["title"], "endsAt": "2026-09-22T00:00:00Z"}}
    )
    params = make_params(title="Make Kira's discovery canon")

    await session.submit_canon_proposal(params)

    assert fake.calls[0][2]["nodeId"] == 3
    assert replied(params) == {"ok": True, "poll_id": "poll-1", "voting_ends": "2026-09-22T00:00:00Z"}
    assert notified(params)["action"] == "proposal"


# ── client + schema ───────────────────────────────────────────────────


async def test_client_sends_bearer_auth_and_the_batch_envelope():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=[{"result": {"data": {"ok": 1}}}])

    client = LoarClient("https://loar.test/", "loar_secret", transport=httpx.MockTransport(handler))
    assert await client.mutate("director.x", {"a": 1}) == {"ok": 1}
    assert seen["auth"] == "Bearer loar_secret"
    assert seen["url"] == "https://loar.test/trpc/director.x?batch=1"
    assert seen["body"] == {"0": {"a": 1}}


async def test_client_raises_loar_error_with_the_server_message():
    client = LoarClient(
        "https://loar.test",
        "k",
        transport=httpx.MockTransport(
            lambda r: httpx.Response(401, json=[{"error": {"message": "UNAUTHORIZED"}}])
        ),
    )
    with pytest.raises(LoarError, match="UNAUTHORIZED"):
        await client.query("director.getContext", {})


def test_every_advertised_tool_has_a_handler_and_valid_required_fields():
    schemas = tool_schemas().standard_tools
    names = {s.name for s in schemas}
    assert names == {
        "get_universe_context", "get_canon", "get_character", "create_story_node",
        "create_story_branch", "update_story_node", "generate_scene", "submit_canon_proposal",
    }
    for schema in schemas:
        assert hasattr(DirectorSession, schema.name)
        assert set(schema.required) <= set(schema.properties)
