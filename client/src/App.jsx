import React, { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Copy,
  Check,
  Hand,
  Volume2,
  VolumeX,
  MessageSquare,
  Send,
  MoreHorizontal,
  Home,
  PhoneCall,
  Clock,
  Settings,
  ArrowLeft,
  Pin,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Sliders,
  X,
  Download,
  Users,
  Trash2,
} from "lucide-react";
import { drawHandLandmarks } from "./gestureDetector";
import {
  addGestureFrame,
  MAX_GESTURE_FRAMES,
  orderGestureFrames,
} from "./gestureFrames";
import "./App.css";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  (typeof window !== "undefined"
    ? import.meta.env.PROD
      ? window.location.origin
      : `${window.location.protocol}//${window.location.hostname}:5000`
    : "http://localhost:5000");

export default function App() {
  // Navigation & Room state
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(window.location.search).get("room")?.toLowerCase() || ""
  );
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connecting to server...");
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Call Controls
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [signMode, setSignMode] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [captionPx, setCaptionPx] = useState(28);
  const [showSettings, setShowSettings] = useState(false);
  const [pinMainUser, setPinMainUser] = useState("auto"); // "auto", "you", "peer"

  // Sign & Caption state
  const [liveGestureLabel, setLiveGestureLabel] = useState(null);
  const [typeInput, setTypeInput] = useState("");
  const [isInterpretingGestures, setIsInterpretingGestures] = useState(false);
  const [gestureFrameCount, setGestureFrameCount] = useState(0);
  const [latestGestureCaption, setLatestGestureCaption] = useState(null);

  // Live Transcript entries
  const [transcript, setTranscript] = useState([
    {
      id: "t-init",
      who: "SignCall",
      mode: "System",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      text: "Gemini gesture understanding is ready. Sign a phrase and finish it to get an AI transcript and reply.",
      bubbleBg: "#F4F5F7",
      textColor: "#6B7280",
    },
  ]);

  // Video streams
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  // Refs
  const socketRef = useRef(null);
  const liveKitRoomRef = useRef(null);
  const localStreamRef = useRef(null);
  const currentRoomRef = useRef(null);
  currentRoomRef.current = currentRoom;

  // DOM refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameCaptureCanvasRef = useRef(null);
  const transcriptEndRef = useRef(null);

  const noHandFramesRef = useRef(0);
  const gestureFramesRef = useRef([]);
  const gestureFrameSeenCountRef = useRef(0);
  const lastGestureCaptureRef = useRef(0);
  const gesturePhraseStartedAtRef = useRef(0);
  const isInterpretingGesturesRef = useRef(false);

  // Callback ref for local video
  const setLocalVideoNode = useCallback((node) => {
    localVideoRef.current = node;
    if (node && localStreamRef.current) {
      node.srcObject = localStreamRef.current;
      node.play().catch((err) => console.log("Local video autoplay caught:", err));
    }
  }, []);

  // Callback ref for remote video
  const setRemoteVideoNode = useCallback((node) => {
    remoteVideoRef.current = node;
    if (node && remoteStream) {
      node.srcObject = remoteStream;
      node.play().catch((err) => console.log("Remote video autoplay caught:", err));
    }
  }, [remoteStream]);

  // Scroll transcript to bottom
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcript]);

  // Text-To-Speech function
  const speakText = useCallback(
    (text) => {
      if (!voiceOn || !text || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        window.speechSynthesis.speak(utterance);
      } catch (err) {
        console.warn("SpeechSynthesis error:", err);
      }
    },
    [voiceOn]
  );
  const speakTextRef = useRef(speakText);

  useEffect(() => {
    speakTextRef.current = speakText;
  }, [speakText]);

  // Start local camera + microphone
  const startLocalMedia = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      return stream;
    } catch (err) {
      console.warn("Retrying video only...", err);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          localVideoRef.current.play().catch(() => {});
        }
        return stream;
      } catch (fallbackErr) {
        console.error("Camera access failed:", fallbackErr);
        setErrorMessage(
          "Camera access is needed for video calls and sign detection. Please grant browser permissions."
        );
        return null;
      }
    }
  };

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setLocalStream(null);
  }, []);

  const finalizeSignedSentence = useCallback(() => {
    if (isInterpretingGesturesRef.current) return;
    const frames = orderGestureFrames(gestureFramesRef.current);
    if (frames.length === 0) {
      setErrorMessage("No hand frames were captured. Keep your hand visible while signing, then try again.");
      return;
    }

    isInterpretingGesturesRef.current = true;
    setIsInterpretingGestures(true);
    setErrorMessage("");
    const seenCount = gestureFrameSeenCountRef.current;
    const lastCapturedAt = lastGestureCaptureRef.current;
    const phraseStartedAt = gesturePhraseStartedAtRef.current;
    gestureFramesRef.current = [];
    gestureFrameSeenCountRef.current = 0;
    setGestureFrameCount(0);
    lastGestureCaptureRef.current = 0;
    gesturePhraseStartedAtRef.current = 0;

    (async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/interpret-gestures`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ frames }),
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `Gesture AI request failed (${response.status}).`);
        }
        if (
          typeof result.transcript !== "string" ||
          typeof result.reply !== "string" ||
          !result.transcript.trim() ||
          !result.reply.trim()
        ) {
          throw new Error("Gesture AI returned an incomplete transcript or reply.");
        }

        const time = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const transcriptEntry = {
          id: `sign-${Date.now()}`,
          who: "You",
          mode: "AI Gesture Transcript",
          time,
          text: result.transcript.trim(),
          bubbleBg: "#EAF0FF",
          textColor: "#111827",
        };
        const aiEntry = {
          id: `ai-${Date.now()}`,
          who: `SignSpeak AI (${result.model})`,
          mode: "AI Response",
          time,
          text: result.reply.trim(),
          bubbleBg: "#F0EAFF",
          textColor: "#5B21B6",
          isAI: true,
        };

        setTranscript((prev) => [...prev, transcriptEntry, aiEntry]);
        setLatestGestureCaption({
          transcript: transcriptEntry.text,
          reply: aiEntry.text,
        });
        speakText(`Transcript: ${transcriptEntry.text}. ${aiEntry.text}`);

        if (socketRef.current && currentRoomRef.current) {
          for (const message of [transcriptEntry, aiEntry]) {
            socketRef.current.emit("transcript-message", {
              roomId: currentRoomRef.current,
              message,
            });
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not interpret the gesture. Please try again.";
        setErrorMessage(message);
        gestureFramesRef.current = frames;
        gestureFrameSeenCountRef.current = seenCount;
        setGestureFrameCount(frames.length);
        lastGestureCaptureRef.current = lastCapturedAt;
        gesturePhraseStartedAtRef.current = phraseStartedAt;
      } finally {
        isInterpretingGesturesRef.current = false;
        setIsInterpretingGestures(false);
      }
    })();
  }, [speakText]);

  // Sync video streams with elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, currentRoom]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteStream, currentRoom]);

  // =========================================================================
  // MediaPipe Hands Detection & Gesture Recognition Loop (Smoothed & Debounced)
  // =========================================================================
  useEffect(() => {
    if (!signMode || !localStream) return;

    let handsInstance = null;
    let isRunning = true;
    let pollTimer = null;
    let isSending = false;

    const initHands = () => {
      if (typeof window.Hands === "undefined") {
        pollTimer = setTimeout(initHands, 350);
        return;
      }

      try {
        handsInstance = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        handsInstance.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });

        handsInstance.onResults((results) => {
          if (!isRunning) return;

          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (isInterpretingGesturesRef.current) return;

          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            noHandFramesRef.current = 0;

            for (const landmarks of results.multiHandLandmarks) {
              drawHandLandmarks(ctx, landmarks, canvas.width, canvas.height);
            }

            const now = Date.now();
            const video = localVideoRef.current;
            if (now - lastGestureCaptureRef.current >= 600 && video?.videoWidth) {
              const captureCanvas =
                frameCaptureCanvasRef.current || document.createElement("canvas");
              frameCaptureCanvasRef.current = captureCanvas;
              const scale = Math.min(1, 384 / video.videoWidth);
              captureCanvas.width = Math.round(video.videoWidth * scale);
              captureCanvas.height = Math.round(video.videoHeight * scale);
              const captureContext = captureCanvas.getContext("2d");
              if (captureContext) {
                captureContext.drawImage(
                  video,
                  0,
                  0,
                  captureCanvas.width,
                  captureCanvas.height
                );
                const [, data] = captureCanvas
                  .toDataURL("image/jpeg", 0.42)
                  .split(",");
                if (data.length <= 400_000) {
                  if (gestureFramesRef.current.length === 0) {
                    gesturePhraseStartedAtRef.current = now;
                    setLatestGestureCaption(null);
                  }
                  const nextSample = addGestureFrame(
                    gestureFramesRef.current,
                    gestureFrameSeenCountRef.current,
                    {
                      mimeType: "image/jpeg",
                      data,
                      capturedAtMs: now - gesturePhraseStartedAtRef.current,
                    }
                  );
                  gestureFramesRef.current = nextSample.frames;
                  gestureFrameSeenCountRef.current = nextSample.seenCount;
                  lastGestureCaptureRef.current = now;
                  setGestureFrameCount(gestureFramesRef.current.length);
                } else {
                  setErrorMessage("A camera frame was too large to send. Move closer to the camera and try again.");
                }
              }
            }

            setLiveGestureLabel("Hand detected");
          } else {
            // No hand detected
            noHandFramesRef.current += 1;
            setLiveGestureLabel(null);

            // Auto-finalize the phrase after ~2.5s without a detected hand.
            if (
              noHandFramesRef.current === 30 &&
              gestureFramesRef.current.length > 0
            ) {
              finalizeSignedSentence();
            }
          }
        });

        // Frame pump (~12-14 FPS for responsive hand recognition)
        pollTimer = setInterval(async () => {
          if (!isRunning || !signMode || isSending) return;

          const video = localVideoRef.current;
          if (video && video.readyState >= 2 && !video.paused) {
            const canvas = canvasRef.current;
            if (canvas && video.videoWidth > 0) {
              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
              }
            }

            isSending = true;
            try {
              await handsInstance.send({ image: video });
            } catch (err) {
              // Frame dropped, ignore
            } finally {
              isSending = false;
            }
          }
        }, 85);
      } catch (err) {
        console.error("MediaPipe initialization error:", err);
      }
    };

    initHands();

    return () => {
      isRunning = false;
      if (pollTimer) clearInterval(pollTimer);
      if (handsInstance) {
        try {
          handsInstance.close();
        } catch (e) {}
      }
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };
  }, [signMode, localStream, currentRoom, speakText, finalizeSignedSentence]);

  const joinLiveKitRoom = useCallback(async (roomId) => {
    const [response, liveKitSdk] = await Promise.all([
      fetch(`${BACKEND_URL}/api/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      }),
      import("livekit-client"),
    ]);
    const credentials = await response.json();
    if (!response.ok) {
      throw new Error(credentials.error || `Could not join call (${response.status}).`);
    }
    if (!credentials.serverUrl || !credentials.token) {
      throw new Error("The server returned incomplete LiveKit credentials.");
    }

    const stream = localStreamRef.current;
    if (!stream) {
      throw new Error("Camera and microphone access is required to join a call.");
    }

    const { Room, RoomEvent, Track } = liveKitSdk;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    liveKitRoomRef.current = room;
    const syncRemoteMedia = () => {
      const tracks = [];
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.track) tracks.push(publication.track.mediaStreamTrack);
        }
      }
      setRemoteStream(tracks.length ? new MediaStream(tracks) : null);
    };

    room.on(RoomEvent.ParticipantConnected, () => {
      setPeerConnected(true);
      setStatusMessage("Peer joined. Connecting media...");
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      syncRemoteMedia();
      setPeerConnected(room.remoteParticipants.size > 0);
      if (room.remoteParticipants.size === 0) {
        setStatusMessage("Peer left. Waiting for someone to join...");
      }
    });
    room.on(RoomEvent.TrackSubscribed, () => {
      syncRemoteMedia();
      setPeerConnected(true);
      setStatusMessage("Connected with peer");
    });
    room.on(RoomEvent.TrackUnsubscribed, syncRemoteMedia);
    room.on(RoomEvent.Disconnected, () => {
      if (liveKitRoomRef.current === room) {
        liveKitRoomRef.current = null;
        setRemoteStream(null);
        setPeerConnected(false);
      }
    });

    try {
      await room.connect(credentials.serverUrl, credentials.token);
      for (const track of stream.getTracks()) {
        await room.localParticipant.publishTrack(track, {
          source: track.kind === "audio" ? Track.Source.Microphone : Track.Source.Camera,
        });
      }
      syncRemoteMedia();
      setPeerConnected(room.remoteParticipants.size > 0);
      setStatusMessage(
        room.remoteParticipants.size > 0 ? "Connected with peer" : "Waiting for peer..."
      );
    } catch (error) {
      await room.disconnect();
      if (liveKitRoomRef.current === room) liveKitRoomRef.current = null;
      throw error;
    }
  }, []);

  // =========================================================================
  // Socket.io room presence and LiveKit media connection
  // =========================================================================
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setStatusMessage("Signaling Connected");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setStatusMessage("Signaling Offline");
    });

    socket.on("room-full", ({ roomId }) => {
      setErrorMessage(`Room "${roomId}" is full (maximum 2 participants).`);
      setCurrentRoom(null);
    });

    socket.on("joined-room", async ({ roomId, otherUser }) => {
      setCurrentRoom(roomId);
      setErrorMessage("");
      setPeerConnected(Boolean(otherUser));
      setStatusMessage(otherUser ? "Connecting to peer..." : "Waiting for peer...");

      try {
        await joinLiveKitRoom(roomId);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not connect to the LiveKit room.";
        setErrorMessage(message);
        setStatusMessage("Call connection failed");
        liveKitRoomRef.current?.disconnect();
        liveKitRoomRef.current = null;
        stopLocalMedia();
        socket.emit("leave-room");
        setCurrentRoom(null);
      }
    });

    socket.on("user-left", () => {
      setStatusMessage("Peer left. Waiting for someone to join...");
      setPeerConnected(false);
      setRemoteStream(null);
    });

    // Remote sign gesture received
    socket.on("remote-sign-detected", ({ text }) => {
      setCurrentSigningWord(text);
      setCommittedSentence((prev) => (prev ? `${prev} ${text}` : text));
      speakTextRef.current(text);
    });

    // Remote transcript item received
    socket.on("remote-transcript-message", ({ message }) => {
      setTranscript((prev) => [
        ...prev,
        {
          ...message,
          who: "Peer",
          bubbleBg:
            message.mode === "Signed" ||
            message.mode === "Gesture transcript" ||
            message.mode === "AI Gesture Transcript"
              ? "#EAF0FF"
              : "#F4F5F7",
        },
      ]);
    });

    return () => {
      socket.disconnect();
    };
  }, [joinLiveKitRoom, stopLocalMedia]);

  // Join existing room
  const handleJoinRoom = async (e) => {
    if (e) e.preventDefault();
    const trimmed = roomId.trim().toLowerCase();
    if (!trimmed) {
      setErrorMessage("Please enter a room code.");
      return;
    }

    setErrorMessage("");
    setStatusMessage(`Joining room "${trimmed}"...`);
    if (!(await startLocalMedia())) return;

    if (socketRef.current) {
      socketRef.current.emit("join-room", { roomId: trimmed });
    }
  };

  // Create new instant room
  const handleCreateRoom = async () => {
    const randomCode = `sign-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    setRoomId(randomCode);
    setErrorMessage("");
    setStatusMessage(`Creating room "${randomCode}"...`);
    if (!(await startLocalMedia())) return;

    if (socketRef.current) {
      socketRef.current.emit("join-room", { roomId: randomCode });
    }
  };

  // Leave room
  const handleLeaveRoom = () => {
    if (socketRef.current) {
      socketRef.current.emit("leave-room");
    }
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    stopLocalMedia();
    setRemoteStream(null);
    setCurrentRoom(null);
    setPeerConnected(false);
    setIsMicMuted(false);
    setIsVideoOff(false);
    setLiveGestureLabel(null);
    gestureFramesRef.current = [];
    gestureFrameSeenCountRef.current = 0;
    setGestureFrameCount(0);
    lastGestureCaptureRef.current = 0;
    gesturePhraseStartedAtRef.current = 0;
    setStatusMessage("Ready to connect");
  };

  // Copy code
  const handleCopyCode = () => {
    if (currentRoom) {
      const inviteUrl = new URL(window.location.href);
      inviteUrl.searchParams.set("room", currentRoom);
      navigator.clipboard.writeText(inviteUrl.toString()).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch((error) => {
        console.error("Could not copy the room invite:", error);
        setErrorMessage("Could not copy the invite link. Please copy the room code instead.");
      });
    }
  };

  // Controls
  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMicMuted(!isMicMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleSign = () => {
    setSignMode(!signMode);
  };

  const toggleCaptions = () => {
    setCaptionsOn(!captionsOn);
  };

  const toggleVoice = () => {
    setVoiceOn(!voiceOn);
  };

  const togglePin = () => {
    if (pinMainUser === "you") {
      setPinMainUser("peer");
    } else {
      setPinMainUser("you");
    }
  };

  const handleClearGestureFrames = () => {
    gestureFramesRef.current = [];
    gestureFrameSeenCountRef.current = 0;
    setGestureFrameCount(0);
    lastGestureCaptureRef.current = 0;
    gesturePhraseStartedAtRef.current = 0;
  };

  // Send a typed message
  const handleSendTypedMessage = (e) => {
    e.preventDefault();
    const text = typeInput.trim();
    if (!text) return;

    const timeStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const newEntry = {
      id: `type-${Date.now()}`,
      who: "You",
      mode: "Typed",
      time: timeStr,
      text: text,
      bubbleBg: "#F4F5F7",
      textColor: "#111827",
    };

    setTranscript((prev) => [...prev, newEntry]);
    setTypeInput("");
    if (socketRef.current && currentRoom) {
      socketRef.current.emit("transcript-message", {
        roomId: currentRoom,
        message: newEntry,
      });
    }

    speakText(text);
  };

  // Download Transcript as text
  const handleDownloadTranscript = () => {
    const textContent = transcript
      .map((t) => `[${t.time}] ${t.who} (${t.mode}): ${t.text}`)
      .join("\n");
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `SignCall-Transcript-${currentRoom || "call"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Determine whether to show You or Peer in the main stage
  const isYouOnMainStage =
    pinMainUser === "you" || !remoteStream || !peerConnected;

  return (
    <div className="sc-app-wrapper">
      {/* ====================================================================
          1. SLIM LEFT ICON RAIL
          ==================================================================== */}
      <nav className="sc-rail" aria-label="App Navigation">
        <div className="sc-rail-logo" title="SignCall">
          <Hand className="sc-rail-logo-icon" />
        </div>

        <div className="sc-rail-items">
          <button
            type="button"
            aria-label="Home"
            onClick={() => !currentRoom && window.location.reload()}
            className="sc-rail-btn"
            title="Home"
          >
            <Home className="sc-icon" />
          </button>

          <button
            type="button"
            aria-label="Calls"
            aria-current="page"
            className="sc-rail-btn active"
            title="Calls"
          >
            <PhoneCall className="sc-icon" />
          </button>

          <button
            type="button"
            aria-label="History"
            onClick={handleDownloadTranscript}
            className="sc-rail-btn"
            title="Transcript History"
          >
            <Clock className="sc-icon" />
          </button>

          <button
            type="button"
            aria-label="Settings"
            onClick={() => setShowSettings(!showSettings)}
            className={`sc-rail-btn ${showSettings ? "active" : ""}`}
            title="Settings & Accessibility"
          >
            <Settings className="sc-icon" />
          </button>
        </div>
      </nav>

      {/* Settings Modal */}
      {showSettings && (
        <div className="sc-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="sc-settings-card" onClick={(e) => e.stopPropagation()}>
            <div className="sc-settings-header">
              <div className="sc-settings-title-wrap">
                <Sliders className="sc-icon-sm" />
                <h3>Accessibility & Call Tweaks</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="sc-btn-close"
              >
                <X className="sc-icon-sm" />
              </button>
            </div>

            <div className="sc-settings-body">
              <div className="sc-setting-row">
                <div>
                  <label className="sc-setting-label">Caption Font Size</label>
                  <p className="sc-setting-hint">Adjust live caption readability (22px - 44px)</p>
                </div>
                <div className="sc-slider-group">
                  <input
                    type="range"
                    min="22"
                    max="44"
                    step="1"
                    value={captionPx}
                    onChange={(e) => setCaptionPx(Number(e.target.value))}
                    className="sc-range-slider"
                  />
                  <span className="sc-range-value">{captionPx}px</span>
                </div>
              </div>

              <div className="sc-setting-row">
                <div>
                  <label className="sc-setting-label">Read Aloud Voice</label>
                  <p className="sc-setting-hint">Read Gemini's interpreted gesture replies aloud</p>
                </div>
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`sc-toggle-pill ${voiceOn ? "active" : ""}`}
                >
                  {voiceOn ? "Enabled" : "Muted"}
                </button>
              </div>

              <div className="sc-setting-row">
                <div>
                  <label className="sc-setting-label">Sign Detection</label>
                  <p className="sc-setting-hint">MediaPipe hand tracking and gesture decoding</p>
                </div>
                <button
                  type="button"
                  onClick={toggleSign}
                  className={`sc-toggle-pill ${signMode ? "active" : ""}`}
                >
                  {signMode ? "Active" : "Paused"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          2. MAIN CONTENT AREA
          ==================================================================== */}
      <div className="sc-main-split">
        {!currentRoom ? (
          /* ================================================================
             LANDING / LOBBY PAGE
             ================================================================ */
          <div className="sc-landing-card">
            <header className="sc-landing-header">
              <div className="sc-landing-brand">
                <div className="sc-pill-logo">
                  <Hand className="sc-pill-icon" />
                </div>
                <div>
                  <h1 className="sc-landing-title">SignCall</h1>
                  <p className="sc-landing-sub">Accessible Video Calls with Sign Language Mode</p>
                </div>
              </div>

              <div className="sc-status-pill">
                <span className={`sc-dot ${isConnected ? "online" : "offline"}`} />
                <span>{isConnected ? "Signaling Ready" : "Connecting..."}</span>
              </div>
            </header>

            {errorMessage && (
              <div className="sc-alert-error">
                <span>⚠️ {errorMessage}</span>
                <button type="button" onClick={() => setErrorMessage("")}>✕</button>
              </div>
            )}

            <div className="sc-hero-content">
              <div className="sc-badge-tag">
                <Sparkles className="sc-icon-xs text-blue" />
                <span>Gemini AI Gesture Understanding & Voice Replies</span>
              </div>

              <h2 className="sc-hero-headline">
                Your hands. <span className="sc-blue-text">Their ears.</span>
              </h2>

              <p className="sc-hero-desc">
                A seamless Google Meet-style call experience designed for the deaf and non-verbal.
                Your hand signs are detected live in your browser, converted to high-contrast captions,
                and voiced aloud so everyone in the call understands effortlessly.
              </p>

              {/* Action Form */}
              <div className="sc-action-box">
                <div className="sc-action-row">
                  <button
                    type="button"
                    onClick={handleCreateRoom}
                    disabled={!isConnected}
                    className="sc-btn-primary"
                  >
                    <span>Create Room</span>
                    <ArrowRight className="sc-icon-sm" />
                  </button>

                  <span className="sc-divider-text">or join existing</span>

                  <form onSubmit={handleJoinRoom} className="sc-join-form">
                    <input
                      type="text"
                      placeholder="e.g. hack-sign-42"
                      value={roomId}
                      onChange={(e) => setRoomId(e.target.value.toLowerCase())}
                      className="sc-input-code"
                    />
                    <button
                      type="submit"
                      disabled={!isConnected || !roomId.trim()}
                      className="sc-btn-secondary"
                    >
                      Join Room
                    </button>
                  </form>
                </div>

                <div className="sc-secure-note">
                  <ShieldCheck className="sc-icon-xs" />
                  <span>LiveKit video calls. Share your room code to invite one other person.</span>
                </div>
              </div>

              {/* 3 Steps */}
              <div className="sc-steps-trio">
                <div className="sc-step-box">
                  <div className="sc-step-num">01</div>
                  <h4>Sign</h4>
                  <p>MediaPipe tracks 21 hand landmarks per frame directly on your device.</p>
                </div>
                <div className="sc-step-box">
                  <div className="sc-step-num">02</div>
                  <h4>Text</h4>
                  <p>Gemini interprets sampled camera frames and creates a readable transcript.</p>
                </div>
                <div className="sc-step-box">
                  <div className="sc-step-num">03</div>
                  <h4>Speech</h4>
                  <p>The integrated Web Speech API reads messages aloud to your partner.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ================================================================
             IN-CALL SCREEN (REAL 2-PERSON PARTICIPANTS)
             ================================================================ */
          <>
            {/* Main Center Call Section */}
            <main className="sc-call-panel">
              {errorMessage && (
                <div className="sc-alert-error" role="alert">
                  <span>{errorMessage}</span>
                  <button type="button" onClick={() => setErrorMessage("")} aria-label="Dismiss error">
                    <X className="sc-icon-xs" />
                  </button>
                </div>
              )}

              {/* Header Bar */}
              <header className="sc-call-header">
                <button
                  type="button"
                  aria-label="Back to home"
                  onClick={handleLeaveRoom}
                  className="sc-btn-circle-white"
                  title="Leave / Back"
                >
                  <ArrowLeft className="sc-icon" />
                </button>

                <div className="sc-header-meta">
                  <div className="sc-header-title-row">
                    <h1 className="sc-room-heading">SignCall Meeting</h1>
                    {signMode && (
                      <span className="sc-sign-pill">
                        <Hand className="sc-sign-pill-icon" />
                        Gemini AI on
                      </span>
                    )}
                  </div>
                  <span className="sc-room-sub">
                    Room {currentRoom} · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="sc-btn-invite"
                >
                  {copied ? (
                    <>
                      <Check className="sc-icon-sm text-blue" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="sc-icon-sm" />
                      <span>Copy invite link</span>
                    </>
                  )}
                </button>
              </header>

              {/* Large Main Stage View */}
              <div className="sc-speaker-viewport">
                {/* 
                  When you are alone or pinned: your live camera is front and center!
                  When peer is present and you haven't pinned yourself: peer's video is on the main stage.
                */}
                {isYouOnMainStage ? (
                  <div className="sc-main-stage-wrapper">
                    <video
                      ref={setLocalVideoNode}
                      autoPlay
                      playsInline
                      muted
                      className={`sc-video-fullscreen sc-mirror ${isVideoOff ? "hidden" : ""}`}
                    />
                    <canvas ref={canvasRef} className="sc-landmark-canvas" />

                    {isVideoOff && (
                      <div className="sc-cam-off-avatar">
                        <span>You</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="sc-main-stage-wrapper">
                    <video
                      ref={setRemoteVideoNode}
                      autoPlay
                      playsInline
                      className="sc-video-fullscreen"
                    />
                  </div>
                )}

                {/* Top overlay badges */}
                <div className="sc-speaker-badges">
                  <span className="sc-badge-dark">
                    {isYouOnMainStage ? "You" : "Peer"}
                  </span>
                  {signMode && (
                    <span className="sc-badge-blue">
                      <Hand className="sc-badge-icon" />
                      Signing
                    </span>
                  )}
                  {liveGestureLabel && isYouOnMainStage && (
                    <span className="sc-badge-gesture">
                      {liveGestureLabel}
                    </span>
                  )}
                </div>

                {/* Pin toggle button */}
                {peerConnected && (
                  <button
                    type="button"
                    aria-label="Pin video"
                    onClick={togglePin}
                    className="sc-btn-pin"
                    title={isYouOnMainStage ? "Switch to Peer" : "Switch to You"}
                  >
                    <Pin className="sc-icon-sm" />
                  </button>
                )}

                {/* Floating White Caption Card */}
                {captionsOn && (
                  <div className="sc-captions-overlay">
                    <div
                      role="status"
                      aria-live="polite"
                      className="sc-captions-card"
                    >
                      <div className="sc-captions-card-top">
                        <span className="sc-captions-label">
                          {isYouOnMainStage ? "You, signing" : "Peer, signing"}
                          {isInterpretingGestures
                            ? " · Gemini is interpreting the gesture sequence..."
                            : ` · ${gestureFrameCount} of ${MAX_GESTURE_FRAMES} representative frames captured for Gemini`}
                        </span>
                        <div className="sc-captions-card-actions">
                          {gestureFrameCount > 0 && (
                            <button
                              type="button"
                              onClick={handleClearGestureFrames}
                              className="sc-btn-caption-tool"
                              title="Discard captured gesture frames"
                            >
                              <Trash2 className="sc-icon-xs" />
                              <span>Clear</span>
                            </button>
                          )}
                          {(gestureFrameCount > 0 || isInterpretingGestures) && (
                            <button
                              type="button"
                              onClick={finalizeSignedSentence}
                              className="sc-btn-caption-tool"
                              title="Finish signing and ask Gemini to interpret the camera frames"
                              disabled={isInterpretingGestures}
                            >
                              <Sparkles className="sc-icon-xs" />
                              <span>{isInterpretingGestures ? "Interpreting..." : "Finish & reply"}</span>
                            </button>
                          )}
                        </div>
                      </div>

                      <p
                        className="sc-captions-text"
                        style={{ fontSize: `${captionPx}px` }}
                      >
                        {isInterpretingGestures ? (
                          <span className="sc-signing-live-word">
                            Gemini is interpreting your signed message...
                          </span>
                        ) : latestGestureCaption ? (
                          <>
                            <span className="sc-signing-live-word">
                              {latestGestureCaption.transcript}
                            </span>
                            <span className="sc-caption-reply">
                              {latestGestureCaption.reply}
                            </span>
                          </>
                        ) : gestureFrameCount > 0 ? (
                          <span className="sc-signing-live-word">
                            Gesture sequence captured. Finish or pause for Gemini to transcribe it.
                          </span>
                        ) : (
                          <span className="sc-signing-empty">
                            Sign naturally in view of the camera. Gemini interprets the sequence, not a fixed sign list...
                          </span>
                        )}
                        <span className="sc-caret" />
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Real 2-Person Filmstrip */}
              <div className="sc-strip">
                {isYouOnMainStage ? (
                  peerConnected && remoteStream ? (
                    <div className="sc-strip-tile tile-peer" onClick={togglePin}>
                      <video
                        ref={setRemoteVideoNode}
                        autoPlay
                        playsInline
                        className="sc-video-thumb"
                      />
                      <span className="sc-tile-name">Peer</span>
                    </div>
                  ) : (
                    <div className="sc-strip-tile tile-waiting">
                      <div className="sc-waiting-card">
                        <Users className="sc-icon text-blue" />
                        <div>
                          <p className="sc-waiting-title">Waiting for peer to join...</p>
                          <p className="sc-waiting-code">
                            Share room code <strong>{currentRoom}</strong>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="sc-btn-copy-mini"
                        >
                          {copied ? "✓ Copied" : "Copy Code"}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="sc-strip-tile tile-you" onClick={togglePin}>
                    <video
                      ref={setLocalVideoNode}
                      autoPlay
                      playsInline
                      muted
                      className={`sc-video-thumb sc-mirror ${isVideoOff ? "hidden" : ""}`}
                    />
                    <span className="sc-tile-name">You</span>
                    {liveGestureLabel && (
                      <span className="sc-tile-detected-badge">
                        {liveGestureLabel}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Call Controls Toolbar */}
              <div role="toolbar" aria-label="Call controls" className="sc-toolbar">
                {/* Microphone Toggle */}
                <button
                  type="button"
                  aria-label="Microphone"
                  title={isMicMuted ? "Unmute microphone" : "Mute microphone"}
                  aria-pressed={isMicMuted}
                  onClick={toggleMic}
                  className={`sc-tool-btn ${isMicMuted ? "danger" : "neutral"}`}
                >
                  {isMicMuted ? <MicOff className="sc-icon" /> : <Mic className="sc-icon" />}
                </button>

                {/* Camera Toggle */}
                <button
                  type="button"
                  aria-label="Camera"
                  title={isVideoOff ? "Turn camera on" : "Turn camera off"}
                  aria-pressed={isVideoOff}
                  onClick={toggleVideo}
                  className={`sc-tool-btn ${isVideoOff ? "danger" : "neutral"}`}
                >
                  {isVideoOff ? <VideoOff className="sc-icon" /> : <Video className="sc-icon" />}
                </button>

                {/* Sign Mode Toggle Pill */}
                <button
                  type="button"
                  aria-pressed={signMode}
                  onClick={toggleSign}
                  className={`sc-sign-mode-btn ${signMode ? "active" : "inactive"}`}
                >
                  <Hand className="sc-icon-sm" />
                  <span>{signMode ? "Sign mode on" : "Sign mode"}</span>
                </button>

                {/* Coral Leave Call Button */}
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="sc-btn-leave"
                >
                  Leave call
                </button>

                {/* Captions Toggle */}
                <button
                  type="button"
                  aria-label="Captions"
                  title="Captions"
                  aria-pressed={captionsOn}
                  onClick={toggleCaptions}
                  className={`sc-tool-btn ${captionsOn ? "active" : "neutral"}`}
                >
                  <MessageSquare className="sc-icon" />
                </button>

                {/* Read Aloud Voice Toggle */}
                <button
                  type="button"
                  aria-label="Read captions aloud"
                  title="Voice"
                  aria-pressed={voiceOn}
                  onClick={toggleVoice}
                  className={`sc-tool-btn ${voiceOn ? "active" : "neutral"}`}
                >
                  {voiceOn ? <Volume2 className="sc-icon" /> : <VolumeX className="sc-icon" />}
                </button>

                {/* More Options / Settings */}
                <button
                  type="button"
                  aria-label="More options"
                  onClick={() => setShowSettings(!showSettings)}
                  className="sc-tool-btn neutral"
                  title="More options"
                >
                  <MoreHorizontal className="sc-icon" />
                </button>
              </div>
            </main>

            {/* Right Sidebar: Real Participants & Live Transcript */}
            <aside className="sc-sidebar" aria-label="Meeting Details">
              {/* Real Participants Section */}
              <section aria-labelledby="sc-people" className="sc-people-section">
                <div className="sc-section-header">
                  <h2 id="sc-people" className="sc-section-title">Participants</h2>
                  <span className="sc-badge-count">
                    {peerConnected ? "2" : "1"}
                  </span>
                </div>

                <ul className="sc-people-list">
                  {/* You (Always Present) */}
                  <li className="sc-person-item active-user">
                    <span className="sc-person-avatar avatar-you">Y</span>
                    <span className="sc-person-name">You</span>
                    <span className="sc-person-status text-blue">
                      {isMicMuted ? "Muted" : signMode ? "Signing" : "Active"}
                    </span>
                  </li>

                  {/* Peer: Only when connected, otherwise waiting state */}
                  {peerConnected ? (
                    <li className="sc-person-item">
                      <span className="sc-person-avatar avatar-peer">P</span>
                      <span className="sc-person-name">Peer</span>
                      <span className="sc-person-status text-blue">Connected</span>
                    </li>
                  ) : (
                    <li className="sc-person-item waiting-row">
                      <span className="sc-person-avatar avatar-waiting">⏳</span>
                      <div className="sc-waiting-person-text">
                        <span className="sc-person-name text-muted">Waiting for peer...</span>
                        <span className="sc-room-hint">Room: {currentRoom}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className="sc-btn-copy-inline"
                        title="Copy Room Code"
                      >
                        {copied ? "✓ Copied" : "Copy"}
                      </button>
                    </li>
                  )}
                </ul>
              </section>

              {/* Transcript Section */}
              <section aria-labelledby="sc-transcript" className="sc-transcript-section">
                <div className="sc-transcript-header">
                  <h2 id="sc-transcript" className="sc-section-title">Transcript</h2>
                  <button
                    type="button"
                    onClick={handleDownloadTranscript}
                    className="sc-link-download"
                  >
                    <Download className="sc-icon-xs" />
                    <span>Download</span>
                  </button>
                </div>

                <ol className="sc-transcript-feed">
                  {transcript.map((item) => (
                    <li key={item.id} className="sc-transcript-entry">
                      <span className="sc-transcript-meta">
                        {item.who} · {item.mode} · {item.time}
                      </span>
                      <p
                        className="sc-transcript-bubble"
                        style={{
                          background: item.bubbleBg,
                          color: item.textColor,
                        }}
                      >
                        {item.text}
                      </p>
                    </li>
                  ))}
                  <div ref={transcriptEndRef} />
                </ol>
              </section>

              {/* Type Instead of Signing Input Bar */}
              <form onSubmit={handleSendTypedMessage} className="sc-type-bar">
                <label htmlFor="sc-type" className="sr-only">
                  Type a message instead of signing
                </label>
                <input
                  id="sc-type"
                  type="text"
                  placeholder="Type instead of signing…"
                  value={typeInput}
                  onChange={(e) => setTypeInput(e.target.value)}
                  className="sc-type-input"
                />
                <button
                  type="submit"
                  aria-label="Send message"
                  className="sc-btn-send"
                  disabled={!typeInput.trim()}
                >
                  <Send className="sc-icon-sm" />
                </button>
              </form>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
