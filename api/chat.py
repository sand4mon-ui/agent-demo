"""Vercel serverless function backing the floating travel-agent chat widget.

Ports the system prompt and conversation behavior of agent-demo2.py's CLI
into a stateless HTTP endpoint: the client sends the full message history
each turn (same shape the CLI keeps in memory), and this function calls
Claude and returns the reply.
"""

from http.server import BaseHTTPRequestHandler
import json
import os

import anthropic

DEFAULT_MODEL = "claude-opus-4-8"
MAX_TOKENS = 4096

SYSTEM_PROMPT = """\
You are an experienced, friendly travel agent. A user will give you their \
trip preferences (origin, destination style, dates/duration, budget, group \
size, and interests). Using that information:

1. Suggest 2-4 specific destinations that fit the brief, with a one- or \
   two-sentence reason for each.
2. For the destination(s) most likely to be chosen, sketch a rough day-by-day \
   itinerary outline and note the best time of year to visit if relevant.
3. Give flight guidance: likely route/connections from their origin, roughly \
   how far in advance to book, typical price range for the dates given, and \
   which airlines or booking strategies tend to work well for that route. You \
   don't have live flight data, so be explicit that prices are ballpark and \
   the user should confirm on a booking site (Google Flights, airline sites, \
   etc.) before purchasing.
4. Flag any practical considerations: visas, weather, budget fit, or booking \
   lead time.

Keep the response well-organized with headers, but don't pad it — be concrete \
and specific rather than generic. After your initial plan, continue the \
conversation naturally, refining suggestions as the user gives feedback.
"""


def _cors_headers(handler: BaseHTTPRequestHandler) -> None:
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        _cors_headers(self)
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            messages = body.get("messages", [])
            if not isinstance(messages, list) or not messages:
                raise ValueError("messages must be a non-empty list")

            api_key = os.environ.get("ANTHROPIC_API_KEY", "")
            if not api_key:
                raise RuntimeError("ANTHROPIC_API_KEY is not configured on the server")

            client = anthropic.Anthropic(api_key=api_key)
            model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)

            response = client.messages.create(
                model=model,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=messages,
            )
            reply = next((b.text for b in response.content if b.type == "text"), "")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            _cors_headers(self)
            self.end_headers()
            self.wfile.write(json.dumps({"reply": reply}).encode("utf-8"))

        except anthropic.APIError as exc:
            self._send_error(502, f"Claude API error: {exc}")
        except Exception as exc:  # noqa: BLE001 - surface to the widget as an error message
            self._send_error(400, str(exc))

    def _send_error(self, status: int, message: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        _cors_headers(self)
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode("utf-8"))
