namespace PatoQuack.Domain.Servers;

/// <summary>Porta de persistência dos servidores e de quem é membro deles.</summary>
public interface IServerRepository
{
    /// <summary>Servidor rastreado (para alterar ou remover), ou null.</summary>
    Task<Server?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Servidores dos quais o usuário é membro, em ordem de entrada.</summary>
    Task<IReadOnlyList<Server>> ListByMemberAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<bool> IsMemberAsync(Guid serverId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Membros do servidor com nome e usuário (o dono primeiro, depois por nome).</summary>
    Task<IReadOnlyList<ServerMemberView>> ListMembersAsync(Guid serverId, CancellationToken cancellationToken = default);

    /// <summary>Remove a participação imediatamente. Retorna false se não era membro.</summary>
    Task<bool> RemoveMemberAsync(Guid serverId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>Marca o servidor para inclusão (efetivada no SaveChanges).</summary>
    Task AddAsync(Server server, CancellationToken cancellationToken = default);

    /// <summary>Marca a participação para inclusão (efetivada no SaveChanges).</summary>
    Task AddMemberAsync(ServerMember member, CancellationToken cancellationToken = default);

    /// <summary>Marca o servidor para remoção. Canais, membros e presença vão junto.</summary>
    void Remove(Server server);
}
