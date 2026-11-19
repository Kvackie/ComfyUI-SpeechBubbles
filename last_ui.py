"""The latest page image each Speech Bubbles node received in this server session.

A node's editor opens on what the node last made, even when the run was cached (a cached node sends nothing
to the browser) or the browser restored an older copy of the workflow.
"""
from aiohttp import web
from server import PromptServer

LAST = {}  # (kind, node id) -> data


def remember(kind, unique_id, data):
    if unique_id is not None:
        LAST[(kind, str(unique_id))] = data


@PromptServer.instance.routes.get("/speech_bubbles/last/{kind}/{uid}")
async def get_last(request):
    data = LAST.get((request.match_info["kind"], request.match_info["uid"]))
    return web.json_response(data) if data is not None else web.Response(status=404)
