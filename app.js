// Floating travel-agent chat widget.
// Mirrors agent-demo2.py's CLI flow: ask the same intake questions one at a
// time, build the same "trip brief" message, send it to Claude via
// /api/chat, then continue as free-form follow-up chat.

(() => {
  const QUESTIONS = [
    {
      key: "origin",
      label: "Departure city/airport",
      prompt: "First — what city or airport are you departing from?",
      fallback: "not specified",
    },
    {
      key: "destination",
      label: "Destination preference",
      prompt:
        "Where do you want to go? A specific place, a region, or a style " +
        "like beach / mountains / city / culture — or say \"surprise me\".",
      fallback: "open to suggestions",
    },
    {
      key: "duration",
      label: "Trip length",
      prompt: "How long is the trip? (e.g. \"7 days\", \"a long weekend\")",
      fallback: "not specified",
    },
    {
      key: "dates",
      label: "Travel dates",
      prompt:
        "Rough travel dates or month? (e.g. \"mid-March 2026\", or \"flexible\")",
      fallback: "flexible",
    },
    {
      key: "travelers",
      label: "Travelers",
      prompt: "Who's traveling? (e.g. \"2 adults\", \"family of 4 with kids\")",
      fallback: "not specified",
    },
    {
      key: "budget",
      label: "Budget",
      prompt: "What's the budget, total or level? (e.g. \"$3000 total\", \"mid-range\")",
      fallback: "not specified",
    },
    {
      key: "interests",
      label: "Interests",
      prompt:
        "Any interests or must-haves? (e.g. food, hiking, nightlife, relaxation, museums)",
      fallback: "not specified",
    },
    {
      key: "extra",
      label: "Additional notes",
      prompt:
        "Anything else I should know — dealbreakers, past trips, etc.? " +
        "(or just hit send to skip)",
      fallback: "",
    },
  ];

  const fab = document.getElementById("chat-fab");
  const win = document.getElementById("chat-window");
  const closeBtn = document.getElementById("chat-close");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const openButtons = [
    document.getElementById("open-chat-nav"),
    document.getElementById("open-chat-hero"),
  ];

  const state = {
    started: false,
    step: 0,
    answers: {},
    messages: [], // Anthropic-format history: [{role, content}]
    mode: "intake", // "intake" | "chat" | "busy"
  };

  function openChat() {
    win.classList.remove("hidden");
    input.focus();
    if (!state.started) {
      state.started = true;
      addBotMessage(
        "Hi! I'm your Waypoint travel agent. I'll ask a few quick questions, " +
          "then put together destination ideas, an itinerary, and flight guidance."
      );
      addBotMessage(QUESTIONS[0].prompt);
    }
  }

  function closeChat() {
    win.classList.add("hidden");
  }

  function addMessage(text, cls) {
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  const addBotMessage = (text) => addMessage(text, "msg-bot");
  const addUserMessage = (text) => addMessage(text, "msg-user");
  const addErrorMessage = (text) => addMessage(text, "msg-error");

  function showTyping() {
    const div = addMessage("Thinking…", "msg-typing");
    return div;
  }

  function buildTripBrief() {
    const a = state.answers;
    const lines = [
      `Departure city/airport: ${a.origin || QUESTIONS[0].fallback}`,
      `Destination preference: ${a.destination || QUESTIONS[1].fallback}`,
      `Trip length: ${a.duration || QUESTIONS[2].fallback}`,
      `Travel dates: ${a.dates || QUESTIONS[3].fallback}`,
      `Travelers: ${a.travelers || QUESTIONS[4].fallback}`,
      `Budget: ${a.budget || QUESTIONS[5].fallback}`,
      `Interests: ${a.interests || QUESTIONS[6].fallback}`,
    ];
    if (a.extra) {
      lines.push(`Additional notes: ${a.extra}`);
    }
    return "Here's my trip brief:\n" + lines.map((l) => `- ${l}`).join("\n");
  }

  async function callChatApi() {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data.reply;
  }

  async function sendAssistantTurn() {
    state.mode = "busy";
    const typingEl = showTyping();
    try {
      const reply = await callChatApi();
      typingEl.remove();
      addBotMessage(reply);
      state.messages.push({ role: "assistant", content: reply });
    } catch (err) {
      typingEl.remove();
      addErrorMessage(`Something went wrong: ${err.message}`);
      // Drop the last user turn so the history stays valid for a retry.
      state.messages.pop();
    } finally {
      state.mode = state.mode === "busy" ? "chat" : state.mode;
    }
  }

  async function handleIntakeAnswer(text) {
    const q = QUESTIONS[state.step];
    state.answers[q.key] = text;
    state.step += 1;

    if (state.step < QUESTIONS.length) {
      addBotMessage(QUESTIONS[state.step].prompt);
      return;
    }

    // All questions answered — build the brief and kick off the plan.
    const brief = buildTripBrief();
    state.messages.push({ role: "user", content: brief });
    addBotMessage("Great, let me put a plan together…");
    await sendAssistantTurn();
    state.mode = "chat";
  }

  async function handleChatMessage(text) {
    state.messages.push({ role: "user", content: text });
    await sendAssistantTurn();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.mode === "busy") return;

    const text = input.value.trim();
    input.value = "";

    if (state.mode === "intake") {
      const q = QUESTIONS[state.step];
      addUserMessage(text || (q.key === "extra" ? "(skipped)" : ""));
      await handleIntakeAnswer(text);
    } else if (state.mode === "chat") {
      if (!text) return;
      addUserMessage(text);
      await handleChatMessage(text);
    }
  });

  fab.addEventListener("click", openChat);
  closeBtn.addEventListener("click", closeChat);
  openButtons.forEach((btn) => btn && btn.addEventListener("click", openChat));
})();
