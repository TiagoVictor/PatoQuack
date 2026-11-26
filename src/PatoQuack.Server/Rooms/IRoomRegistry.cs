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
}

public enum JoinStatus
{
    Joined,
    RoomFull,
    AlreadyInRoom,
}

public sealed record JoinResult(JoinStatus Status, IReadOnlyList<Participant> ExistingParticipants)
{
    public static JoinResult Full { get; } = new(JoinStatus.RoomFull, []);
    public static JoinResult AlreadyInRoom { get; } = new(JoinStatus.AlreadyInRoom, []);
}
