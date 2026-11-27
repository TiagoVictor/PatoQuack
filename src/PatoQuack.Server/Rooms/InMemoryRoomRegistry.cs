using System.Collections.Concurrent;

namespace PatoQuack.Server.Rooms;

/// <summary>
/// Registro em memória (singleton). Serve para uma única instância do servidor;
/// o estado se perde ao reiniciar.
/// </summary>
public sealed class InMemoryRoomRegistry : IRoomRegistry
{
    // connectionId -> participante (busca rápida para sinalização e desconexão)
    private readonly ConcurrentDictionary<string, Participant> _byConnection = new();

    // sala -> membros. Cada sala tem o próprio lock, para que "checar capacidade + inserir"
    // seja atômico sem travar as outras salas.
    private readonly ConcurrentDictionary<string, RoomState> _rooms = new(StringComparer.Ordinal);

    public Task<JoinResult> TryJoinAsync(Participant participant, int capacity)
    {
        if (!_byConnection.TryAdd(participant.ConnectionId, participant))
        {
            return Task.FromResult(JoinResult.AlreadyInRoom);
        }

        while (true)
        {
            var room = _rooms.GetOrAdd(participant.Room, _ => new RoomState());
            lock (room)
            {
                // A sala pode ter sido removida do dicionário (ficou vazia) entre o GetOrAdd
                // e o lock. Nesse caso, tentamos de novo com uma instância nova.
                if (room.Closed)
                {
                    continue;
                }

                if (room.Members.Count >= capacity)
                {
                    _byConnection.TryRemove(participant.ConnectionId, out _);
                    return Task.FromResult(JoinResult.Full);
                }

                var existing = room.Members
                    .Select(id => _byConnection.TryGetValue(id, out var p) ? p : null)
                    .OfType<Participant>()
                    .ToList();

                room.Members.Add(participant.ConnectionId);
                var streamer = room.StreamerConnectionId is { } streamerId
                    ? existing.FirstOrDefault(p => p.ConnectionId == streamerId)
                    : null;
                return Task.FromResult(new JoinResult(JoinStatus.Joined, existing, streamer));
            }
        }
    }

    public Task<Participant?> RemoveAsync(string connectionId)
    {
        if (!_byConnection.TryRemove(connectionId, out var participant))
        {
            return Task.FromResult<Participant?>(null);
        }

        if (_rooms.TryGetValue(participant.Room, out var room))
        {
            lock (room)
            {
                room.Members.Remove(connectionId);
                if (room.StreamerConnectionId == connectionId)
                {
                    room.StreamerConnectionId = null;
                }

                if (room.Members.Count == 0)
                {
                    room.Closed = true;
                    _rooms.TryRemove(new KeyValuePair<string, RoomState>(participant.Room, room));
                }
            }
        }

        return Task.FromResult<Participant?>(participant);
    }

    public Task<Participant?> GetAsync(string connectionId) =>
        Task.FromResult(_byConnection.TryGetValue(connectionId, out var p) ? p : null);

    public Task<Participant?> SetMutedAsync(string connectionId, bool muted)
    {
        while (_byConnection.TryGetValue(connectionId, out var current))
        {
            var updated = current with { Muted = muted };
            if (_byConnection.TryUpdate(connectionId, updated, current))
            {
                return Task.FromResult<Participant?>(updated);
            }
        }

        return Task.FromResult<Participant?>(null);
    }

    public Task<StreamStartResult> TryStartStreamAsync(string connectionId)
    {
        if (!_byConnection.TryGetValue(connectionId, out var self)
            || !_rooms.TryGetValue(self.Room, out var room))
        {
            return Task.FromResult(new StreamStartResult(StreamStartStatus.NotInRoom, null));
        }

        lock (room)
        {
            if (room.Closed || !room.Members.Contains(connectionId))
            {
                return Task.FromResult(new StreamStartResult(StreamStartStatus.NotInRoom, null));
            }

            if (room.StreamerConnectionId is { } current)
            {
                var streamer = _byConnection.TryGetValue(current, out var p) ? p : null;
                return Task.FromResult(new StreamStartResult(StreamStartStatus.AlreadyStreaming, self, streamer));
            }

            room.StreamerConnectionId = connectionId;
            return Task.FromResult(new StreamStartResult(StreamStartStatus.Started, self));
        }
    }

    public Task<Participant?> GetStreamerAsync(string room)
    {
        if (!_rooms.TryGetValue(room, out var state))
        {
            return Task.FromResult<Participant?>(null);
        }

        lock (state)
        {
            var streamer = state.StreamerConnectionId is { } id && _byConnection.TryGetValue(id, out var p) ? p : null;
            return Task.FromResult(streamer);
        }
    }

    public Task<Participant?> StopStreamAsync(string connectionId)
    {
        if (!_byConnection.TryGetValue(connectionId, out var self)
            || !_rooms.TryGetValue(self.Room, out var room))
        {
            return Task.FromResult<Participant?>(null);
        }

        lock (room)
        {
            if (room.StreamerConnectionId != connectionId)
            {
                return Task.FromResult<Participant?>(null);
            }

            room.StreamerConnectionId = null;
            return Task.FromResult<Participant?>(self);
        }
    }

    private sealed class RoomState
    {
        public HashSet<string> Members { get; } = new(StringComparer.Ordinal);

        /// <summary>Conexão que transmite vídeo na sala (no máximo uma), ou null.</summary>
        public string? StreamerConnectionId { get; set; }

        public bool Closed { get; set; }
    }
}
