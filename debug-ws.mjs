import WebSocket from "ws";

const token = process.env.FLIPPER_TOKEN;
if (!token) { console.error("Set FLIPPER_TOKEN first"); process.exit(1); }

const ws = new WebSocket(`ws://localhost:52342/?token=${token}`, {
  headers: { Origin: "http://localhost:52342" },
});

let requestId = 0;

function send(command, args = []) {
  const id = ++requestId;
  const msg = JSON.stringify({ event: "exec", payload: { id, command, args } });
  console.log(`\n>>> SEND id=${id} command=${command}`);
  console.log(`    args: ${JSON.stringify(args).slice(0, 500)}`);
  ws.send(msg);
  return id;
}

const clientId = "Meli%E1-uat#Android#sdk_gphone16k_arm64 - 16 - API 36#emulator-5554";

ws.on("open", () => {
  console.log("Connected!\n");

  // Step 1: Init the Preferences plugin
  console.log("=== Step 1: Init Preferences plugin ===");
  send("client-request", [clientId, { method: "init", params: { plugin: "Preferences" } }]);

  // Step 2: Execute WITHOUT id — so response comes as client-message, not dropped
  setTimeout(() => {
    console.log("\n=== Step 2: Execute getAllSharedPreferences WITHOUT id ===");
    send("client-request", [clientId, {
      method: "execute",
      params: { api: "Preferences", method: "getAllSharedPreferences", params: {} }
      // NO id field!
    }]);
  }, 1500);

  // Close after waiting for response
  setTimeout(() => { console.log("\n\n--- Done ---"); ws.close(); process.exit(0); }, 8000);
});

ws.on("message", (raw) => {
  const json = JSON.parse(raw.toString());

  if (json.event === "server-event" && json.payload?.event === "device-log") return;
  if (json.event === "server-event" && json.payload?.event?.startsWith("connectivity-")) return;

  if (json.event === "server-event" && json.payload?.event === "client-message") {
    const inner = json.payload.data?.message;
    const preview = typeof inner === "string" ? inner.slice(0, 1500) : JSON.stringify(inner).slice(0, 1500);
    console.log(`\n<<< CLIENT-MESSAGE (${typeof inner === "string" ? inner.length : "?"} chars): ${preview}`);
    return;
  }

  if (json.event === "exec-response" || json.event === "exec-response-error") {
    console.log(`\n<<< ${json.event} id=${json.payload?.id}: ${JSON.stringify(json.payload).slice(0, 300)}`);
    return;
  }

  console.log(`\n<<< OTHER: event=${json.event} payload_event=${json.payload?.event}`);
});

ws.on("error", (e) => console.error("WS Error:", e.message));
