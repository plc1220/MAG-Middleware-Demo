# Astryx AI chat reference

Generated on 2026-11-01 with the requested command, pinned for reproducibility:

```sh
npx --yes @astryxdesign/cli@0.7.5 template ai-chat ./src/app/ai-chat
```

`page.tsx` is the original React reference template (Core 0.7.5), including its
illustrative content. It is not a deployed Next.js route in this repository.

The Cloud Run app uses native browser modules. Its production adaptation follows
the template's ChatLayout, message/avatar metadata, ghost assistant bubbles,
collapsible ChatToolCalls, review cards and anchored composer patterns:

- `cloudrun/public/app.js`, `chat.css`, `chat-format.js`, `chat-events.js`
- `cloudrun/chat-engine.js`, `chat-http.js`, `server.js`

The production chat uses actual Gemini streaming and actual Confluent MCP/BAYNO
operations. It contains no template sample conversations, pretend tool timings,
file attachment controls, version history or sharing controls.

Reference: https://astryx.atmeta.com/docs/cli
