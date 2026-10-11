# SignCall

SignCall is a browser-based video calling app with experimental sign-language
interpretation. Participants can create or join a room, see and hear concise
AI replies to sampled signing, and use a site-wide help assistant.

## Features

- Video calls for up to five participants, powered by LiveKit.
- In-browser hand tracking and time-ordered camera-frame sampling.
- A Settings selector for Indian Sign Language (ISL), American Sign Language
  (ASL), and British Sign Language (BSL).
- One concise conversational reply to a signed phrase. The gesture flow does
  not display a separate sign transcript, facial-expression description, or
  Gemini model name.
- Typed messages, captions, optional text-to-speech, participant names, invite
  links, and transcript download.
- A floating AI help assistant available across the app.

**Sign-language interpretation is experimental.** The language selector guides
the Gemini prompt; it does not train the model or guarantee fluency, correct
translation, or support for regional variants and continuous signing. Sign
languages are distinct and are not universal. Do not rely on generated replies
for urgent, medical, legal, or other important communication. For meaningful
language support, involve fluent signers in design and evaluation.

## Project structure

```text
client/    React + Vite frontend
server/    Express + Socket.IO backend, LiveKit token endpoint, Gemini calls
render.yaml Render Blueprint for a combined web service
```

The browser never receives the Gemini or LiveKit API secret. Gemini requests
are made by the backend. LiveKit issues short-lived room tokens through the
backend.

## Requirements

- Node.js 22 (the Render Blueprint specifies Node 22.14.0) and npm.
- A Gemini API key for gesture replies and AI help chat.
- LiveKit project URL, API key, and API secret for video calls.

The website can start without LiveKit settings, but creating or joining a video
call requires valid LiveKit credentials. Keep API keys and secrets private. If
a credential was exposed in a screenshot or chat, revoke or rotate it before
using the deployment.

## Run locally on Windows

Open two PowerShell terminals. Run commands from the repository root,
`C:\Users\Aryan\Desktop\signspeak` (or the folder where you cloned this repo).
Install dependencies once:

```powershell
cd C:\Users\Aryan\Desktop\signspeak
npm install --prefix server
npm install --prefix client
```

### Terminal 1: backend

Set credentials in this terminal. Replace each placeholder locally; do not
paste real keys into source code, README files, screenshots, or chat.

```powershell
cd C:\Users\Aryan\Desktop\signspeak
$env:GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
$env:LIVEKIT_URL="wss://YOUR_PROJECT.livekit.cloud"
$env:LIVEKIT_API_KEY="YOUR_LIVEKIT_API_KEY"
$env:LIVEKIT_API_SECRET="YOUR_LIVEKIT_API_SECRET"
Remove-Item Env:GEMINI_MODEL -ErrorAction SilentlyContinue
npm run server
```

For sign replies and the help assistant only, `GEMINI_API_KEY` is required.
LiveKit variables are additionally required for video calls. Environment
variables set this way apply only to the current terminal session; set them
again after closing that terminal or restarting Windows.

### Terminal 2: frontend

```powershell
cd C:\Users\Aryan\Desktop\signspeak
npm run client
```

Open the local URL printed by Vite, usually `http://localhost:5173`. Keep both
terminals running while you use the app. Allow camera and microphone access.
For a second participant, open the same reachable website on another device and
join using the same room code or invite link. A `localhost` address is only
reachable on the computer running the frontend.

In a call, open **Settings → Sign language**, choose the language being signed,
and sign with your hands visible. Press **Finish & reply** or pause briefly for
automatic submission. Results may be wrong; repeat or type the message if the
reply is unclear.

## Run checks

From the repository root:

```powershell
npm --prefix server test
npm --prefix client test
npm --prefix client run build
```

To run the frontend linter:

```powershell
npm --prefix client run lint
```

## Deploy with Render

The repository includes a `render.yaml` Blueprint. It builds the client and
serves it from the Node backend as one web service.

1. Push the repository to your GitHub account.
2. In Render, choose **New → Blueprint** and connect this repository.
3. In the service's Environment settings, provide `GEMINI_API_KEY`,
   `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
4. Deploy the Blueprint and open the public URL Render provides.
5. Test sign replies, help chat, and a video call on the deployed URL.

Never commit production credentials. The Blueprint declares the credentials as
unsynced environment variables so they can be set privately in Render. Its free
instance may sleep while idle and take time to wake; video calling also depends
on a reachable LiveKit service.

## Privacy and limitations

Captured camera frames are sent to Gemini by the backend for interpretation.
Use this demo only with participants' knowledge and consent. It is not a
certified sign-language translator, may misinterpret signs, and has not been
validated as a dependable communication aid. Review important communication
with a qualified interpreter or another trusted method.
