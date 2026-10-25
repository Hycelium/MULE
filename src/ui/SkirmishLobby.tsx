import type { RosterSeat } from "../net/protocol";
import { MAX_SKIRMISH_PLAYERS } from "../net/protocol";
import type { Team } from "../game/types";

interface SkirmishEndProps {
  result: string;
  role: "host" | "guest" | "idle";
  maps: { id: string; name: string; tagline: string; lanes: number }[];
  mapId: string;
  linkDown: boolean;
  canRematch: boolean;
  onPick: (mapId: string) => void;
  onRematch: () => void;
  onLeave: () => void;
}

function roadsLabel(lanes: number) {
  return lanes === 1 ? "1 road" : `${lanes} roads`;
}

export function SkirmishEnd({
  result,
  role,
  maps,
  mapId,
  linkDown,
  canRematch,
  onPick,
  onRematch,
  onLeave,
}: SkirmishEndProps) {
  const selected = maps.find((map) => map.id === mapId) ?? maps[0];
  return (
    <div className="skirmish-end" role="dialog" aria-label="Match over">
      <h2>{result}</h2>
      {role === "host" ? (
        <div className="map-picks" role="listbox" aria-label="Rematch map">
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              role="option"
              aria-selected={map.id === selected?.id}
              onClick={() => onPick(map.id)}
            >
              {map.name} · {roadsLabel(map.lanes)}
            </button>
          ))}
        </div>
      ) : linkDown ? (
        <p className="skirmish-end-down">Connection lost.</p>
      ) : (
        <p>Waiting for host</p>
      )}
      {selected && role === "host" && <p className="skirmish-end-map">{selected.tagline}</p>}
      {selected && role !== "host" && (
        <p className="skirmish-end-map">
          {selected.name} · {roadsLabel(selected.lanes)}
          <span>{selected.tagline}</span>
        </p>
      )}
      {role === "host" && linkDown && <p className="skirmish-end-down">Connection lost.</p>}
      {role === "host" && (
        <button type="button" className="cta" onClick={onRematch} disabled={!canRematch}>
          Rematch
        </button>
      )}
      <button type="button" className="ghost" onClick={onLeave}>
        Leave match
      </button>
    </div>
  );
}

interface SkirmishLobbyProps {
  name: string;
  onName: (name: string) => void;
  role: "idle" | "host" | "guest";
  players: RosterSeat[];
  localPlayerId: string;
  localTeam: Team;
  invite: string;
  joinDraft: string;
  onJoinDraft: (value: string) => void;
  status: string;
  link: "off" | "connecting" | "open" | "failed" | "down";
  copied: boolean;
  canStart: boolean;
  onHost: () => void;
  onJoin: () => void;
  onCopy: () => void;
  onShare: () => void;
  onStart: () => void;
  onLeave: () => void;
}

function TeamColumn({
  title,
  seats,
  localPlayerId,
}: {
  title: string;
  seats: RosterSeat[];
  localPlayerId: string;
}) {
  return (
    <div className="lobby-team">
      <strong>{title}</strong>
      {seats.length === 0 ? (
        <span className="lobby-empty">Open seat</span>
      ) : (
        seats.map((p) => (
          <span key={p.id} className={p.id === localPlayerId ? "lobby-you" : undefined}>
            {p.name}
            {p.id === localPlayerId ? " (you)" : ""}
          </span>
        ))
      )}
    </div>
  );
}

export function SkirmishLobby({
  name,
  onName,
  role,
  players,
  localPlayerId,
  localTeam,
  invite,
  joinDraft,
  onJoinDraft,
  status,
  link,
  copied,
  canStart,
  onHost,
  onJoin,
  onCopy,
  onShare,
  onLeave,
  onStart,
}: SkirmishLobbyProps) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const south = players.filter((p) => p.team === "you");
  const north = players.filter((p) => p.team === "foe");

  return (
    <div className="overlay title-overlay skirmish-lobby">
      <h1>Skirmish</h1>
      <p>
        Up to {MAX_SKIRMISH_PLAYERS} players. Teams auto-balance — south keep vs north keep.
      </p>

      <label className="lobby-label">
        Your name
        <input
          className="lobby-field"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          onChange={(ev) => onName(ev.target.value)}
        />
      </label>

      {role === "idle" && (
        <>
          <button type="button" className="cta" onClick={onHost}>
            Host match
          </button>
          <label className="lobby-label">
            Invite code or link
            <input
              className="lobby-field"
              value={joinDraft}
              placeholder="Paste a link or code"
              onChange={(ev) => onJoinDraft(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") onJoin();
              }}
            />
          </label>
          <button type="button" className="ghost" onClick={onJoin} disabled={!joinDraft.trim()}>
            Join
          </button>
        </>
      )}

      {role !== "idle" && (
        <>
          <div className="lobby-teams" aria-label="Teams">
            <TeamColumn title={`South · ${south.length}`} seats={south} localPlayerId={localPlayerId} />
            <TeamColumn title={`North · ${north.length}`} seats={north} localPlayerId={localPlayerId} />
          </div>
          {role === "guest" && link === "open" && (
            <p className="lobby-seat">
              You are on the {localTeam === "you" ? "south" : "north"} keep.
            </p>
          )}
        </>
      )}

      {role === "host" && invite && (
        <>
          <p className="lobby-stay">
            Share the link. New players sit on the smaller team. Start when both keeps have at least one
            player.
          </p>
          <input className="lobby-field" readOnly value={invite} onFocus={(ev) => ev.currentTarget.select()} />
          {canShare && (
            <button type="button" className="cta" onClick={onShare}>
              Share via Messages
            </button>
          )}
          <button type="button" className="ghost" onClick={onCopy}>
            {copied ? "Copied" : "Copy invite link"}
          </button>
          <button type="button" className="cta" onClick={onStart} disabled={!canStart}>
            Start
          </button>
        </>
      )}

      {role === "guest" && link === "open" && <p>Waiting for host to start</p>}

      {status && <p className="lobby-status">{status}</p>}

      <button type="button" className="ghost" onClick={onLeave}>
        Leave lobby
      </button>
    </div>
  );
}
