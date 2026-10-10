# SignSpeak

SignSpeak uses the Google Gemini vision API to interpret a time-ordered sample
of camera frames while you sign, create an English transcript, and generate a
relevant conversational reply. It does not gate interpretation on a hard-coded
list of gesture names: Gemini receives hand images directly and interprets the
sequence when you finish signing or pause. Up to 8 representative frames are
sampled across the whole phrase, including longer phrases, with timing retained
to provide movement context.

## Run locally

Get a Gemini API key and LiveKit project credentials, then run the backend and
frontend in two separate terminals. Both commands below must be run from the repository root
(`signspeak`), not from the `server` or `client` folder.
The server checks which Gemini models your API key can use and automatically
chooses an available model that supports `generateContent`, preferring the
recommended low-latency `gemini-3.5-flash-lite`. A `GEMINI_MODEL` setting is
used only if it appears in the available model list.

In the backend terminal, set your key for that terminal session and start the
server. Clear any old model override first so the app can choose a currently
working model:

```sh
export GEMINI_API_KEY="your-gemini-api-key"
export LIVEKIT_URL="wss://your-project.livekit.cloud"
export LIVEKIT_API_KEY="your-livekit-api-key"
export LIVEKIT_API_SECRET="your-livekit-api-secret"
unset GEMINI_MODEL
npm run server
```

In the frontend terminal:

```sh
npm run client
```

On Windows PowerShell, set the key with:

```sh
$env:GEMINI_API_KEY="your-gemini-api-key"
$env:LIVEKIT_URL="wss://your-project.livekit.cloud"
$env:LIVEKIT_API_KEY="your-livekit-api-key"
$env:LIVEKIT_API_SECRET="your-livekit-api-secret"
```

In PowerShell, clear an old model override before starting:

```powershell
Remove-Item Env:GEMINI_MODEL -ErrorAction SilentlyContinue
npm run server
```

Run these commands from the repository root in the same backend terminal.
Never put the key in client code or commit it to the repository.

Create a LiveKit Cloud project or configure a reachable self-hosted LiveKit
server. Set its WebSocket URL, API key, and API secret in the backend terminal
before starting the server. The backend issues short-lived room tokens; the API
secret must never be exposed in client code. Both participants must open the
same reachable SignSpeak frontend and use the same room invite link or code. A
`localhost` URL is only reachable from the machine running that frontend. For
deployment, the production client uses the same origin for its API and
Socket.IO connection; the LiveKit server must also be reachable by each
participant.
Rooms allow up to five total participants. Gesture phrases auto-submit after
about 0.65 seconds without a detected hand and send up to eight representative
frames to Gemini. The client samples clear, time-ordered frames to help the AI
distinguish movement (such as a wave) from a static hand pose.
If Gemini does not respond, the request now times out instead of remaining in
an interpreting state indefinitely; captured frames remain available for a
manual retry.
Before joining or creating a room, each participant enters a display name; the
name is shown on their participant tile, in the participant list, and alongside
their transcript entries. Gesture interpretation also reports visible facial
expression and apparent emotion cues (including angry-looking expressions)
when clear. The reply can use those cues for context without treating them as
certain knowledge of a person's feelings.

## Deploy publicly with Render

The repository includes a `render.yaml` Blueprint that builds the client and
serves it from the backend as one web service. To publish it:

1. Push this repository to GitHub. Do not commit API keys or secrets.
2. In Render, choose **New > Blueprint**, connect the repository, and deploy
   the `render.yaml` Blueprint.
3. In the service's **Environment** settings, set `LIVEKIT_URL`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `GEMINI_API_KEY`. Use a newly
   created LiveKit key if an old key or secret was exposed. Save changes and
   redeploy.
4. Open the public `https://...onrender.com` address Render provides. Create a
   room and send your friend the **Copy invite link** URL.

Both people need camera/microphone permission and an internet connection. The
included Blueprint uses Render's free instance, which may sleep when idle and
take a short time to wake up. LiveKit Cloud credentials are required for
audio/video calling.

Open the local URL printed by Vite and allow camera access. Keep your hands in
camera view while signing; choose **Finish & reply** or pause briefly to ask
Gemini for the transcript and response.

Gemini receives the captured camera frames for interpretation. This demo is
not certified sign-language translation and may misunderstand signs; general
vision models do not guarantee correct interpretation of every sign language,
region, or continuous sign sequence. Review transcripts before relying on them
for important communication.
