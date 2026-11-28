namespace PatoQuack.Domain.Servers;

/// <summary>Porta de persistência dos convites.</summary>
public interface IServerInviteRepository
{
    /// <summary>Convite rastreado (para revogar), ou null.</summary>
    Task<ServerInvite?> GetByCodeAsync(string code, CancellationToken cancellationToken = default);

    Task<bool> CodeExistsAsync(string code, CancellationToken cancellationToken = default);

    /// <summary>Convites ainda usáveis do servidor, do mais novo para o mais antigo.</summary>
    Task<IReadOnlyList<ServerInvite>> ListUsableAsync(Guid serverId, DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>Marca o convite para inclusão (efetivada no SaveChanges).</summary>
    Task AddAsync(ServerInvite invite, CancellationToken cancellationToken = default);

    /// <summary>
    /// Gasta um uso de forma atômica: só conta se o convite ainda for usável neste momento (dois
    /// aceites simultâneos não passam do limite). Retorna false se não deu.
    /// </summary>
    Task<bool> TryConsumeUseAsync(Guid inviteId, DateTimeOffset now, CancellationToken cancellationToken = default);
}
