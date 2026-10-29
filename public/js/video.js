const STUN_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] }
];

function iceServers() {
  if (Array.isArray(window.RTC_ICE_SERVERS) && window.RTC_ICE_SERVERS.length) {
    return window.RTC_ICE_SERVERS;
  }
  return STUN_SERVERS;
}

export class VideoChat {
  constructor(socket) {
    this.socket = socket;
    this.container = null;
    this.tiles = new Map();
    this.peers = new Map();
    this.localStream = null;
    this.viewerId = null;
    this.joined = false;
    this.signaling = false;
    this.videoOn = false;
    this.audioOn = false;
    this.winnerId = null;
    this.onUpdate = null;
    this.audioCtx = null;
    this.error = null;
    this.remoteMedia = new Map();
    this.watchPending = new Set();

    this.socket.on('rtc-peers', (payload = {}) => this.onPeers(payload.peers || []));
    this.socket.on('rtc-signal', (payload = {}) => this.onSignal(payload.from, payload.data));
    this.socket.on('rtc-media', (payload = {}) => this.onMedia(payload));
    this.socket.on('rtc-status', (payload = {}) => this.onStatus(payload.players || []));
    this.socket.on('rtc-watch-request', (payload = {}) => this.onWatchRequest(payload.playerId));
    this.socket.on('rtc-peer-joined', (payload = {}) => this.onPeerJoined(payload.playerId));
    this.socket.on('rtc-peer-left', (payload = {}) => this.dropPeer(payload.playerId));
  }

  mount(el) {
    this.container = el;
  }

  sync(players, viewerId) {
    if (!this.container) return;
    this.viewerId = viewerId;
    const ids = new Set();

    for (const player of players) {
      ids.add(player.id);
      const entry = this.tiles.get(player.id);
      if (!entry) {
        this.createTile(player, player.id === viewerId);
      } else {
        entry.nameEl.textContent =
          player.id === viewerId ? `${player.name} (you)` : player.name;
      }
    }

    for (const [id, entry] of [...this.tiles]) {
      if (ids.has(id)) continue;
      this.stopWatching(entry);
      entry.tile.remove();
      this.tiles.delete(id);
      this.dropPeer(id, true);
    }

    for (const [id, media] of this.remoteMedia) {
      const entry = this.tiles.get(id);
      if (!entry) continue;
      entry.cam = !!media.video;
      entry.mic = !!media.audio;
      if (media.video || media.audio) this.watchPeer(id);
      this.paint(id);
    }

    if (this.joined && this.localStream) this.attachSelf();
    if (this.viewerId) this.paint(this.viewerId);
  }

  createTile(player, isSelf) {
    const tile = document.createElement('div');
    tile.className = `video-tile vt-${player.color}`;
    tile.dataset.player = player.id;
    if (isSelf) tile.classList.add('self');
    tile.classList.add('enter');
    setTimeout(() => tile.classList.remove('enter'), 420);

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isSelf) video.muted = true;

    const avatar = document.createElement('div');
    avatar.className = 'video-avatar';
    avatar.textContent = (player.name || '?').trim().charAt(0).toUpperCase() || '?';

    const name = document.createElement('div');
    name.className = 'video-name';
    name.textContent = isSelf ? `${player.name} (you)` : player.name;

    const status = document.createElement('div');
    status.className = 'video-status';

    tile.append(video, avatar, name, status);
    this.container.appendChild(tile);

    this.tiles.set(player.id, {
      tile,
      video,
      nameEl: name,
      statusEl: status,
      stream: null,
      inCall: false,
      watching: false,
      cam: false,
      mic: false,
      connState: '',
      retries: 0,
      retryTimer: 0,
      watchTimer: 0
    });

    this.paint(player.id);
  }

  paint(playerId) {
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (!entry) return;
    entry.tile.classList.toggle('in-call', entry.inCall);
    entry.tile.classList.toggle('watching', entry.watching);
    entry.tile.classList.toggle('has-video', entry.inCall && entry.cam);
    entry.tile.classList.toggle('mic-off', entry.inCall && !entry.mic);
    entry.tile.classList.toggle('winner', playerId === this.winnerId);
    entry.tile.classList.toggle('connecting', entry.connState === 'connecting');
    entry.tile.classList.toggle('failed', entry.connState === 'failed');
    const status = [];
    if (entry.connState === 'failed') status.push('connection failed');
    else if (entry.watching && !entry.inCall) status.push('watching');
    else if (!entry.inCall && (entry.connState === 'connecting' || entry.connState === 'connected'))
      status.push('connecting');
    else if (!entry.inCall) status.push('no cam');
    else if (!entry.cam) status.push('cam off');
    if (entry.inCall && !entry.mic) status.push('mic off');
    entry.statusEl.textContent = status.join(' · ');
  }

  paintSelfState() {
    const entry = this.viewerId ? this.tiles.get(this.viewerId) : null;
    if (!entry) return;
    entry.inCall = this.joined;
    entry.cam = this.joined && this.videoOn;
    entry.mic = this.joined && this.audioOn;
    entry.connState = this.joined ? 'connected' : '';
    if (!this.joined) entry.video.srcObject = null;
    this.paint(this.viewerId);
  }

  attachSelf() {
    const entry = this.viewerId ? this.tiles.get(this.viewerId) : null;
    if (!entry || !this.localStream) return;
    entry.video.srcObject = this.localStream;
    entry.video.play().catch(() => {});
    this.paintSelfState();
  }

  async join() {
    if (this.joined) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.error = 'unsupported';
      return false;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 } },
        audio: true
      });
    } catch {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.error = 'permission';
        return false;
      }
    }

    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.watchPending.clear();
    if (this.signaling) this.socket.emit('rtc-bye');

    this.error = null;
    this.joined = true;
    this.signaling = true;
    this.videoOn = this.localStream.getVideoTracks().length > 0;
    this.audioOn = this.localStream.getAudioTracks().length > 0;
    this.attachSelf();
    this.watchAudio(this.viewerId, this.localStream);
    this.socket.emit('rtc-hello');
    this.emitMedia();
    this.update();
    return true;
  }

  refresh() {
    if (!this.container || this.joined) return;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.watchPending.clear();
    if (this.signaling) this.socket.emit('rtc-bye');
    this.signaling = false;
    this.socket.emit('rtc-status');
  }

  onStatus(players) {
    if (this.joined) return;
    this.remoteMedia = new Map();
    for (const info of players) {
      if (!info || !info.playerId || info.playerId === this.viewerId) continue;
      this.remoteMedia.set(info.playerId, {
        video: !!info.video,
        audio: !!info.audio
      });
    }
    for (const [id, entry] of this.tiles) {
      if (id === this.viewerId) continue;
      const media = this.remoteMedia.get(id);
      entry.cam = media ? media.video : false;
      entry.mic = media ? media.audio : false;
      if (media && (media.video || media.audio)) this.watchPeer(id);
      this.paint(id);
    }
    this.update();
  }

  watchPeer(playerId) {
    if (!playerId || playerId === this.viewerId || this.joined) return;
    const entry = this.tiles.get(playerId);
    if (!entry || this.peers.has(playerId) || this.watchPending.has(playerId)) return;
    this.signaling = true;
    this.watchPending.add(playerId);
    entry.connState = 'connecting';
    this.paint(playerId);
    this.update();
    clearTimeout(entry.watchTimer);
    entry.watchTimer = setTimeout(() => {
      if (this.peers.has(playerId)) return;
      this.watchPending.delete(playerId);
      if (entry.connState === 'connecting') entry.connState = '';
      this.paint(playerId);
      this.update();
    }, 10000);
    this.socket.emit('rtc-watch', { to: playerId });
  }

  onWatchRequest(playerId) {
    if (!this.joined || !this.localStream || !playerId) return;
    const conn = this.peers.get(playerId);
    if (conn && conn.pc.connectionState !== 'connected') this.dropPeer(playerId);
    const entry = this.tiles.get(playerId);
    if (entry) {
      entry.watching = true;
      this.paint(playerId);
    }
    this.call(playerId);
  }

  liveCount() {
    let count = 0;
    for (const entry of this.tiles.values()) if (entry.inCall) count += 1;
    return count;
  }

  ensureAudioCtx() {
    if (!this.audioCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      this.audioCtx = new Ctor();
    }
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  watchAudio(playerId, stream) {
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (!entry || !stream) return;
    if (!stream.getAudioTracks().length) return;
    if (entry.audio && entry.audio.stream === stream) return;
    this.stopWatching(entry);
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      entry.audio = { stream, source, analyser, data };
      const tick = () => {
        if (!entry.audio) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        entry.tile.classList.toggle('speaking', Math.sqrt(sum / data.length) > 0.05);
        entry.raf = requestAnimationFrame(tick);
      };
      entry.raf = requestAnimationFrame(tick);
    } catch {}
  }

  stopWatching(entry) {
    if (!entry) return;
    if (entry.raf) cancelAnimationFrame(entry.raf);
    entry.raf = 0;
    if (entry.audio) {
      try {
        entry.audio.source.disconnect();
      } catch {}
      entry.audio = null;
    }
    entry.tile.classList.remove('speaking');
  }

  reconnect() {
    if (!this.joined) return;
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.signaling = true;
    this.socket.emit('rtc-hello');
    this.emitMedia();
  }

  leave() {
    if (!this.joined && !this.signaling) return;
    this.stopWatching(this.viewerId ? this.tiles.get(this.viewerId) : null);
    for (const track of this.localStream ? this.localStream.getTracks() : []) track.stop();
    this.localStream = null;
    this.joined = false;
    this.videoOn = false;
    this.audioOn = false;
    this.watchPending.clear();
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    if (this.signaling) this.socket.emit('rtc-bye');
    this.signaling = false;
    this.paintSelfState();
    this.update();
  }

  toggleCamera() {
    if (!this.joined || !this.localStream) return;
    const tracks = this.localStream.getVideoTracks();
    if (!tracks.length) return;
    this.videoOn = !this.videoOn;
    for (const track of tracks) track.enabled = this.videoOn;
    this.paintSelfState();
    this.emitMedia();
    this.update();
  }

  toggleMic() {
    if (!this.joined || !this.localStream) return;
    const tracks = this.localStream.getAudioTracks();
    if (!tracks.length) return;
    this.audioOn = !this.audioOn;
    for (const track of tracks) track.enabled = this.audioOn;
    this.paintSelfState();
    this.emitMedia();
    this.update();
  }

  emitMedia() {
    this.socket.emit('rtc-media', { video: this.videoOn, audio: this.audioOn });
  }

  onPeers(peers) {
    if (!this.joined) return;
    for (const id of peers) this.call(id);
  }

  async call(peerId) {
    if (!this.joined || peerId === this.viewerId || this.peers.has(peerId)) return;
    const conn = this.makePeer(peerId);
    try {
      const offer = await conn.pc.createOffer();
      await conn.pc.setLocalDescription(offer);
      this.signal(peerId, { description: conn.pc.localDescription });
    } catch {
      this.dropPeer(peerId);
    }
  }

  makePeer(peerId) {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const conn = { pc, pending: [] };
    this.peers.set(peerId, conn);
    this.watchPending.delete(peerId);
    const entry = this.tiles.get(peerId);
    if (entry) {
      clearTimeout(entry.watchTimer);
      entry.watchTimer = 0;
      entry.connState = 'connecting';
      this.paint(peerId);
      this.update();
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.signal(peerId, { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const entry = this.tiles.get(peerId);
      if (!entry) return;
      if (!entry.stream) entry.stream = new MediaStream();
      entry.stream.addTrack(event.track);
      entry.video.srcObject = entry.stream;
      entry.video.play().catch(() => {});
      entry.inCall = true;
      entry.watching = false;
      this.watchPending.delete(peerId);
      clearTimeout(entry.watchTimer);
      entry.watchTimer = 0;
      if (event.track.kind === 'video') entry.cam = true;
      if (event.track.kind === 'audio') {
        entry.mic = true;
        this.watchAudio(peerId, entry.stream);
      }
      this.paint(peerId);
      this.update();
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const tile = this.tiles.get(peerId);
      if (!tile) return;
      if (state === 'connected') {
        tile.connState = 'connected';
        tile.retries = 0;
        if (!tile.inCall && !tile.stream) tile.watching = true;
        this.paint(peerId);
        this.update();
        return;
      }
      if (state === 'disconnected') {
        tile.connState = 'connecting';
        this.paint(peerId);
        this.update();
        return;
      }
      if (state === 'failed') {
        tile.connState = 'failed';
        this.paint(peerId);
        this.update();
        if (this.viewerId && this.viewerId < peerId) this.retryPeer(peerId);
        return;
      }
      if (state === 'closed' && this.peers.get(peerId)?.pc === pc) this.dropPeer(peerId);
    };

    return conn;
  }

  retryPeer(peerId) {
    if (!this.signaling) return;
    const entry = this.tiles.get(peerId);
    if (!entry || entry.retries >= 2 || entry.retryTimer) return;
    entry.retries += 1;
    this.dropPeer(peerId, true);
    entry.video.srcObject = null;
    entry.stream = null;
    entry.inCall = false;
    entry.watching = false;
    entry.cam = false;
    entry.mic = false;
    entry.connState = 'connecting';
    this.paint(peerId);
    this.update();
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = 0;
      if (!this.signaling || !this.tiles.has(peerId)) return;
      if (this.joined) this.call(peerId);
      else this.watchPeer(peerId);
    }, 900);
  }

  async onSignal(from, data) {
    if (!this.signaling || !from || !data) return;

    if (data.description) {
      const desc = data.description;
      if (desc.type === 'offer') {
        let conn = this.peers.get(from);
        if (
          conn &&
          (conn.pc.connectionState === 'failed' ||
            conn.pc.connectionState === 'closed' ||
            conn.pc.connectionState === 'disconnected')
        ) {
          this.dropPeer(from);
          conn = null;
        }
        conn = conn || this.makePeer(from);
        try {
          await conn.pc.setRemoteDescription(desc);
          await this.flushCandidates(conn);
          const answer = await conn.pc.createAnswer();
          await conn.pc.setLocalDescription(answer);
          this.signal(from, { description: conn.pc.localDescription });
        } catch {
          this.dropPeer(from);
        }
        return;
      }
      if (desc.type === 'answer') {
        const conn = this.peers.get(from);
        if (!conn) return;
        try {
          await conn.pc.setRemoteDescription(desc);
          await this.flushCandidates(conn);
        } catch {
          this.dropPeer(from);
        }
      }
      return;
    }

    if (data.candidate) {
      const conn = this.peers.get(from);
      if (!conn) return;
      if (conn.pc.remoteDescription) {
        conn.pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        conn.pending.push(data.candidate);
      }
    }
  }

  async flushCandidates(conn) {
    const pending = conn.pending.splice(0);
    for (const candidate of pending) {
      try {
        await conn.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  signal(to, data) {
    this.socket.emit('rtc-signal', { to, data });
  }

  onMedia(payload) {
    const playerId = payload.playerId;
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (!entry) return;
    entry.cam = !!payload.video;
    entry.mic = !!payload.audio;
    this.remoteMedia.set(playerId, { video: entry.cam, audio: entry.mic });
    if (!this.joined && (entry.cam || entry.mic)) this.watchPeer(playerId);
    this.paint(playerId);
    this.update();
  }

  onPeerJoined(playerId) {
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (entry) {
      if (this.joined) entry.inCall = true;
      this.paint(playerId);
      this.update();
    }
    if (this.joined) this.emitMedia();
  }

  dropPeer(playerId, removeOnly = false) {
    const conn = playerId ? this.peers.get(playerId) : null;
    if (conn) {
      try {
        conn.pc.close();
      } catch {}
      this.peers.delete(playerId);
    }
    this.watchPending.delete(playerId);
    this.remoteMedia.delete(playerId);
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (entry) {
      this.stopWatching(entry);
      clearTimeout(entry.watchTimer);
      entry.watchTimer = 0;
    }
    if (removeOnly || !entry) return;
    entry.video.srcObject = null;
    entry.stream = null;
    entry.inCall = false;
    entry.watching = false;
    entry.cam = false;
    entry.mic = false;
    entry.connState = '';
    entry.retries = 0;
    clearTimeout(entry.retryTimer);
    entry.retryTimer = 0;
    this.paint(playerId);
    this.update();
  }

  bump(playerId) {
    const entry = playerId ? this.tiles.get(playerId) : null;
    if (!entry) return;
    entry.tile.classList.remove('bump');
    void entry.tile.offsetWidth;
    entry.tile.classList.add('bump');
    clearTimeout(entry.bumpTimer);
    entry.bumpTimer = setTimeout(() => entry.tile.classList.remove('bump'), 520);
  }

  setWinner(playerId) {
    this.winnerId = playerId || null;
    for (const id of this.tiles.keys()) this.paint(id);
  }

  update() {
    if (typeof this.onUpdate === 'function') this.onUpdate(this);
  }
}
