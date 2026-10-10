import express from "express";
import http from "http";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { AccessToken, RoomConfiguration } from "livekit-server-sdk";
import cors from "cors";
import { interpretGestures, validateGestureFrames } from "./gestureAi.js";

const app = express();
const MAX_ROOM_PARTICIPANTS = 5;
app.use(cors());
app.use(express.json({ limit: "9mb" }));

app.post("/api/interpret-gestures", async (req, res) => {
  const validationError = validateGestureFrames(req.body?.frames);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const result = await interpretGestures({
      frames: req.body.frames,
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });
    res.json(result);
  } catch (error) {
    const status = error.message.includes("not configured") ? 503 : 502;
    console.error("Gesture AI request failed:", error.message);
    res.status(status).json({ error: error.message });
  }
});

app.post("/api/livekit/token", async (req, res) => {
  const { roomId } = req.body ?? {};
  if (typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) {
    res.status(400).json({ error: "A valid room code is required." });
    return;
  }

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    res.status(503).json({
      error: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.",
    });
    return;
  }

  let liveKitUrl;
  try {
    liveKitUrl = new URL(LIVEKIT_URL);
    if (liveKitUrl.protocol !== "ws:" && liveKitUrl.protocol !== "wss:") {
      throw new Error("LiveKit URL must use ws:// or wss://.");
    }
  } catch {
    res.status(503).json({
      error: "LIVEKIT_URL must be a valid ws:// or wss:// address.",
    });
    return;
  }

  try {
    const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: `signspeak-${randomUUID()}`,
      ttl: "10m",
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
    });
    accessToken.roomConfig = new RoomConfiguration({
      name: roomId,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
    });

    res.json({
      serverUrl: liveKitUrl.toString(),
      token: await accessToken.toJwt(),
    });
  } catch (error) {
    console.error("LiveKit token generation failed:", error);
    res.status(500).json({ error: "Could not create LiveKit room access." });
  }
});

const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), "../client/dist");
const clientIndex = resolve(clientDist, "index.html");
if (existsSync(clientIndex)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(clientIndex);
  });
} else {
  app.get("/", (req, res) => {
    res.send({ status: "SignSpeak signaling and LiveKit token server is running" });
  });
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Track which room each socket is in: socketId -> roomId
const socketToRoom = new Map();

io.on("connection", (socket) => {
  console.log(`[Socket Connected] ${socket.id}`);

  socket.on("join-room", ({ roomId }) => {
    if (!roomId) return;

    // Leave any previous room
    leaveCurrentRoom(socket);

    const room = io.sockets.adapter.rooms.get(roomId);
    const roomSize = room ? room.size : 0;

    if (roomSize >= MAX_ROOM_PARTICIPANTS) {
      socket.emit("room-full", { roomId });
      return;
    }

    socket.join(roomId);
    socketToRoom.set(socket.id, roomId);

    // Get the other user in the room if one exists
    let otherUserId = null;
    if (room && room.size > 0) {
      for (const id of room) {
        if (id !== socket.id) {
          otherUserId = id;
          break;
        }
      }
    }

    console.log(`[Join Room] ${socket.id} joined room "${roomId}" (Users: ${roomSize + 1})`);

    // Notify current user they joined successfully
    socket.emit("joined-room", { roomId, otherUser: otherUserId });

    // If an existing user was already in the room, tell them a peer arrived
    if (otherUserId) {
      socket.to(otherUserId).emit("user-joined", { socketId: socket.id });
    }
  });

  // Relay sign detection / live caption to room peer
  socket.on("sign-detected", ({ roomId, text }) => {
    if (roomId) {
      socket.to(roomId).emit("remote-sign-detected", { text });
    }
  });

  // Relay transcript messages to room peer
  socket.on("transcript-message", ({ roomId, message }) => {
    if (roomId) {
      socket.to(roomId).emit("remote-transcript-message", { message });
    }
  });

  // Explicit leave room
  socket.on("leave-room", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("disconnect", () => {
    console.log(`[Socket Disconnected] ${socket.id}`);
    leaveCurrentRoom(socket);
  });
});

function leaveCurrentRoom(socket) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) return;

  socket.leave(roomId);
  socketToRoom.delete(socket.id);

  // Notify other user in the room
  socket.to(roomId).emit("user-left", { socketId: socket.id });
  console.log(`[Leave Room] ${socket.id} left room "${roomId}"`);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`SignSpeak signaling server running on http://localhost:${PORT}`);
});
