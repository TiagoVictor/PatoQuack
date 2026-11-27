namespace PatoQuack.Server.Rooms;

/// <summary>
/// Guarda quem está em qual sala.
///
/// A API é assíncrona de propósito: a implementação atual é em memória, mas uma versão
/// com Redis (necessária para rodar mais de uma instância do servidor) vai fazer I/O.
/// O hub depende só desta interface, então a troca é uma linha no Program.cs.
/// </summary>
public interface IRoomRegistry
{
    /// <summary>
    /// Adiciona o participante à sala se houver vaga. A checagem de capacidade e a inserção
    /// são atômicas. Retorna quem já estava na sala (sem incluir o próprio participante).
    /// </summary>
    Task<JoinResult> TryJoinAsync(Participant participant, int capacity);

    /// <summary>Remove a conexão da sala em que estiver. Retorna o participante removido, ou null.</summary>
    Task<Participant?> RemoveAsync(string connectionId);

    Task<Participant?> GetAsync(string connectionId);

    /// <summary>Atualiza o estado de mute. Retorna o participante atualizado, ou null se não estiver em sala.</summary>
    Task<Participant?> SetMutedAsync(string connectionId, bool muted);

    /// <summary>
    /// Marca a conexão como quem transmite vídeo na sala dela. No máximo uma por sala:
    /// a checagem e a marcação são atômicas.
    /// </summary>
    Task<StreamStartResult> TryStartStreamAsync(string connectionId);

    /// <summary>
    /// Encerra a transmissão da conexão. Retorna o participante se ele estava transmitindo,
    /// ou null caso contrário (não transmitia, ou não está em sala).
    /// </summary>
    Task<Participant?> StopStreamAsync(string connectionId);

    /// <summary>Quem transmite vídeo na sala, ou null se ninguém (ou a sala não existe).</summary>
    Task<Participant?> GetStreamerAsync(string room);

    /// <summary>Conexões de uma conta (a mesma pessoa pode estar em mais de uma aba).</summary>
    Task<IReadOnlyList<Participant>> GetByUserAsync(string userId);

    /// <summary>Quem está na sala agora.</summary>
    Task<IReadOnlyList<Participant>> GetParticipantsAsync(string room);
}

public enum StreamStartStatus
{
    Started,
    NotInRoom,
    AlreadyStreaming,
}

/// <param name="Status">Resultado.</param>
/// <param name="Self">Quem pediu para transmitir (null se não estiver em sala).</param>
/// <param name="CurrentStreamer">Quem já transmite, quando o status é <see cref="StreamStartStatus.AlreadyStreaming"/>.</param>
public sealed record StreamStartResult(StreamStartStatus Status, Participant? Self, Participant? CurrentStreamer = null);

public enum JoinStatus
{
    Joined,
    RoomFull,
    AlreadyInRoom,
}

/// <param name="Streamer">Quem transmite vídeo na sala no momento da entrada, ou null.</param>
public sealed record JoinResult(JoinStatus Status, IReadOnlyList<Participant> ExistingParticipants, Participant? Streamer = null)
{
    public static JoinResult Full { get; } = new(JoinStatus.RoomFull, []);
    public static JoinResult AlreadyInRoom { get; } = new(JoinStatus.AlreadyInRoom, []);
}
