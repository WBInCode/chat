import type { AppSocket } from "./socket.js";

/**
 * Zero-cost WebRTC P2P mesh manager (F5-E). Each participant opens one
 * RTCPeerConnection per remote peer (mesh topology) — deliberately capped
 * at 4 participants total (see MAX_VOICE_PARTICIPANTS server-side) since a
 * mesh's connection count grows O(n^2) and a paid SFU is out of scope for
 * a 100%-free-tier deployment. Signaling rides the existing Socket.IO
 * connection; STUN is Google's free public server; TURN is optional (env
 * on the client if ever added) and simply omitted when unset — calls will
 * still work for the common NAT cases, just not symmetric-NAT-behind-symmetric-NAT.
 */

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface VoicePeer {
  userId: string;
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  speaking: boolean;
}

export interface VoiceRoomHandlers {
  onPeerStream?: (userId: string, stream: MediaStream) => void;
  onPeerSpeaking?: (userId: string, speaking: boolean) => void;
  onPeerLeft?: (userId: string) => void;
}

export class VoiceRoomManager {
  private socket: AppSocket;
  private channelId: string;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, VoicePeer>();
  private handlers: VoiceRoomHandlers;
  private analyserCleanups = new Map<string, () => void>();
  private muted = false;

  constructor(socket: AppSocket, channelId: string, handlers: VoiceRoomHandlers = {}) {
    this.socket = socket;
    this.channelId = channelId;
    this.handlers = handlers;
  }

  async start(): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.socket.on("voice:offer", this.handleOffer);
    this.socket.on("voice:answer", this.handleAnswer);
    this.socket.on("voice:ice", this.handleIce);
    this.socket.on("voice:peer-left", this.handlePeerLeft);
    this.socket.emit("voice:join", { channelId: this.channelId });
    return this.localStream;
  }

  /** Called once we learn the full participant list — we only INITIATE offers
   * to peers whose userId sorts after ours, so exactly one side of each pair
   * creates the offer (avoids duplicate/glare connections in a mesh). */
  async syncParticipants(participantUserIds: string[], myUserId: string) {
    for (const otherId of participantUserIds) {
      if (otherId === myUserId || this.peers.has(otherId)) continue;
      const shouldInitiate = myUserId < otherId;
      const peer = this.createPeer(otherId);
      if (shouldInitiate) {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        this.socket.emit("voice:offer", { channelId: this.channelId, toUserId: otherId, sdp: offer.sdp! });
      }
    }
  }

  private createPeer(userId: string): VoicePeer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: VoicePeer = { userId, pc, stream: null, speaking: false };
    this.peers.set(userId, peer);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit("voice:ice", {
          channelId: this.channelId,
          toUserId: userId,
          candidate: JSON.stringify(e.candidate)
        });
      }
    };

    pc.ontrack = (e) => {
      peer.stream = e.streams[0] ?? null;
      if (peer.stream) {
        this.handlers.onPeerStream?.(userId, peer.stream);
        this.watchSpeaking(userId, peer.stream);
      }
    };

    return peer;
  }

  private watchSpeaking(userId: string, stream: MediaStream) {
    const AudioCtx = window.AudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let speaking = false;
    const interval = setInterval(() => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const isSpeaking = avg > 12; // empirical threshold for voice activity
      if (isSpeaking !== speaking) {
        speaking = isSpeaking;
        this.handlers.onPeerSpeaking?.(userId, speaking);
      }
    }, 200);
    this.analyserCleanups.set(userId, () => {
      clearInterval(interval);
      void ctx.close();
    });
  }

  private handleOffer = async (payload: { channelId: string; fromUserId: string; sdp: string }) => {
    if (payload.channelId !== this.channelId) return;
    let peer = this.peers.get(payload.fromUserId);
    if (!peer) peer = this.createPeer(payload.fromUserId);
    await peer.pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    this.socket.emit("voice:answer", {
      channelId: this.channelId,
      toUserId: payload.fromUserId,
      sdp: answer.sdp!
    });
  };

  private handleAnswer = async (payload: { channelId: string; fromUserId: string; sdp: string }) => {
    if (payload.channelId !== this.channelId) return;
    const peer = this.peers.get(payload.fromUserId);
    if (!peer) return;
    await peer.pc.setRemoteDescription({ type: "answer", sdp: payload.sdp });
  };

  private handleIce = async (payload: { channelId: string; fromUserId: string; candidate: string }) => {
    if (payload.channelId !== this.channelId) return;
    const peer = this.peers.get(payload.fromUserId);
    if (!peer) return;
    try {
      await peer.pc.addIceCandidate(JSON.parse(payload.candidate));
    } catch {
      // benign — candidate arriving before remote description is set is normal churn
    }
  };

  private handlePeerLeft = (payload: { channelId: string; userId: string }) => {
    if (payload.channelId !== this.channelId) return;
    this.removePeer(payload.userId);
    this.handlers.onPeerLeft?.(payload.userId);
  };

  private removePeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(userId);
    this.analyserCleanups.get(userId)?.();
    this.analyserCleanups.delete(userId);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = !muted;
    }
    this.socket.emit("voice:mute", { channelId: this.channelId, muted });
  }

  isMuted() {
    return this.muted;
  }

  stop() {
    this.socket.emit("voice:leave", { channelId: this.channelId });
    this.socket.off("voice:offer", this.handleOffer);
    this.socket.off("voice:answer", this.handleAnswer);
    this.socket.off("voice:ice", this.handleIce);
    this.socket.off("voice:peer-left", this.handlePeerLeft);
    for (const userId of [...this.peers.keys()]) this.removePeer(userId);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}
