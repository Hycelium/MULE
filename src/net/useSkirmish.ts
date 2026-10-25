import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { skirmishMap, skirmishMaps } from "../game/map";
import type { GameRenderer } from "../game/render3d";
import type { GameSim } from "../game/sim";
import type { Team } from "../game/types";
import {
  HOST_PLAYER_ID,
  MAX_SKIRMISH_PLAYERS,
  createRoomId,
  inviteLink,
  parseRoomInput,
  pickBalancedTeam,
  type NetMsg,
  type RosterSeat,
} from "./protocol";
import { emoteById, pruneChatLines, pushChatLine, sanitizeChatText, type ChatLine } from "./chat";
import { RELAY_STATUS } from "./ice";
import { ROOM_OPEN_STATUS, SkirmishLink } from "./skirmish";

const DEFAULT_MAP = skirmishMaps()[0].id;
const NAME_KEY = "roadkeep_name";
const PLAYER_KEY = "roadkeep_player_id";
const PICTURE_REJECTED = "The match picture was rejected.";

export interface LobbyState {
  open: boolean;
  role: "idle" | "host" | "guest";
  live: boolean;
  roomId: string;
  invite: string;
  players: RosterSeat[];
  /** PeerJS peer id → roster seat id (host only). */
  peerToPlayer: Record<string, string>;
  status: string;
  joinDraft: string;
  copied: boolean;
  pingMs: number | null;
  path: string;
  link: "off" | "connecting" | "open" | "failed" | "down";
  selectedMapId: string;
  localPlayerId: string;
  localTeam: Team;
}

function loadName() {
  try {
    const saved = localStorage.getItem(NAME_KEY)?.trim();
    if (saved) return saved.slice(0, 24);
  } catch {
    /* private mode */
  }
  return "Player";
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim() || "Player");
  } catch {
    /* private mode */
  }
}

function loadPlayerId() {
  try {
    const saved = localStorage.getItem(PLAYER_KEY)?.trim();
    if (saved) return saved;
  } catch {
    /* private mode */
  }
  const id = createRoomId();
  try {
    localStorage.setItem(PLAYER_KEY, id);
  } catch {
    /* private mode */
  }
  return id;
}

const idleLobby = (): LobbyState => ({
  open: false,
  role: "idle",
  live: false,
  roomId: "",
  invite: "",
  players: [],
  peerToPlayer: {},
  status: "",
  joinDraft: "",
  copied: false,
  pingMs: null,
  path: "",
  link: "off",
  selectedMapId: DEFAULT_MAP,
  localPlayerId: HOST_PLAYER_ID,
  localTeam: "you",
});

function bothTeamsSeated(players: RosterSeat[]) {
  return players.some((p) => p.team === "you") && players.some((p) => p.team === "foe");
}

export function useSkirmish(sim: GameSim, rendererRef: RefObject<GameRenderer | null>) {
  const [name, setNameState] = useState(loadName);
  const [lobby, setLobby] = useState<LobbyState>(idleLobby);
  const [chatLines, setChatLines] = useState<ChatLine[]>([]);
  const nameRef = useRef(name);
  nameRef.current = name;
  const roleRef = useRef<"solo" | "host" | "guest">("solo");
  const liveRef = useRef(false);
  const linkRef = useRef<SkirmishLink | null>(null);
  const lobbyRef = useRef(lobby);
  lobbyRef.current = lobby;
  const pictureWarned = useRef(false);
  const guestPlayerIdRef = useRef(loadPlayerId());
  /** Host maps PeerJS peer id → stable player id. */
  const peerMapRef = useRef(new Map<string, string>());
  const chatIdRef = useRef(1);

  const setName = useCallback((value: string) => {
    const next = value.slice(0, 24);
    setNameState(next);
    saveName(next);
    if (linkRef.current && lobbyRef.current.link === "open") {
      const playerId =
        lobbyRef.current.role === "host" ? HOST_PLAYER_ID : lobbyRef.current.localPlayerId;
      linkRef.current.send({ t: "hello", name: next.trim() || "Player", playerId });
      if (lobbyRef.current.role === "host") {
        setLobby((s) => {
          const players = s.players.map((p) =>
            p.id === HOST_PLAYER_ID ? { ...p, name: next.trim() || "Player" } : p,
          );
          linkRef.current?.send({ t: "roster", players });
          return { ...s, players };
        });
      }
    }
  }, []);

  const leave = useCallback(() => {
    linkRef.current?.close();
    linkRef.current = null;
    roleRef.current = "solo";
    liveRef.current = false;
    pictureWarned.current = false;
    peerMapRef.current.clear();
    sim.setOrderSink(null);
    sim.setRemoteNote(null);
    sim.setLinkDown(false);
    sim.clearPvpRoster();
    sim.setMatchMode("ai");
    sim.setLocalTeam("you");
    sim.setLocalPlayerId(HOST_PLAYER_ID);
    sim.reset();
    rendererRef.current?.setHomeSide("you");
    setChatLines([]);
    setLobby(idleLobby());
    const url = new URL(window.location.href);
    if (url.searchParams.has("room")) {
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, [rendererRef, sim]);

  const beginGuest = useCallback(
    (map: Parameters<GameSim["adoptMap"]>[0], team: Team, playerId: string) => {
      sim.setMatchMode("pvp");
      sim.setLocalTeam(team);
      sim.setLocalPlayerId(playerId);
      sim.setRemoteNote(null);
      sim.setOrderSink((order) =>
        linkRef.current?.send({ t: "order", playerId, order }),
      );
      sim.adoptMap(map);
      sim.getState().phase = "running";
      sim.getState().paused = false;
      liveRef.current = true;
      roleRef.current = "guest";
      rendererRef.current?.setHomeSide(team);
      setLobby((s) => ({
        ...s,
        open: false,
        live: true,
        link: "open",
        status: "",
        localTeam: team,
        localPlayerId: playerId,
      }));
    },
    [rendererRef, sim],
  );

  const warnPicture = useCallback(() => {
    if (pictureWarned.current) return;
    pictureWarned.current = true;
    sim.pushToast(PICTURE_REJECTED);
    if (roleRef.current === "host") linkRef.current?.send({ t: "note", text: PICTURE_REJECTED });
  }, [sim]);

  const onMessage = useCallback(
    (msg: NetMsg, fromPeerId?: string) => {
      if (msg.t === "hello") {
        const who = msg.name.trim().slice(0, 24) || "Player";
        const playerId = msg.playerId;
        if (roleRef.current === "host" && fromPeerId) {
          peerMapRef.current.set(fromPeerId, playerId);
          setLobby((s) => {
            if (s.players.some((p) => p.id === playerId)) {
              const players = s.players.map((p) => (p.id === playerId ? { ...p, name: who } : p));
              linkRef.current?.send({ t: "roster", players });
              return { ...s, players, peerToPlayer: { ...s.peerToPlayer, [fromPeerId]: playerId } };
            }
            if (s.players.length >= MAX_SKIRMISH_PLAYERS) {
              linkRef.current?.sendTo(fromPeerId, { t: "full" });
              return s;
            }
            const team = pickBalancedTeam(s.players);
            const players = [...s.players, { id: playerId, name: who, team }];
            linkRef.current?.send({ t: "roster", players });
            sim.setPvpRoster(players);
            return {
              ...s,
              players,
              peerToPlayer: { ...s.peerToPlayer, [fromPeerId]: playerId },
            };
          });
        }
        return;
      }
      if (msg.t === "roster") {
        setLobby((s) => {
          const mine = msg.players.find((p) => p.id === s.localPlayerId);
          return {
            ...s,
            players: msg.players,
            localTeam: mine?.team ?? s.localTeam,
          };
        });
        if (roleRef.current === "guest") sim.setPvpRoster(msg.players);
        return;
      }
      if (msg.t === "start") {
        beginGuest(msg.map, msg.team, msg.playerId);
        return;
      }
      if (msg.t === "pick") {
        if (roleRef.current !== "guest" || !skirmishMap(msg.mapId)) return;
        setLobby((s) => ({ ...s, selectedMapId: msg.mapId }));
        return;
      }
      if (msg.t === "rematch") {
        if (roleRef.current !== "guest" || lobbyRef.current.link !== "open") return;
        if (!sim.applyRematch(msg.mapId)) return;
        sim.setLocalTeam(msg.team);
        sim.setLocalPlayerId(msg.playerId);
        rendererRef.current?.setHomeSide(msg.team);
        setChatLines([]);
        setLobby((s) => ({
          ...s,
          selectedMapId: msg.mapId,
          live: true,
          open: false,
          link: "open",
          localTeam: msg.team,
          localPlayerId: msg.playerId,
        }));
        return;
      }
      if (msg.t === "order") {
        sim.applyRemoteOrder(msg.order, msg.playerId);
        return;
      }
      if (msg.t === "snap") {
        if (!sim.applySnapshot(msg.snap)) warnPicture();
        return;
      }
      if (msg.t === "note") {
        if (msg.text === PICTURE_REJECTED) warnPicture();
        else sim.pushToast(msg.text);
        return;
      }
      if (msg.t === "chat") {
        const text = sanitizeChatText(msg.text);
        if (!text) return;
        // Host relays guest chat to every peer.
        if (roleRef.current === "host") linkRef.current?.send(msg);
        if (msg.playerId === lobbyRef.current.localPlayerId) return;
        const id = chatIdRef.current++;
        setChatLines((lines) =>
          pushChatLine(
            lines,
            {
              playerId: msg.playerId,
              name: msg.name.trim().slice(0, 24) || "Player",
              team: msg.team,
              text,
              emote: msg.emote,
              at: Date.now(),
            },
            id,
          ),
        );
        return;
      }
      if (msg.t === "pong") {
        const ms = Math.max(0, Date.now() - msg.at);
        setLobby((s) => ({ ...s, pingMs: ms }));
      }
    },
    [beginGuest, rendererRef, sim, warnPicture],
  );

  const sendChatPayload = useCallback((text: string, emote?: string) => {
    const cleaned = sanitizeChatText(text);
    if (!cleaned || !liveRef.current || lobbyRef.current.link !== "open") return;
    const playerId = lobbyRef.current.localPlayerId;
    const team = lobbyRef.current.localTeam;
    const who = nameRef.current.trim().slice(0, 24) || "Player";
    const msg: NetMsg = { t: "chat", playerId, name: who, team, text: cleaned, emote };
    const id = chatIdRef.current++;
    setChatLines((lines) =>
      pushChatLine(lines, { playerId, name: who, team, text: cleaned, emote, at: Date.now() }, id),
    );
    linkRef.current?.send(msg);
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      sendChatPayload(text);
    },
    [sendChatPayload],
  );

  const sendEmote = useCallback(
    (emoteId: string) => {
      const emote = emoteById(emoteId);
      if (!emote) return;
      sendChatPayload(emote.text, emote.id);
    },
    [sendChatPayload],
  );

  useEffect(() => {
    if (!lobby.live) return;
    const id = window.setInterval(() => {
      setChatLines((lines) => {
        const next = pruneChatLines(lines);
        return next.length === lines.length ? lines : next;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [lobby.live]);

  const openLink = useCallback(
    (role: "host" | "guest", roomId: string) => {
      linkRef.current?.close();
      pictureWarned.current = false;
      const link = new SkirmishLink({
        onReady: (id) => {
          setLobby((s) => ({
            ...s,
            roomId: id,
            invite: inviteLink(id),
            status:
              s.status === RELAY_STATUS || s.status === ROOM_OPEN_STATUS || s.status.startsWith("Reopening")
                ? s.status
                : "Connecting",
          }));
        },
        onConnected: () => {
          const playerId = role === "host" ? HOST_PLAYER_ID : guestPlayerIdRef.current;
          link.send({ t: "hello", name: nameRef.current.trim() || "Player", playerId });
          setLobby((s) => ({
            ...s,
            link: "open",
            status: role === "host" ? ROOM_OPEN_STATUS : "Connected — waiting for roster",
          }));
        },
        onGuestConnected: () => {
          setLobby((s) => ({
            ...s,
            link: "open",
            status: `${s.players.length}/${MAX_SKIRMISH_PLAYERS} seated · teams auto-balance`,
          }));
        },
        onGuestDisconnected: (peerId) => {
          const playerId = peerMapRef.current.get(peerId);
          peerMapRef.current.delete(peerId);
          if (!playerId) return;
          setLobby((s) => {
            const players = s.players.filter((p) => p.id !== playerId);
            linkRef.current?.send({ t: "roster", players });
            sim.setPvpRoster(players);
            const peerToPlayer = { ...s.peerToPlayer };
            delete peerToPlayer[peerId];
            return {
              ...s,
              players,
              peerToPlayer,
              status: liveRef.current
                ? "A player left."
                : `${players.length}/${MAX_SKIRMISH_PLAYERS} seated · teams auto-balance`,
            };
          });
        },
        onMessage,
        onStatus: (text) => setLobby((s) => ({ ...s, status: text })),
        onDirectFail: (text) => setLobby((s) => ({ ...s, status: text, link: "failed" })),
        onPath: (kind) => {
          setLobby((s) => ({
            ...s,
            path: kind,
            status: s.live ? s.status : `Connected · ${kind}`,
          }));
        },
        onReject: warnPicture,
        onDown: (text) => {
          const wasLive = liveRef.current;
          if (wasLive) sim.setLinkDown(true);
          setLobby((s) => ({
            ...s,
            link: "down",
            status: wasLive ? "Connection lost." : text,
          }));
        },
      });
      linkRef.current = link;
      if (role === "host") link.host(roomId);
      else link.join(roomId);
    },
    [onMessage, sim, warnPicture],
  );

  const hostMatch = useCallback(() => {
    const id = createRoomId();
    const self = nameRef.current.trim() || "Player";
    roleRef.current = "host";
    liveRef.current = false;
    peerMapRef.current.clear();
    const players: RosterSeat[] = [{ id: HOST_PLAYER_ID, name: self, team: "you" }];
    sim.setLocalPlayerId(HOST_PLAYER_ID);
    sim.setPvpRoster(players);
    setLobby({
      open: true,
      role: "host",
      live: false,
      roomId: id,
      invite: "",
      players,
      peerToPlayer: {},
      status: "Connecting",
      joinDraft: "",
      copied: false,
      pingMs: null,
      path: "",
      link: "connecting",
      selectedMapId: DEFAULT_MAP,
      localPlayerId: HOST_PLAYER_ID,
      localTeam: "you",
    });
    openLink("host", id);
  }, [openLink, sim]);

  const joinMatch = useCallback(
    (raw?: string) => {
      const roomId = parseRoomInput(raw ?? lobbyRef.current.joinDraft);
      if (!roomId) {
        setLobby((s) => ({ ...s, open: true, status: "Paste an invite link or code first." }));
        return;
      }
      const self = nameRef.current.trim() || "Player";
      const playerId = guestPlayerIdRef.current;
      roleRef.current = "guest";
      liveRef.current = false;
      sim.setLocalPlayerId(playerId);
      setLobby({
        open: true,
        role: "guest",
        live: false,
        roomId,
        invite: "",
        players: [{ id: playerId, name: self, team: "foe" }],
        peerToPlayer: {},
        status: "Connecting",
        joinDraft: roomId,
        copied: false,
        pingMs: null,
        path: "",
        link: "connecting",
        selectedMapId: DEFAULT_MAP,
        localPlayerId: playerId,
        localTeam: "foe",
      });
      openLink("guest", roomId);
    },
    [openLink, sim],
  );

  const announceMap = useCallback(() => {
    if (roleRef.current !== "host" || lobbyRef.current.link !== "open") return;
    const mapId = lobbyRef.current.selectedMapId;
    if (!skirmishMap(mapId)) return;
    linkRef.current?.send({ t: "pick", mapId });
  }, []);

  const pickMap = useCallback((mapId: string) => {
    if (roleRef.current !== "host" || !skirmishMap(mapId)) return;
    setLobby((s) => ({ ...s, selectedMapId: mapId }));
    if (lobbyRef.current.link === "open") linkRef.current?.send({ t: "pick", mapId });
  }, []);

  const rematch = useCallback(() => {
    if (roleRef.current !== "host" || !liveRef.current || lobbyRef.current.link !== "open") return;
    const mapId = lobbyRef.current.selectedMapId;
    if (!sim.applyRematch(mapId)) return;
    const players = lobbyRef.current.players;
    sim.setPvpRoster(players);
    setChatLines([]);
    for (const [peerId, playerId] of peerMapRef.current) {
      const seat = players.find((p) => p.id === playerId);
      if (!seat) continue;
      linkRef.current?.sendTo(peerId, {
        t: "rematch",
        mapId,
        team: seat.team,
        playerId: seat.id,
      });
    }
    linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
    rendererRef.current?.setHomeSide(lobbyRef.current.localTeam);
  }, [rendererRef, sim]);

  const startSkirmish = useCallback(() => {
    if (roleRef.current !== "host") return;
    const players = lobbyRef.current.players;
    if (!bothTeamsSeated(players)) return;
    sim.setMatchMode("pvp");
    sim.setLocalTeam("you");
    sim.setLocalPlayerId(HOST_PLAYER_ID);
    sim.setOrderSink(null);
    sim.setPvpRoster(players);
    sim.setRemoteNote((text) => linkRef.current?.send({ t: "note", text }));
    sim.startMatch();
    const map = sim.getActiveMap();
    for (const [peerId, playerId] of peerMapRef.current) {
      const seat = players.find((p) => p.id === playerId);
      if (!seat) continue;
      linkRef.current?.sendTo(peerId, {
        t: "start",
        map,
        team: seat.team,
        playerId: seat.id,
      });
    }
    linkRef.current?.send({ t: "snap", snap: sim.exportSnapshot() });
    liveRef.current = true;
    rendererRef.current?.setHomeSide("you");
    setChatLines([]);
    setLobby((s) => ({ ...s, open: false, live: true, link: "open", status: "", localTeam: "you" }));
  }, [rendererRef, sim]);

  const shareInvite = useCallback(async () => {
    const invite = lobbyRef.current.invite;
    if (!invite || !navigator.share) return;
    try {
      await navigator.share({ title: "MULE", text: "Join my MULE match", url: invite });
    } catch {
      /* dismissed */
    }
  }, []);

  const copyInvite = useCallback(async () => {
    const invite = lobbyRef.current.invite;
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
    } catch {
      /* field stays selectable */
    }
    setLobby((s) => ({ ...s, copied: true }));
  }, []);

  const openLobby = useCallback(() => {
    setLobby((s) => ({ ...idleLobby(), open: true, joinDraft: s.joinDraft }));
  }, []);

  const setJoinDraft = useCallback((joinDraft: string) => {
    setLobby((s) => ({ ...s, open: true, joinDraft }));
  }, []);

  useEffect(() => {
    if (!lobby.open) return;
    let released = false;
    let sentinel: WakeLockSentinel | null = null;
    const hold = () => {
      const locks = navigator.wakeLock;
      if (!locks || sentinel || released) return;
      void locks
        .request("screen")
        .then((lock) => {
          if (released) void lock.release();
          else sentinel = lock;
        })
        .catch(() => {
          /* refused */
        });
    };
    hold();
    const onVis = () => {
      if (document.visibilityState !== "visible") {
        sentinel = null;
        return;
      }
      hold();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVis);
      void sentinel?.release();
    };
  }, [lobby.open]);

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get("room");
    if (room) joinMatch(room);
    return () => {
      linkRef.current?.close();
      linkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    name,
    setName,
    lobby,
    chatLines,
    sendChat,
    sendEmote,
    roleRef,
    liveRef,
    linkRef,
    openLobby,
    setJoinDraft,
    hostMatch,
    joinMatch,
    startSkirmish,
    announceMap,
    pickMap,
    rematch,
    shareInvite,
    copyInvite,
    leave,
    canStart: lobby.role === "host" && bothTeamsSeated(lobby.players) && lobby.link === "open",
  };
}
