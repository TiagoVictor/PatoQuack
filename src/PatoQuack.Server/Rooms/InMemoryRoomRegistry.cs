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
                return Task.FromResult(new JoinResult(JoinStatus.Joined, existing));
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

    private sealed class RoomState
    {
        public HashSet<string> Members { get; } = new(StringComparer.Ordinal);
        public bool Closed { get; set; }
    }
}
