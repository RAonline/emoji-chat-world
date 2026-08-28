import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const MAX_PARTICIPANTS = 6;
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }] };

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type PeerInfo = { id: string; username: string; emoji: string; stream: MediaStream | null };

export function VideoCall({ channelId, onLeave }: { channelId: string; onLeave: () => void }) {
  const { user, profile } = useAuth();
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [ready, setReady] = useState(false);

  const localVideo = useRef<HTMLVideoElement | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const meRef = useRef<string>(user?.id ?? "");

  const me = user?.id ?? "";
  meRef.current = me;

  const send = useCallback((to: string, payload: SignalPayload) => {
    void channelRef.current?.send({
      type: "broadcast",
      event: "signal",
      payload: { from: meRef.current, to, ...payload },
    });
  }, []);

  const getPeer = useCallback(
    (otherId: string, initiator: boolean) => {
      const existing = pcs.current.get(otherId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE);
      pcs.current.set(otherId, pc);

      localStream.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStream.current as MediaStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) send(otherId, { kind: "ice", candidate: event.candidate.toJSON() });
      };
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        setPeers((prev) => ({
          ...prev,
          [otherId]: {
            id: otherId,
            username: prev[otherId]?.username ?? "guest",
            emoji: prev[otherId]?.emoji ?? "🙂",
            stream: stream ?? null,
          },
        }));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          pcs.current.delete(otherId);
        }
      };

      if (initiator) {
        void (async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send(otherId, { kind: "offer", sdp: offer });
        })();
      }

      return pc;
    },
    [send],
  );

  useEffect(() => {
    if (!me) return;
    let cancelled = false;

    const start = async () => {
      let stream: MediaStream;
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw new Error("insecure");
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch (error) {
        const name = (error as { name?: string; message?: string })?.name ?? "";
        if ((error as Error)?.message === "insecure") {
          toast.error("Camera needs a secure page — open the app in its own tab over https.");
        } else if (name === "NotAllowedError" || name === "SecurityError") {
          toast.error("Camera/mic permission was blocked. Allow access in your browser, then rejoin.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          toast.error("No camera or microphone found on this device.");
        } else if (name === "NotReadableError") {
          toast.error("Your camera is already in use by another app.");
        } else {
          toast.error("Camera or microphone unavailable");
        }
        onLeave();
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStream.current = stream;
      if (localVideo.current) localVideo.current.srcObject = stream;
      setReady(true);

      const channel = supabase.channel(`call:${channelId}`, {
        config: { presence: { key: me } },
      });
      channelRef.current = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ username: string; emoji: string }>();
        const ids = Object.keys(state).sort();
        if (ids.length > MAX_PARTICIPANTS && ids.indexOf(me) >= MAX_PARTICIPANTS) {
          toast.error(`Call is full (${MAX_PARTICIPANTS} people max)`);
          onLeave();
          return;
        }

        const others = ids.filter((id) => id !== me).slice(0, MAX_PARTICIPANTS);
        setPeers((prev) => {
          const next: Record<string, PeerInfo> = {};
          for (const id of others) {
            const meta = state[id]?.[0];
            next[id] = {
              id,
              username: meta?.username ?? "guest",
              emoji: meta?.emoji ?? "🙂",
              stream: prev[id]?.stream ?? null,
            };
          }
          return next;
        });

        for (const id of others) getPeer(id, me > id);
        for (const [id, pc] of pcs.current) {
          if (!others.includes(id)) {
            pc.close();
            pcs.current.delete(id);
          }
        }
      });

      channel.on<{ from: string; to: string } & SignalPayload>(
        "broadcast",
        { event: "signal" },
        async ({ payload }) => {
          if (!payload || payload.to !== me) return;
          const pc = getPeer(payload.from, false);
          try {
            if (payload.kind === "offer") {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              send(payload.from, { kind: "answer", sdp: answer });
            } else if (payload.kind === "answer") {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            } else if (payload.kind === "ice") {
              await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
            }
          } catch (error) {
            console.error("signal error", error);
          }
        },
      );

      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            username: profile?.username ?? "guest",
            emoji: profile?.emoji ?? "🙂",
          });
        }
      });
    };

    void start();

    return () => {
      cancelled = true;
      localStream.current?.getTracks().forEach((t) => t.stop());
      localStream.current = null;
      pcs.current.forEach((pc) => pc.close());
      pcs.current.clear();
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, me]);

  const toggleMic = () => {
    const track = localStream.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  };

  const toggleCam = () => {
    const track = localStream.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  };

  const peerList = useMemo(() => Object.values(peers), [peers]);
  const tileCols = peerList.length >= 3 ? "grid-cols-3" : peerList.length >= 1 ? "grid-cols-2" : "grid-cols-1";

  return (
    <section className="flex flex-1 flex-col bg-rail">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-semibold">Video call</h2>
          <p className="text-xs text-muted-foreground">
            {peerList.length + 1} / {MAX_PARTICIPANTS} in call
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onLeave}>
          <PhoneOff className="mr-1.5 h-4 w-4" /> Leave
        </Button>
      </header>

      <div className={`grid flex-1 gap-3 overflow-auto p-4 ${tileCols}`}>
        <Tile label={`${profile?.emoji ?? "🙂"} You`} muted stream={null} videoRef={localVideo} dim={!camOn} />
        {peerList.map((peer) => (
          <Tile
            key={peer.id}
            label={`${peer.emoji} ${peer.username}`}
            stream={peer.stream}
            connecting={!peer.stream}
          />
        ))}
        {!ready && (
          <p className="col-span-full text-center text-sm text-muted-foreground">
            Requesting camera access…
          </p>
        )}
      </div>

      <footer className="flex items-center justify-center gap-3 border-t border-border py-4">
        <Button variant={micOn ? "secondary" : "destructive"} size="icon" onClick={toggleMic} aria-label="Toggle microphone">
          {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </Button>
        <Button variant={camOn ? "secondary" : "destructive"} size="icon" onClick={toggleCam} aria-label="Toggle camera">
          {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </Button>
      </footer>
    </section>
  );
}

function Tile({
  label,
  stream,
  videoRef,
  muted,
  dim,
  connecting,
}: {
  label: string;
  stream: MediaStream | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  dim?: boolean;
  connecting?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const target = videoRef ?? ref;

  useEffect(() => {
    if (!videoRef && ref.current && stream) ref.current.srcObject = stream;
  }, [stream, videoRef]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-surface">
      <video
        ref={target}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${dim ? "opacity-20" : ""}`}
      />
      {connecting && (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          connecting…
        </span>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-rail/80 px-2 py-0.5 text-xs">{label}</span>
    </div>
  );
}
